import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { Focusable, KeyId } from "@earendil-works/pi-tui";
import {
  Container,
  Input,
  matchesKey,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import { Fzf, type FzfResultItem } from "fzf";
import type {
  FileCandidate,
  PickerResult,
  PickerScope,
} from "./model.js";
import { formatHomePath } from "./paths.js";

export interface SelectorTheme {
  accent: (text: string) => string;
  muted: (text: string) => string;
  dim: (text: string) => string;
  match: (text: string) => string;
  border: (text: string) => string;
  bold: (text: string) => string;
}

export interface KeybindingsLike {
  matches(data: string, keybinding: string): boolean;
  getKeys?(keybinding: string): string[];
}

type ScopeStatus = "idle" | "loading" | "ready" | "error";

type PickerView = "browse" | "review" | "confirm";

interface ScopeState {
  status: ScopeStatus;
  candidates: FileCandidate[];
  fzf?: Fzf<FileCandidate[]>;
  directory?: string;
  error?: string;
}

interface ProjectIndex {
  fzf: Fzf<FileCandidate[]>;
}

const projectIndexes = new WeakMap<FileCandidate[], ProjectIndex>();
const EMPTY_POSITIONS: ReadonlySet<number> = new Set<number>();

interface FilteredCandidate {
  candidate: FileCandidate;
  positions: ReadonlySet<number>;
}

const DEFAULT_KEYS = {
  up: "up",
  down: "down",
  pageUp: "pageUp",
  pageDown: "pageDown",
  confirm: "enter",
  cancel: "escape",
} as const;

function emptyScopeState(): ScopeState {
  return {
    status: "idle",
    candidates: [],
  };
}

function projectIndex(candidates: FileCandidate[]): ProjectIndex {
  const cached = projectIndexes.get(candidates);
  if (cached) return cached;
  const created = {
    fzf: new Fzf<FileCandidate[]>(candidates, {
      selector: (candidate: FileCandidate) => candidate.displayPath,
      forward: false,
      fuzzy: "v1",
    }),
  };
  projectIndexes.set(candidates, created);
  return created;
}

function matchesSelectionKey(
  keybindings: KeybindingsLike,
  data: string,
  action: string,
  fallback: KeyId,
): boolean {
  if (keybindings.matches(data, action)) return true;
  const configured = keybindings.getKeys?.(action) ?? [];
  return configured.length === 0 && matchesKey(data, fallback);
}

function keyText(
  keybindings: KeybindingsLike,
  action: string,
  fallback: string,
): string {
  const key = keybindings.getKeys?.(action)?.[0] ?? fallback;
  return { up: "↑", down: "↓", enter: "↵", escape: "esc" }[key] ?? key;
}

export class FileSelector extends Container implements Focusable {
  private readonly projectInputs = new Map<string, Input>();
  private readonly globalInputs = new Map<string, Input>();
  private readonly globalDirectoryStates = new Map<string, ScopeState>();
  private readonly states: Record<PickerScope, ScopeState> = {
    project: emptyScopeState(),
    global: emptyScopeState(),
  };
  private readonly marked = new Map<string, FileCandidate>();
  private readonly indexedProjectCandidates = new Set<FileCandidate[]>();
  private readonly queryDriven: Record<PickerScope, boolean> = {
    project: false,
    global: false,
  };
  private readonly projectSelectedIndices = new Map<string, number>();
  private readonly globalSelectedIndices = new Map<string, number>();
  private activeScope: PickerScope = "project";
  private activeView: PickerView = "browse";
  private reviewCandidates: FileCandidate[] = [];
  private reviewSelectedIndex = 0;
  private pendingCandidates: FileCandidate[] = [];
  private confirmSelectedIndex = 0;
  private confirmReturnView: Exclude<PickerView, "confirm"> = "browse";
  private filtered: FilteredCandidate[] = [];
  private disposed = false;
  private projectIndexTimer: ReturnType<typeof setTimeout> | undefined;
  private renderCache: { width: number; lines: string[] } | undefined;
  private _focused = false;
  private projectBaseRoot?: string;
  private projectRoot?: string;
  private globalRoot?: string;
  private includeGitIgnored = false;
  private readonly keyLabels: {
    up: string;
    down: string;
    enter: string;
    escape: string;
  };

  public onResult?: (result: PickerResult) => void;
  public onScopeRequest?: (scope: PickerScope) => void;
  public onProjectDirectoryRequest?: (directory: string) => void;
  public onGlobalDirectoryRequest?: (directory: string) => void;
  public onGlobalPreviewRequest?: (directory: string) => void;
  public onQueryChange?: (
    scope: PickerScope,
    query: string,
  ) => boolean | void;
  public onProjectIgnoreChange?: (includeGitIgnored: boolean) => void;
  public onUpdate?: () => void;

  constructor(
    private readonly maxVisible: number,
    private readonly selectorTheme: SelectorTheme,
    private readonly keybindings: KeybindingsLike,
  ) {
    super();
    this.keyLabels = {
      up: keyText(keybindings, "tui.select.up", "↑"),
      down: keyText(keybindings, "tui.select.down", "↓"),
      enter: keyText(keybindings, "tui.select.confirm", "enter"),
      escape: keyText(keybindings, "tui.select.cancel", "esc"),
    };
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.renderCache = undefined;
    this.syncInputFocus();
  }

  requestInitialScope(): void {
    this.requestScope("project");
  }

  setScopeQueryDriven(scope: PickerScope, enabled: boolean): void {
    this.queryDriven[scope] = enabled;
  }

  getQuery(scope: PickerScope): string {
    return this.inputFor(scope).getValue();
  }

  getIncludeGitIgnored(): boolean {
    return this.includeGitIgnored;
  }

  setProjectRoot(root: string): void {
    const nextRoot = resolve(root);
    if (nextRoot === this.projectRoot) return;
    this.projectBaseRoot ??= nextRoot;
    this.projectRoot = nextRoot;
    this.cancelProjectIndexPreparation();
    this.states.project = emptyScopeState();
    this.projectInput(nextRoot);
    this.syncInputFocus();
    if (this.activeScope === "project") this.applyFilter(false);
    this.notifyUpdate();
  }

  setGlobalRoot(root: string): void {
    this.renderCache = undefined;
    this.globalRoot = resolve(root);
    this.states.global = this.globalDirectoryState(this.globalRoot);
    this.globalInput(this.globalRoot);
    this.syncInputFocus();
  }

  private globalDirectoryState(directory: string): ScopeState {
    const key = resolve(directory);
    let state = this.globalDirectoryStates.get(key);
    if (!state) {
      state = { ...emptyScopeState(), directory: key };
      this.globalDirectoryStates.set(key, state);
    }
    return state;
  }

  setGlobalDirectoryLoading(directory: string): void {
    if (this.disposed) return;
    const state = this.globalDirectoryState(directory);
    state.status = "loading";
    state.error = undefined;
    this.states.global = state;
    this.globalInput(state.directory!);
    this.syncInputFocus();
    if (this.activeScope === "global") this.applyFilter(false);
    this.notifyUpdate();
  }

  setGlobalPreviewLoading(directory: string): void {
    if (this.disposed) return;
    const state = this.globalDirectoryState(directory);
    state.status = "loading";
    state.error = undefined;
    this.notifyUpdate();
  }

  setGlobalPreviewIdle(directory: string): void {
    if (this.disposed) return;
    const state = this.globalDirectoryStates.get(resolve(directory));
    if (!state || state === this.states.global || state.status !== "loading") {
      return;
    }
    state.status = "idle";
    this.notifyUpdate();
  }

  setGlobalDirectoryCandidates(
    directory: string,
    candidates: FileCandidate[],
  ): void {
    if (this.disposed) return;
    const state = this.globalDirectoryState(directory);
    state.status = "ready";
    state.candidates = candidates;
    state.fzf = undefined;
    state.error = undefined;
    if (state === this.states.global && this.activeScope === "global") {
      this.applyFilter(false);
    }
    this.notifyUpdate();
  }

  setGlobalPreviewCandidates(
    directory: string,
    candidates: FileCandidate[],
  ): void {
    this.setGlobalDirectoryCandidates(directory, candidates);
  }

  setGlobalDirectoryError(directory: string, error: string): void {
    if (this.disposed) return;
    const state = this.globalDirectoryState(directory);
    state.status = "error";
    state.error = error;
    state.candidates = [];
    state.fzf = undefined;
    if (state === this.states.global && this.activeScope === "global") {
      this.applyFilter(false);
    }
    this.notifyUpdate();
  }

  setGlobalPreviewError(directory: string, error: string): void {
    this.setGlobalDirectoryError(directory, error);
  }

  setScopeLoading(scope: PickerScope): void {
    if (this.disposed) return;
    const state = this.states[scope];
    if (state.status === "ready") {
      state.error = undefined;
      this.notifyUpdate();
      return;
    }
    state.status = "loading";
    state.error = undefined;
    if (scope === this.activeScope) this.applyFilter(false);
    this.notifyUpdate();
  }

  setScopeCandidates(scope: PickerScope, candidates: FileCandidate[]): void {
    if (this.disposed) return;
    const state = this.states[scope];
    if (
      scope === "project" &&
      state.status === "ready" &&
      state.candidates === candidates
    ) {
      state.error = undefined;
      if (scope === this.activeScope) this.applyFilter(false);
      this.notifyUpdate();
      return;
    }
    if (scope === "project") this.cancelProjectIndexPreparation();
    state.status = "ready";
    state.candidates = candidates;
    state.fzf = undefined;
    state.error = undefined;
    if (scope === this.activeScope) this.applyFilter(false);
    this.notifyUpdate();
  }

  setScopeError(scope: PickerScope, error: string): void {
    if (this.disposed) return;
    if (scope === "project") this.cancelProjectIndexPreparation();
    const state = this.states[scope];
    state.status = "error";
    state.error = error;
    state.candidates = [];
    state.fzf = undefined;
    if (scope === this.activeScope) this.applyFilter(false);
    this.notifyUpdate();
  }

  private notifyUpdate(): void {
    this.invalidate();
    this.onUpdate?.();
  }

  private projectInput(directory: string): Input {
    const key = resolve(directory);
    let input = this.projectInputs.get(key);
    if (!input) {
      input = new Input();
      this.projectInputs.set(key, input);
    }
    return input;
  }

  private globalInput(directory: string): Input {
    const key = resolve(directory);
    let input = this.globalInputs.get(key);
    if (!input) {
      input = new Input();
      this.globalInputs.set(key, input);
    }
    return input;
  }

  private inputFor(scope: PickerScope): Input {
    if (scope === "project") {
      return this.projectInput(this.projectRoot ?? process.cwd());
    }
    const directory =
      this.states.global.directory ?? this.globalRoot ?? process.cwd();
    return this.globalInput(directory);
  }

  private activeInput(): Input {
    return this.inputFor(this.activeScope);
  }

  private syncInputFocus(): void {
    for (const input of this.projectInputs.values()) input.focused = false;
    for (const input of this.globalInputs.values()) input.focused = false;
    if (this.activeView === "browse") {
      this.activeInput().focused = this._focused;
    }
  }

  private requestScope(scope: PickerScope): void {
    if (this.states[scope].status !== "idle") return;
    this.onScopeRequest?.(scope);
  }

  private switchScope(scope: PickerScope): void {
    if (scope === this.activeScope) return;
    this.activeScope = scope;
    this.syncInputFocus();
    this.applyFilter(false);
    this.requestScope(scope);
  }

  private selectedIndex(): number {
    if (this.activeScope === "project") {
      const root = this.projectRoot ?? "";
      return this.projectSelectedIndices.get(root) ?? 0;
    }
    const directory = this.states.global.directory ?? this.globalRoot ?? "";
    return this.globalSelectedIndices.get(directory) ?? 0;
  }

  private setSelectedIndex(index: number): void {
    if (this.activeScope === "project") {
      const root = this.projectRoot ?? "";
      this.projectSelectedIndices.set(root, index);
      return;
    }
    const directory = this.states.global.directory ?? this.globalRoot ?? "";
    this.globalSelectedIndices.set(directory, index);
  }

  private selectedCandidate(): FileCandidate | undefined {
    return this.filtered[this.selectedIndex()]?.candidate;
  }

  private requestSelectedGlobalPreview(): void {
    if (this.activeScope !== "global" || this.activeView !== "browse") return;
    const selected = this.selectedCandidate();
    if (!selected?.isDirectory) return;
    const state = this.globalDirectoryStates.get(resolve(selected.absolutePath));
    if (!state || state.status === "idle") {
      this.onGlobalPreviewRequest?.(selected.absolutePath);
    }
  }

  private cancelProjectIndexPreparation(): void {
    if (this.projectIndexTimer) clearTimeout(this.projectIndexTimer);
    this.projectIndexTimer = undefined;
  }

  private ensureProjectIndex(candidates: FileCandidate[]): ProjectIndex {
    this.cancelProjectIndexPreparation();
    this.indexedProjectCandidates.add(candidates);
    return projectIndex(candidates);
  }

  private scheduleProjectIndexPreparation(): void {
    if (this.projectIndexTimer || this.disposed) return;
    const state = this.states.project;
    if (
      state.status !== "ready" ||
      state.fzf ||
      state.candidates.length === 0
    ) {
      return;
    }
    const candidates = state.candidates;
    this.projectIndexTimer = setTimeout(() => {
      this.projectIndexTimer = undefined;
      if (
        this.disposed ||
        state.candidates !== candidates ||
        state.fzf
      ) {
        return;
      }
      this.indexedProjectCandidates.add(candidates);
      state.fzf = projectIndex(candidates).fzf;
    }, 0);
    (this.projectIndexTimer as ReturnType<typeof setTimeout> & {
      unref?: () => void;
    }).unref?.();
  }

  private applyFilter(resetSelection = true): void {
    const state = this.states[this.activeScope];
    const query = this.activeInput().getValue();

    if (state.status !== "ready") {
      this.filtered = [];
      return;
    }

    if (!query) {
      this.filtered = state.candidates.map((candidate) => ({
        candidate,
        positions: EMPTY_POSITIONS,
      }));
    } else if (this.activeScope === "global") {
      const normalizedQuery = query.toLocaleLowerCase();
      this.filtered = state.candidates
        .filter((candidate) =>
          candidate.displayPath.toLocaleLowerCase().includes(normalizedQuery),
        )
        .map((candidate) => ({
          candidate,
          positions: substringPositions(
            candidate.displayPath,
            normalizedQuery,
          ),
        }));
    } else {
      if (!state.fzf) {
        state.fzf = this.ensureProjectIndex(state.candidates).fzf;
      }
      const results: FzfResultItem<FileCandidate>[] =
        state.fzf.find(query);
      this.filtered = results.map((result) => ({
        candidate: result.item,
        positions: result.positions,
      }));
    }

    if (resetSelection) this.setSelectedIndex(0);
    else {
      this.setSelectedIndex(
        Math.max(0, Math.min(this.filtered.length - 1, this.selectedIndex())),
      );
    }
    this.requestSelectedGlobalPreview();
  }

  private moveSelection(delta: number, wrap = true): void {
    if (this.filtered.length === 0) return;
    const current = this.selectedIndex();
    if (wrap) {
      const total = this.filtered.length;
      this.setSelectedIndex((current + delta + total) % total);
    } else {
      this.setSelectedIndex(
        Math.max(0, Math.min(this.filtered.length - 1, current + delta)),
      );
    }
    this.requestSelectedGlobalPreview();
  }

  private openProjectDirectory(directory: string): void {
    const nextRoot = resolve(directory);
    if (!this.projectRoot || nextRoot === this.projectRoot) return;
    this.setProjectRoot(nextRoot);
    this.onProjectDirectoryRequest?.(nextRoot);
  }

  private openSelectedProjectDirectory(): void {
    if (this.activeScope !== "project") return;
    const selected = this.selectedCandidate();
    if (selected?.isDirectory) {
      this.openProjectDirectory(selected.absolutePath);
    }
  }

  private openProjectParent(): void {
    if (!this.projectRoot) return;
    this.openProjectDirectory(dirname(this.projectRoot));
  }

  private openGlobalDirectory(directory: string): void {
    if (!this.globalRoot) return;
    this.onGlobalDirectoryRequest?.(resolve(directory));
  }

  private openSelectedGlobalDirectory(): void {
    if (this.activeScope !== "global") return;
    const selected = this.selectedCandidate();
    if (selected?.isDirectory) this.openGlobalDirectory(selected.absolutePath);
  }

  private openGlobalParent(): void {
    if (!this.globalRoot) return;
    const current = this.states.global.directory ?? this.globalRoot;
    if (resolve(current) === this.globalRoot) return;
    this.openGlobalDirectory(dirname(current));
  }

  private toggleMarked(delta: number): void {
    const selected = this.selectedCandidate();
    if (!selected) return;

    if (this.marked.has(selected.absolutePath)) {
      this.marked.delete(selected.absolutePath);
    } else {
      this.marked.set(selected.absolutePath, selected);
    }
    this.moveSelection(delta);
  }

  private clearMarked(): void {
    if (this.marked.size === 0) return;
    this.marked.clear();
    this.notifyUpdate();
  }

  private showReview(): void {
    this.reviewCandidates = [...this.marked.values()];
    this.reviewSelectedIndex = 0;
    this.activeView = "review";
    this.syncInputFocus();
  }

  private leaveReview(): void {
    this.activeView = "browse";
    this.syncInputFocus();
  }

  private reviewCandidate(): FileCandidate | undefined {
    return this.reviewCandidates[this.reviewSelectedIndex];
  }

  private moveReviewSelection(delta: number, wrap = true): void {
    if (this.reviewCandidates.length === 0) return;
    if (wrap) {
      const total = this.reviewCandidates.length;
      this.reviewSelectedIndex =
        (this.reviewSelectedIndex + delta + total) % total;
      return;
    }
    this.reviewSelectedIndex = Math.max(
      0,
      Math.min(
        this.reviewCandidates.length - 1,
        this.reviewSelectedIndex + delta,
      ),
    );
  }

  private normalizeReviewSelectionOrder(): void {
    const selected = this.reviewCandidates.filter((candidate) =>
      this.marked.has(candidate.absolutePath),
    );
    this.marked.clear();
    for (const candidate of selected) {
      this.marked.set(candidate.absolutePath, candidate);
    }
  }

  private toggleReviewCandidate(delta = 0): void {
    const candidate = this.reviewCandidate();
    if (!candidate) return;
    if (this.marked.has(candidate.absolutePath)) {
      this.marked.delete(candidate.absolutePath);
    } else {
      this.marked.set(candidate.absolutePath, candidate);
    }
    this.normalizeReviewSelectionOrder();
    if (delta !== 0) this.moveReviewSelection(delta);
  }

  private selectAllReviewCandidates(): void {
    for (const candidate of this.reviewCandidates) {
      this.marked.set(candidate.absolutePath, candidate);
    }
    this.normalizeReviewSelectionOrder();
  }

  private beginConfirmation(
    candidates: FileCandidate[],
    returnView: Exclude<PickerView, "confirm">,
  ): void {
    if (candidates.length === 0) return;
    this.pendingCandidates = [...candidates];
    this.confirmSelectedIndex = 0;
    this.confirmReturnView = returnView;
    this.activeView = "confirm";
    this.syncInputFocus();
  }

  private leaveConfirmation(): void {
    this.activeView = this.confirmReturnView;
    this.syncInputFocus();
  }

  private moveConfirmation(delta: number): void {
    if (this.pendingCandidates.length === 0) return;
    this.confirmSelectedIndex = Math.max(
      0,
      Math.min(
        this.pendingCandidates.length - 1,
        this.confirmSelectedIndex + delta,
      ),
    );
  }

  private accept(): void {
    if (this.marked.size > 0) {
      this.beginConfirmation([...this.marked.values()], "browse");
      return;
    }

    const selected = this.selectedCandidate();
    if (this.activeScope === "global" && selected?.isDirectory) {
      this.openGlobalDirectory(selected.absolutePath);
      return;
    }
    if (selected) this.beginConfirmation([selected], "browse");
  }

  private handleReviewInput(data: string): void {
    if (
      matchesKey(data, "ctrl+s" as KeyId) ||
      matchesSelectionKey(
        this.keybindings,
        data,
        "tui.select.cancel",
        DEFAULT_KEYS.cancel,
      )
    ) {
      this.leaveReview();
      return;
    }
    if (
      matchesSelectionKey(
        this.keybindings,
        data,
        "tui.select.up",
        DEFAULT_KEYS.up,
      )
    ) {
      this.moveReviewSelection(-1);
      return;
    }
    if (
      matchesSelectionKey(
        this.keybindings,
        data,
        "tui.select.down",
        DEFAULT_KEYS.down,
      )
    ) {
      this.moveReviewSelection(1);
      return;
    }
    if (
      matchesSelectionKey(
        this.keybindings,
        data,
        "tui.select.pageUp",
        DEFAULT_KEYS.pageUp,
      )
    ) {
      this.moveReviewSelection(-this.maxVisible, false);
      return;
    }
    if (
      matchesSelectionKey(
        this.keybindings,
        data,
        "tui.select.pageDown",
        DEFAULT_KEYS.pageDown,
      )
    ) {
      this.moveReviewSelection(this.maxVisible, false);
      return;
    }
    if (matchesKey(data, "tab" as KeyId)) {
      this.toggleReviewCandidate(1);
      return;
    }
    if (matchesKey(data, "shift+tab" as KeyId)) {
      this.toggleReviewCandidate(-1);
      return;
    }
    if (matchesKey(data, "space" as KeyId)) {
      this.toggleReviewCandidate();
      return;
    }
    if (matchesKey(data, "ctrl+a" as KeyId)) {
      this.selectAllReviewCandidates();
      return;
    }
    if (matchesKey(data, "ctrl+x" as KeyId)) {
      this.clearMarked();
      return;
    }
    if (
      matchesSelectionKey(
        this.keybindings,
        data,
        "tui.select.confirm",
        DEFAULT_KEYS.confirm,
      )
    ) {
      this.beginConfirmation([...this.marked.values()], "review");
    }
  }

  private handleConfirmationInput(data: string): void {
    if (
      matchesSelectionKey(
        this.keybindings,
        data,
        "tui.select.cancel",
        DEFAULT_KEYS.cancel,
      )
    ) {
      this.leaveConfirmation();
      return;
    }
    if (
      matchesSelectionKey(
        this.keybindings,
        data,
        "tui.select.up",
        DEFAULT_KEYS.up,
      )
    ) {
      this.moveConfirmation(-1);
      return;
    }
    if (
      matchesSelectionKey(
        this.keybindings,
        data,
        "tui.select.down",
        DEFAULT_KEYS.down,
      )
    ) {
      this.moveConfirmation(1);
      return;
    }
    if (
      matchesSelectionKey(
        this.keybindings,
        data,
        "tui.select.pageUp",
        DEFAULT_KEYS.pageUp,
      )
    ) {
      this.moveConfirmation(-this.maxVisible);
      return;
    }
    if (
      matchesSelectionKey(
        this.keybindings,
        data,
        "tui.select.pageDown",
        DEFAULT_KEYS.pageDown,
      )
    ) {
      this.moveConfirmation(this.maxVisible);
      return;
    }
    if (
      matchesSelectionKey(
        this.keybindings,
        data,
        "tui.select.confirm",
        DEFAULT_KEYS.confirm,
      )
    ) {
      this.onResult?.({
        kind: "select",
        candidates: [...this.pendingCandidates],
      });
    }
  }

  handleInput(data: string): void {
    this.renderCache = undefined;
    if (this.activeView === "confirm") {
      this.handleConfirmationInput(data);
      return;
    }
    if (this.activeView === "review") {
      this.handleReviewInput(data);
      return;
    }
    if (matchesKey(data, "ctrl+s" as KeyId)) {
      this.showReview();
      return;
    }
    if (matchesKey(data, "[" as KeyId)) {
      this.switchScope("project");
      return;
    }
    if (matchesKey(data, "]" as KeyId)) {
      this.switchScope("global");
      return;
    }
    if (matchesKey(data, "@" as KeyId)) {
      this.onResult?.({ kind: "literal-at" });
      return;
    }
    if (matchesKey(data, "ctrl+x" as KeyId)) {
      this.clearMarked();
      return;
    }
    if (
      this.activeScope === "project" &&
      matchesKey(data, "ctrl+g" as KeyId)
    ) {
      this.includeGitIgnored = !this.includeGitIgnored;
      this.onProjectIgnoreChange?.(this.includeGitIgnored);
      return;
    }
    if (
      this.selectedCandidate()?.isDirectory &&
      (matchesKey(data, "right" as KeyId) ||
        matchesKey(data, "ctrl+l" as KeyId))
    ) {
      if (this.activeScope === "project") {
        this.openSelectedProjectDirectory();
      } else {
        this.openSelectedGlobalDirectory();
      }
      return;
    }
    const ctrlH = matchesKey(data, "ctrl+h" as KeyId);
    const ambiguousBackspace =
      ctrlH && matchesKey(data, "backspace" as KeyId);
    if (
      (matchesKey(data, "left" as KeyId) ||
        (ctrlH &&
          (!ambiguousBackspace || this.activeInput().getValue() === "")))
    ) {
      if (this.activeScope === "project") {
        this.openProjectParent();
      } else {
        this.openGlobalParent();
      }
      return;
    }
    if (
      this.activeInput().getValue() === "" &&
      matchesKey(data, "backspace" as KeyId)
    ) {
      if (this.activeScope === "project") {
        this.openProjectParent();
      } else {
        this.openGlobalParent();
      }
      return;
    }

    if (
      matchesSelectionKey(
        this.keybindings,
        data,
        "tui.select.up",
        DEFAULT_KEYS.up,
      )
    ) {
      this.moveSelection(-1);
      return;
    }
    if (
      matchesSelectionKey(
        this.keybindings,
        data,
        "tui.select.down",
        DEFAULT_KEYS.down,
      )
    ) {
      this.moveSelection(1);
      return;
    }
    if (
      matchesSelectionKey(
        this.keybindings,
        data,
        "tui.select.pageUp",
        DEFAULT_KEYS.pageUp,
      )
    ) {
      this.moveSelection(-this.maxVisible, false);
      return;
    }
    if (
      matchesSelectionKey(
        this.keybindings,
        data,
        "tui.select.pageDown",
        DEFAULT_KEYS.pageDown,
      )
    ) {
      this.moveSelection(this.maxVisible, false);
      return;
    }
    if (matchesKey(data, "tab" as KeyId)) {
      this.toggleMarked(1);
      return;
    }
    if (matchesKey(data, "shift+tab" as KeyId)) {
      this.toggleMarked(-1);
      return;
    }
    if (
      matchesSelectionKey(
        this.keybindings,
        data,
        "tui.select.confirm",
        DEFAULT_KEYS.confirm,
      )
    ) {
      this.accept();
      return;
    }
    if (
      matchesSelectionKey(
        this.keybindings,
        data,
        "tui.select.cancel",
        DEFAULT_KEYS.cancel,
      )
    ) {
      this.onResult?.({ kind: "cancel" });
      return;
    }

    const input = this.activeInput();
    const previous = input.getValue();
    input.handleInput(data);
    const query = input.getValue();
    if (query === previous) return;

    this.setSelectedIndex(0);
    if (this.queryDriven[this.activeScope]) {
      const handled =
        this.onQueryChange?.(this.activeScope, query) === true;
      if (!handled) this.applyFilter();
    } else {
      this.applyFilter();
    }
  }

  private renderEntry(
    entry: FilteredCandidate,
    selected: boolean,
  ): string {
    const candidate = entry.candidate;
    const isMarked = this.marked.has(candidate.absolutePath);
    const prefix = `${selected ? "→" : " "} ${isMarked ? "✓" : " "} `;
    const withoutSlash = candidate.isDirectory
      ? candidate.displayPath.slice(0, -1)
      : candidate.displayPath;
    const separatorIndex = withoutSlash.lastIndexOf("/");
    const parent = separatorIndex < 0 ? "" : withoutSlash.slice(0, separatorIndex);
    const basename = `${withoutSlash.slice(separatorIndex + 1)}${candidate.isDirectory ? "/" : ""}`;
    const basenameOffset = separatorIndex + 1;
    const highlightedBasename = highlightMatches(
      basename,
      entry.positions,
      this.selectorTheme.match,
      basenameOffset,
    );
    const highlightedParent =
      parent === ""
        ? ""
        : highlightMatches(
            `${parent}/`,
            entry.positions,
            this.selectorTheme.match,
          );
    const label = highlightedParent
      ? `${highlightedBasename}  ${this.selectorTheme.dim(highlightedParent)}`
      : highlightedBasename;
    return selected
      ? this.selectorTheme.accent(prefix) + this.selectorTheme.accent(label)
      : (isMarked ? this.selectorTheme.accent(prefix) : prefix) + label;
  }

  private renderReviewEntry(
    candidate: FileCandidate,
    selected: boolean,
    checked: boolean,
  ): string {
    const prefix = `${selected ? "→" : " "} ${checked ? "✓" : "○"} `;
    const label = sanitizeDisplayText(candidate.referencePath);
    return selected
      ? this.selectorTheme.accent(prefix) + this.selectorTheme.accent(label)
      : (checked ? this.selectorTheme.accent(prefix) : prefix) + label;
  }

  private renderSidePaneEntry(
    candidate: FileCandidate,
    selected: boolean,
  ): string {
    const marked = this.marked.has(candidate.absolutePath);
    const prefix = `${selected ? "→" : " "}${marked ? "✓" : " "} `;
    const label = sanitizeDisplayText(candidate.displayPath);
    return selected
      ? this.selectorTheme.accent(prefix + label)
      : (marked ? this.selectorTheme.accent(prefix) : prefix) + label;
  }

  private renderDirectoryPane(
    state: ScopeState | undefined,
    selectedPath: string | undefined,
    rows: number,
    width: number,
    emptyMessage: string,
  ): string[] {
    if (rows <= 0) return [];
    if (!state) return [this.selectorTheme.dim(`  ${emptyMessage}`)];
    if (state.status === "loading" || state.status === "idle") {
      return [this.selectorTheme.muted("  Loading…")];
    }
    if (state.status === "error") {
      return [this.selectorTheme.muted("  Error")];
    }
    if (state.candidates.length === 0) {
      return [this.selectorTheme.muted("  Empty")];
    }

    const resolvedSelectedPath = selectedPath
      ? resolve(selectedPath)
      : undefined;
    const matchingIndex = resolvedSelectedPath
      ? state.candidates.findIndex(
          (candidate) => candidate.absolutePath === resolvedSelectedPath,
        )
      : -1;
    const selectedIndex = Math.max(0, matchingIndex);
    const visible = Math.min(rows, state.candidates.length);
    const start = Math.max(
      0,
      Math.min(
        selectedIndex - Math.floor(visible / 2),
        state.candidates.length - visible,
      ),
    );
    return state.candidates
      .slice(start, start + visible)
      .map((candidate, index) =>
        this.renderSidePaneEntry(
          candidate,
          start + index === selectedIndex && matchingIndex >= 0,
        ),
      );
  }

  private renderCurrentGlobalPane(rows: number, width: number): string[] {
    const state = this.states.global;
    if (rows <= 0) return [];
    if (state.status === "loading" || state.status === "idle") {
      return [this.selectorTheme.muted("  Loading…")];
    }
    if (state.status === "error") {
      return [this.selectorTheme.muted("  Error")];
    }
    if (this.filtered.length === 0) {
      return [this.selectorTheme.muted("  No matches")];
    }

    const visible = Math.min(rows, this.filtered.length);
    const selectedIndex = this.selectedIndex();
    const start = Math.max(
      0,
      Math.min(
        selectedIndex - Math.floor(visible / 2),
        this.filtered.length - visible,
      ),
    );
    const lines: string[] = [];
    for (let index = start; index < start + visible; index++) {
      const entry = this.filtered[index];
      if (!entry) continue;
      lines.push(this.renderEntry(entry, index === selectedIndex));
    }
    return lines;
  }

  private renderGlobalPanes(width: number): string[] {
    const separatorWidth = 2;
    const available = Math.max(3, width - separatorWidth);
    const parentWidth = Math.max(1, Math.floor(available * 0.25));
    const currentWidth = Math.max(1, Math.floor(available * 0.45));
    const previewWidth = Math.max(1, available - parentWidth - currentWidth);
    const state = this.states.global;
    const currentDirectory = state.directory ?? this.globalRoot ?? "";
    const atRoot =
      !this.globalRoot || resolve(currentDirectory) === resolve(this.globalRoot);
    const parentDirectory = atRoot ? undefined : dirname(currentDirectory);
    const parentState = parentDirectory
      ? this.globalDirectoryStates.get(resolve(parentDirectory))
      : undefined;
    const selected = this.selectedCandidate();
    const previewState = selected?.isDirectory
      ? this.globalDirectoryStates.get(resolve(selected.absolutePath))
      : undefined;
    const paneRows = Math.max(0, this.maxVisible - 1);
    const parentLines = this.renderDirectoryPane(
      parentState,
      atRoot ? undefined : currentDirectory,
      paneRows,
      parentWidth,
      "Global root",
    );
    const currentLines = this.renderCurrentGlobalPane(paneRows, currentWidth);
    const previewLines = this.renderDirectoryPane(
      previewState,
      undefined,
      paneRows,
      previewWidth,
      selected?.isDirectory ? "Loading…" : "Select a directory",
    );
    const separator = this.selectorTheme.border("│");
    const lines = [
      fitLine(
        this.selectorTheme.dim(
          atRoot ? " Parent" : ` ${formatHomePath(parentDirectory!)}`,
        ),
        parentWidth,
      ) +
        separator +
        fitLine(
          this.selectorTheme.accent(` ${formatHomePath(currentDirectory)}`),
          currentWidth,
        ) +
        separator +
        fitLine(
          this.selectorTheme.dim(
            selected ? ` ${sanitizeDisplayText(selected.displayPath)}` : " Preview",
          ),
          previewWidth,
        ),
    ];

    for (let row = 0; row < paneRows; row++) {
      lines.push(
        fitLine(parentLines[row] ?? "", parentWidth) +
          separator +
          fitLine(currentLines[row] ?? "", currentWidth) +
          separator +
          fitLine(previewLines[row] ?? "", previewWidth),
      );
    }
    return lines;
  }

  private projectRootLocation(): string | undefined {
    if (!this.projectBaseRoot || !this.projectRoot) return undefined;
    const relativeRoot = relative(this.projectBaseRoot, this.projectRoot);
    if (!relativeRoot) return undefined;
    const displayRoot = isAbsolute(relativeRoot)
      ? formatHomePath(this.projectRoot)
      : sep === "\\"
        ? relativeRoot.replaceAll("\\", "/")
        : relativeRoot;
    return `${displayRoot}${displayRoot.endsWith("/") ? "" : "/"}`;
  }

  override render(width: number): string[] {
    const cached = this.renderCache;
    if (cached?.width === width) return cached.lines;
    if (width < 3) {
      const lines = [truncateToWidth("…", Math.max(1, width), "")];
      this.renderCache = { width, lines };
      return lines;
    }

    const t = this.selectorTheme;
    const innerWidth = width - 2;
    const lines: string[] = [];
    const side = t.border("│");
    const state = this.states[this.activeScope];

    lines.push(t.border("╭") + t.border("─".repeat(innerWidth)) + t.border("╮"));
    const title =
      this.activeView === "browse"
        ? "pi-fzf"
        : this.activeView === "review"
          ? "Selected files"
          : "Confirm insertion";
    lines.push(boxLine(` ${t.accent(t.bold(title))}`, innerWidth, side));

    if (this.activeView === "browse") {
      const projectDetails = [
        this.projectRootLocation(),
        this.includeGitIgnored ? "gitignored" : undefined,
      ].filter((detail): detail is string => detail !== undefined);
      const projectTab =
        this.activeScope === "project"
          ? t.accent(
              t.bold(
                `[ Project${projectDetails.length > 0 ? ` · ${projectDetails.join(" · ")}` : ""} ]`,
              ),
            )
          : t.dim("  Project  ");
      const globalTab =
        this.activeScope === "global"
          ? t.accent(t.bold("[ Global ]"))
          : t.dim("  Global  ");
      lines.push(
        boxLine(
          ` ${projectTab}  ${globalTab}`,
          innerWidth,
          side,
        ),
      );

      const inputLines = this.activeInput().render(Math.max(1, innerWidth - 1));
      for (const inputLine of inputLines) {
        lines.push(
          boxLine(
            ` ${inputLine}`,
            innerWidth,
            side,
          ),
        );
      }
    } else {
      const detail =
        this.activeView === "review"
          ? ` Review ${this.reviewCandidates.length} marked file(s)`
          : ` Insert ${this.pendingCandidates.length} file(s)?`;
      lines.push(boxLine(t.dim(detail), innerWidth, side));
      lines.push(boxLine("", innerWidth, side));
    }

    lines.push(t.border("├") + t.border("─".repeat(innerWidth)) + t.border("┤"));

    const body: string[] = [];
    let bodyIsFitted = false;
    if (this.activeView === "review") {
      if (this.reviewCandidates.length === 0) {
        body.push(t.muted("  No selected files"));
      } else {
        const visible = Math.min(this.maxVisible, this.reviewCandidates.length);
        const start = Math.max(
          0,
          Math.min(
            this.reviewSelectedIndex - Math.floor(visible / 2),
            this.reviewCandidates.length - visible,
          ),
        );
        for (let index = start; index < start + visible; index++) {
          const candidate = this.reviewCandidates[index];
          if (!candidate) continue;
          body.push(
            this.renderReviewEntry(
              candidate,
              index === this.reviewSelectedIndex,
              this.marked.has(candidate.absolutePath),
            ),
          );
        }
      }
    } else if (this.activeView === "confirm") {
      const visible = Math.min(this.maxVisible, this.pendingCandidates.length);
      const start = Math.max(
        0,
        Math.min(
          this.confirmSelectedIndex - Math.floor(visible / 2),
          this.pendingCandidates.length - visible,
        ),
      );
      for (let index = start; index < start + visible; index++) {
        const candidate = this.pendingCandidates[index];
        if (!candidate) continue;
        body.push(
          this.renderReviewEntry(
            candidate,
            index === this.confirmSelectedIndex,
            true,
          ),
        );
      }
    } else if (this.activeScope === "global" && innerWidth >= 60) {
      body.push(...this.renderGlobalPanes(innerWidth));
      bodyIsFitted = true;
    } else if (state.status === "loading" || state.status === "idle") {
      body.push(t.muted("  Loading…"));
    } else if (state.status === "error") {
      body.push(t.muted("  Error"));
      for (const line of (state.error ?? "Unknown error").split(/\r?\n/)) {
        body.push(t.muted(`  ${sanitizeDisplayText(line)}`));
      }
    } else if (this.filtered.length === 0) {
      body.push(t.muted("  No matches"));
    } else {
      const visible = Math.min(this.maxVisible, this.filtered.length);
      const selectedIndex = this.selectedIndex();
      const start = Math.max(
        0,
        Math.min(
          selectedIndex - Math.floor(visible / 2),
          this.filtered.length - visible,
        ),
      );
      for (let index = start; index < start + visible; index++) {
        const entry = this.filtered[index];
        if (!entry) continue;
        body.push(this.renderEntry(entry, index === selectedIndex));
      }
    }

    while (body.length < this.maxVisible) body.push("");
    for (const bodyLine of body.slice(0, this.maxVisible)) {
      lines.push(
        bodyIsFitted
          ? side + bodyLine + side
          : boxLine(bodyLine, innerWidth, side),
      );
    }

    let status: string;
    if (this.activeView === "review") {
      status = ` Review · ${this.marked.size}/${this.reviewCandidates.length} selected`;
    } else if (this.activeView === "confirm") {
      status = ` Confirm · ${this.pendingCandidates.length} selected`;
    } else {
      const total = state.status === "ready" ? this.filtered.length : 0;
      const position = total > 0 ? `${this.selectedIndex() + 1}/${total}` : "0/0";
      let scopeLabel: string;
      if (this.activeScope === "global" && state.directory) {
        scopeLabel = `Global · ${formatHomePath(state.directory)}`;
      } else {
        scopeLabel = "Project";
        const projectLocation = this.projectRootLocation();
        if (projectLocation) scopeLabel += ` · ${projectLocation}`;
        if (this.includeGitIgnored) scopeLabel += " · gitignored shown";
      }
      let markedSummary = "0 selected";
      if (this.marked.size > 0) {
        const markedPaths: string[] = [];
        for (const candidate of this.marked.values()) {
          markedPaths.push(sanitizeDisplayText(candidate.referencePath));
          if (markedPaths.length === 2) break;
        }
        markedSummary = `${this.marked.size} selected: ${markedPaths.join(", ")}${this.marked.size > 2 ? ", …" : ""}`;
      }
      status = ` ${scopeLabel} · ${position} · ${markedSummary}`;
    }
    lines.push(
      boxLine(t.dim(status), innerWidth, side),
    );

    const { up, down, enter, escape } = this.keyLabels;
    let help: string;
    if (this.activeView === "review") {
      help = ` ${up}${down} nav · space toggle · tab toggle/move · ctrl+a all · ctrl+x none · ${enter} continue · ctrl+s/${escape} back`;
    } else if (this.activeView === "confirm") {
      help = ` ${up}${down} inspect · ${enter} confirm insert · ${escape} back`;
    } else if (this.activeScope === "global") {
      help = ` ctrl+h/←/⌫ up · ctrl+l/→ open · ${up}${down} move · tab mark · ${enter} continue · ${escape} cancel`;
    } else {
      help = ` ctrl+h/←/⌫ up · ctrl+l/→ open · ctrl+g gitignored · ${up}${down} move · tab mark · ${enter} select · ${escape} cancel`;
    }
    lines.push(
      boxLine(t.dim(help), innerWidth, side),
    );
    lines.push(t.border("╰") + t.border("─".repeat(innerWidth)) + t.border("╯"));

    if (
      this.activeView === "browse" &&
      this.activeScope === "project" &&
      state.status === "ready" &&
      !state.fzf &&
      this.activeInput().getValue() === ""
    ) {
      this.scheduleProjectIndexPreparation();
    }

    this.renderCache = { width, lines };
    return lines;
  }
  override invalidate(): void {
    this.renderCache = undefined;
    super.invalidate();
    for (const input of this.projectInputs.values()) input.invalidate();
    for (const input of this.globalInputs.values()) input.invalidate();
  }

  dispose(): void {
    this.disposed = true;
    this.cancelProjectIndexPreparation();
    for (const candidates of this.indexedProjectCandidates) {
      projectIndexes.delete(candidates);
    }
    this.indexedProjectCandidates.clear();
    this.states.project.fzf = undefined;
  }
}

function fitLine(content: string, width: number): string {
  return truncateToWidth(content, width, "", true);
}

function boxLine(content: string, width: number, side: string): string {
  return side + fitLine(content, width) + side;
}

function sanitizeDisplayCharacter(character: string): string {
  if (character === "\t") return "  ";
  if (character === "\n") return "␤";
  if (character === "\r") return "␍";
  if (character === "\x1b") return "␛";

  const codePoint = character.codePointAt(0) ?? 0;
  if (
    codePoint < 32 ||
    codePoint === 127 ||
    (codePoint >= 128 && codePoint <= 159)
  ) {
    return "�";
  }
  return character;
}

function sanitizeDisplayText(value: string): string {
  return Array.from(value, sanitizeDisplayCharacter).join("");
}

function substringPositions(text: string, normalizedQuery: string): Set<number> {
  const start = text.toLocaleLowerCase().indexOf(normalizedQuery);
  if (start < 0) return new Set<number>();
  const positions = new Set<number>();
  for (let index = 0; index < normalizedQuery.length; index += 1) {
    positions.add(start + index);
  }
  return positions;
}

function highlightMatches(
  text: string,
  positions: ReadonlySet<number>,
  highlight: (text: string) => string,
  startOffset = 0,
): string {
  if (positions.size === 0) return sanitizeDisplayText(text);
  let result = "";
  let plain = "";
  let matchedText = "";
  let offset = startOffset;
  for (const character of Array.from(text)) {
    let matched = false;
    for (let index = offset; index < offset + character.length; index++) {
      if (positions.has(index)) {
        matched = true;
        break;
      }
    }
    const displayCharacter = sanitizeDisplayCharacter(character);
    if (matched) {
      if (plain) {
        result += plain;
        plain = "";
      }
      matchedText += displayCharacter;
    } else {
      if (matchedText) {
        result += highlight(matchedText);
        matchedText = "";
      }
      plain += displayCharacter;
    }
    offset += character.length;
  }
  return result + plain + (matchedText ? highlight(matchedText) : "");
}
