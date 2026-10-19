import { resolve } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { listDirectory } from "./browser.js";
import { loadConfig } from "./config.js";
import type { FileCandidate, PickerResult } from "./model.js";
import { formatProjectReference, formatReferences } from "./paths.js";
import { ProjectSearchController } from "./project-search.js";
import { scanRoot } from "./scanner.js";
import {
  FileSelector,
  type KeybindingsLike,
  type SelectorTheme,
} from "./selector.js";

const PROJECT_EXCLUDES = [".git"];
const GLOBAL_EXCLUDES = [
  ".git",
  "node_modules",
  "Library",
  ".cache",
  ".Trash",
  ".DS_Store",
];
const MAX_CACHE_ENTRIES = 100;

export interface CacheEntry {
  createdAt: number;
  candidates: FileCandidate[];
  complete?: boolean;
  expiryTimer?: ReturnType<typeof setTimeout>;
}

function cancelExpiry(entry: CacheEntry | undefined): void {
  if (entry?.expiryTimer) clearTimeout(entry.expiryTimer);
}

export function getCached(
  cache: Map<string, CacheEntry>,
  key: string,
  ttlMs: number,
): CacheEntry | undefined {
  if (ttlMs <= 0) return undefined;
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.createdAt > ttlMs) {
    cancelExpiry(entry);
    cache.delete(key);
    return undefined;
  }
  cache.delete(key);
  cache.set(key, entry);
  return entry;
}

export function setCached(
  cache: Map<string, CacheEntry>,
  key: string,
  candidates: FileCandidate[],
  ttlMs: number,
  metadata: Partial<Pick<CacheEntry, "complete" | "createdAt">> = {},
): CacheEntry {
  const entry: CacheEntry = {
    createdAt: metadata.createdAt ?? Date.now(),
    candidates,
    complete: metadata.complete,
  };
  if (ttlMs <= 0) return entry;
  cancelExpiry(cache.get(key));
  cache.delete(key);
  cache.set(key, entry);
  const remainingTtl = Math.max(0, ttlMs - (Date.now() - entry.createdAt));
  entry.expiryTimer = setTimeout(() => {
    if (cache.get(key) !== entry) return;
    entry.expiryTimer = undefined;
    cache.delete(key);
  }, remainingTtl);
  (entry.expiryTimer as ReturnType<typeof setTimeout> & {
    unref?: () => void;
  }).unref?.();
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    cancelExpiry(cache.get(oldest));
    cache.delete(oldest);
  }
  return entry;
}

export default function piFzf(pi: ExtensionAPI): void {
  const projectCache = new Map<string, CacheEntry>();
  const globalCache = new Map<string, CacheEntry>();
  let pickerOpen = false;

  async function openPicker(ctx: ExtensionContext): Promise<void> {
    if (ctx.mode !== "tui") {
      ctx.ui.notify("pi-fzf requires interactive mode", "error");
      return;
    }
    if (pickerOpen) return;

    pickerOpen = true;
    const controller = new AbortController();
    const loaded = loadConfig();
    let requestRender: (() => void) | undefined;
    if (loaded.warning) ctx.ui.notify(loaded.warning, "warning");

    try {
      const result = await ctx.ui.custom<PickerResult>(
        (tui, theme, keybindings, done) => {
          requestRender = () => tui.requestRender(true);
          const selectorTheme: SelectorTheme = {
            accent: (text) => theme.fg("accent", text),
            muted: (text) => theme.fg("muted", text),
            dim: (text) => theme.fg("dim", text),
            match: (text) => theme.fg("warning", theme.bold(text)),
            border: (text) => theme.fg("border", text),
            bold: (text) => theme.bold(text),
          };
          const selectorKeybindings: KeybindingsLike = {
            matches: (data, action) =>
              keybindings.matches(
                data,
                action as Parameters<typeof keybindings.matches>[1],
              ),
            getKeys: (action) =>
              keybindings.getKeys(
                action as Parameters<typeof keybindings.getKeys>[0],
              ),
          };
          const maxVisible = Math.max(
            1,
            Math.min(12, Math.floor(tui.terminal.rows * 0.9) - 8),
          );
          const selector = new FileSelector(
            maxVisible,
            selectorTheme,
            selectorKeybindings,
          );
          let projectRoot = resolve(ctx.cwd);
          selector.setProjectRoot(projectRoot);
          selector.setGlobalRoot(loaded.config.globalRoot);
          selector.setScopeQueryDriven(
            "project",
            loaded.config.search.mode === "dynamic",
          );

          let globalAbort: AbortController | undefined;
          let globalPreviewAbort: AbortController | undefined;
          let globalPreviewDirectory: string | undefined;

          const projectSearch = new ProjectSearchController(
            loaded.config.search,
            {
              parentSignal: controller.signal,
              cacheKey: (query, includeGitIgnored) =>
                [
                  projectRoot,
                  loaded.config.search.mode,
                  query,
                  loaded.config.search.maxResults,
                  loaded.config.search.followSymlinks,
                  includeGitIgnored,
                ].join("\0"),
              getCached: (key) =>
                getCached(
                  projectCache,
                  key,
                  loaded.config.search.cacheTtlMs,
                ),
              setCached: (key, candidates, metadata) =>
                setCached(
                  projectCache,
                  key,
                  candidates,
                  loaded.config.search.cacheTtlMs,
                  metadata,
                ),
              scan: async (query, includeGitIgnored, signal) => {
                const searchRoot = projectRoot;
                const candidates = await scanRoot(pi.exec.bind(pi), {
                  root: searchRoot,
                  scope: "project",
                  excludes: PROJECT_EXCLUDES,
                  signal,
                  query,
                  maxResults: loaded.config.search.maxResults,
                  followSymlinks: loaded.config.search.followSymlinks,
                  includeGitIgnored,
                });
                return candidates.map((candidate) => ({
                  ...candidate,
                  referencePath: formatProjectReference(
                    ctx.cwd,
                    candidate.absolutePath,
                    candidate.isDirectory,
                  ),
                }));
              },
              getIncludeGitIgnored: () => selector.getIncludeGitIgnored(),
              onLoading: () => selector.setScopeLoading("project"),
              onCandidates: (candidates) =>
                selector.setScopeCandidates("project", candidates),
              onError: (error) => selector.setScopeError("project", error),
            },
          );

          const requestProject = (query: string, immediate = false): boolean =>
            projectSearch.request(query, immediate);

          const readGlobalDirectory = async (
            directory: string,
            signal: AbortSignal,
          ): Promise<FileCandidate[]> => {
            const cached = getCached(
              globalCache,
              directory,
              loaded.config.search.cacheTtlMs,
            );
            if (cached) return cached.candidates;

            const candidates = await listDirectory(
              directory,
              GLOBAL_EXCLUDES,
              signal,
            );
            if (!signal.aborted) {
              setCached(
                globalCache,
                directory,
                candidates,
                loaded.config.search.cacheTtlMs,
              );
            }
            return candidates;
          };

          const loadGlobalDirectory = async (
            directory: string,
          ): Promise<void> => {
            globalAbort?.abort();
            globalAbort = new AbortController();
            const signal = AbortSignal.any([
              controller.signal,
              globalAbort.signal,
            ]);
            selector.setGlobalDirectoryLoading(directory);

            try {
              const candidates = await readGlobalDirectory(directory, signal);
              if (signal.aborted) return;
              selector.setGlobalDirectoryCandidates(directory, candidates);
            } catch (error) {
              if (signal.aborted) return;
              selector.setGlobalDirectoryError(
                directory,
                error instanceof Error ? error.message : String(error),
              );
            }
          };

          const loadGlobalPreview = async (
            directory: string,
          ): Promise<void> => {
            if (globalPreviewDirectory === directory) return;
            if (globalPreviewDirectory) {
              globalPreviewAbort?.abort();
              selector.setGlobalPreviewIdle(globalPreviewDirectory);
            }

            globalPreviewDirectory = directory;
            const previewAbort = new AbortController();
            globalPreviewAbort = previewAbort;
            const signal = AbortSignal.any([
              controller.signal,
              previewAbort.signal,
            ]);
            selector.setGlobalPreviewLoading(directory);

            try {
              const candidates = await readGlobalDirectory(directory, signal);
              if (signal.aborted) return;
              selector.setGlobalPreviewCandidates(directory, candidates);
            } catch (error) {
              if (signal.aborted) return;
              selector.setGlobalPreviewError(
                directory,
                error instanceof Error ? error.message : String(error),
              );
            } finally {
              if (globalPreviewAbort === previewAbort) {
                globalPreviewAbort = undefined;
                globalPreviewDirectory = undefined;
              }
            }
          };

          selector.onResult = done;
          selector.onProjectDirectoryRequest = (directory) => {
            projectRoot = resolve(directory);
            requestProject(selector.getQuery("project"), true);
          };
          selector.onScopeRequest = (scope) => {
            if (scope === "project") {
              requestProject(selector.getQuery("project"), true);
            } else {
              void loadGlobalDirectory(loaded.config.globalRoot);
            }
          };
          selector.onGlobalDirectoryRequest = (directory) =>
            void loadGlobalDirectory(directory);
          selector.onGlobalPreviewRequest = (directory) =>
            void loadGlobalPreview(directory);
          selector.onQueryChange = (scope, query) => {
            if (scope === "project") return requestProject(query);
            return false;
          };
          selector.onProjectIgnoreChange = () =>
            requestProject(selector.getQuery("project"), true);
          selector.onUpdate = () => tui.requestRender();
          selector.requestInitialScope();

          return {
            render: (width: number) => selector.render(width),
            invalidate: () => selector.invalidate(),
            handleInput: (data: string) => {
              selector.handleInput(data);
              tui.requestRender();
            },
            get focused() {
              return selector.focused;
            },
            set focused(value: boolean) {
              selector.focused = value;
            },
            dispose() {
              controller.abort();
              projectSearch.dispose();
              globalAbort?.abort();
              globalPreviewAbort?.abort();
              selector.dispose();
            },
          };
        },
        {
          overlay: true,
          overlayOptions: {
            anchor: "center",
            width: "78%",
            maxHeight: "90%",
          },
        },
      );

      if (result.kind === "literal-at") {
        ctx.ui.pasteToEditor("@");
      } else if (result.kind === "select") {
        ctx.ui.pasteToEditor(formatReferences(result.candidates));
      }
      requestRender?.();
    } finally {
      controller.abort();
      pickerOpen = false;
    }
  }

  pi.registerShortcut("@", {
    description: "Open floating file picker",
    handler: openPicker,
  });

  pi.registerCommand("fzf-files", {
    description: "Open floating file picker",
    handler: async (_args, ctx) => openPicker(ctx),
  });
}
