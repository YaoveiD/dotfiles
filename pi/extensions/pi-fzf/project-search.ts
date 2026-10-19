import type { SearchConfig } from "./config.js";
import type { FileCandidate } from "./model.js";

export interface ProjectCacheEntry {
  createdAt: number;
  candidates: FileCandidate[];
  complete?: boolean;
}

export interface ProjectSearchDependencies {
  parentSignal: AbortSignal;
  cacheKey: (query: string, includeGitIgnored: boolean) => string;
  getCached: (key: string) => ProjectCacheEntry | undefined;
  setCached: (
    key: string,
    candidates: FileCandidate[],
    metadata: Partial<Pick<ProjectCacheEntry, "complete" | "createdAt">>,
  ) => ProjectCacheEntry;
  scan: (
    query: string,
    includeGitIgnored: boolean,
    signal: AbortSignal,
  ) => Promise<FileCandidate[]>;
  getIncludeGitIgnored: () => boolean;
  onLoading: () => void;
  onCandidates: (candidates: FileCandidate[]) => void;
  onError: (error: string) => void;
}

type ReusableProjectResult =
  | {
      effectiveQuery: string;
      cacheKey: string;
      cached: ProjectCacheEntry;
    }
  | {
      effectiveQuery: string;
      cacheKey: string;
      prefix: ProjectCacheEntry;
    };

export class ProjectSearchController {
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pendingScanKey: string | undefined;
  private pendingScanGeneration = 0;
  private abortController: AbortController | undefined;
  private activeScanKey: string | undefined;
  private activeScanGeneration = 0;

  constructor(
    private readonly config: SearchConfig,
    private readonly dependencies: ProjectSearchDependencies,
  ) {}

  request(query: string, immediate = false): boolean {
    this.generation += 1;
    const generation = this.generation;
    const includeGitIgnored = this.dependencies.getIncludeGitIgnored();
    const reusable = this.reusableResult(query, includeGitIgnored);
    const effectiveQuery = this.config.mode === "dynamic" ? query : "";
    const cacheKey = this.dependencies.cacheKey(
      effectiveQuery,
      includeGitIgnored,
    );
    if (
      !immediate &&
      !reusable &&
      this.timer &&
      this.pendingScanKey === cacheKey
    ) {
      this.pendingScanGeneration = generation;
      this.dependencies.onLoading();
      return false;
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.pendingScanKey = undefined;
    if (
      !reusable &&
      this.abortController &&
      this.activeScanKey === cacheKey
    ) {
      this.activeScanGeneration = generation;
      this.dependencies.onLoading();
      return false;
    }
    this.abortController?.abort();
    this.abortController = undefined;
    this.activeScanKey = undefined;
    if (!reusable) this.dependencies.onLoading();

    const run = () => {
      const loadGeneration =
        this.pendingScanKey === cacheKey
          ? this.pendingScanGeneration
          : generation;
      this.timer = undefined;
      this.pendingScanKey = undefined;
      void this.load(query, loadGeneration, includeGitIgnored, reusable);
    };
    if (immediate || reusable || this.config.debounceMs === 0) run();
    else {
      this.pendingScanKey = cacheKey;
      this.pendingScanGeneration = generation;
      this.timer = setTimeout(run, this.config.debounceMs);
    }
    return reusable !== undefined;
  }

  dispose(): void {
    this.generation += 1;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.pendingScanKey = undefined;
    this.abortController?.abort();
    this.abortController = undefined;
    this.activeScanKey = undefined;
  }

  private completePrefix(
    query: string,
    includeGitIgnored: boolean,
  ): ProjectCacheEntry | undefined {
    if (this.config.mode !== "dynamic") return undefined;
    for (let length = query.length - 1; length >= 0; length -= 1) {
      const cached = this.dependencies.getCached(
        this.dependencies.cacheKey(
          query.slice(0, length),
          includeGitIgnored,
        ),
      );
      if (cached?.complete) return cached;
    }
    return undefined;
  }

  private reusableResult(
    query: string,
    includeGitIgnored: boolean,
  ): ReusableProjectResult | undefined {
    const effectiveQuery = this.config.mode === "dynamic" ? query : "";
    const cacheKey = this.dependencies.cacheKey(
      effectiveQuery,
      includeGitIgnored,
    );
    const cached = this.dependencies.getCached(cacheKey);
    if (cached) return { effectiveQuery, cacheKey, cached };
    const prefix = this.completePrefix(effectiveQuery, includeGitIgnored);
    return prefix ? { effectiveQuery, cacheKey, prefix } : undefined;
  }

  private async load(
    query: string,
    generation: number,
    includeGitIgnored: boolean,
    reusable?: ReusableProjectResult,
  ): Promise<void> {
    const effectiveQuery =
      reusable?.effectiveQuery ??
      (this.config.mode === "dynamic" ? query : "");
    const cacheKey =
      reusable?.cacheKey ??
      this.dependencies.cacheKey(effectiveQuery, includeGitIgnored);
    const cached =
      reusable && "cached" in reusable
        ? reusable.cached
        : this.dependencies.getCached(cacheKey);
    if (cached) {
      this.publish(generation, cached.candidates);
      return;
    }

    const prefix =
      reusable && "prefix" in reusable
        ? reusable.prefix
        : this.completePrefix(effectiveQuery, includeGitIgnored);
    if (prefix) {
      const cached = this.dependencies.setCached(cacheKey, prefix.candidates, {
        complete: true,
        createdAt: prefix.createdAt,
      });
      this.publish(generation, cached.candidates);
      return;
    }

    const scanController = new AbortController();
    this.abortController = scanController;
    this.activeScanKey = cacheKey;
    this.activeScanGeneration = generation;
    const signal = AbortSignal.any([
      this.dependencies.parentSignal,
      scanController.signal,
    ]);
    try {
      const candidates = await this.dependencies.scan(
        effectiveQuery,
        includeGitIgnored,
        signal,
      );
      if (
        signal.aborted ||
        this.abortController !== scanController ||
        this.activeScanGeneration !== this.generation
      ) {
        return;
      }
      const cached = this.dependencies.setCached(cacheKey, candidates, {
        complete:
          this.config.maxResults === 0 ||
          candidates.length < this.config.maxResults,
      });
      this.dependencies.onCandidates(cached.candidates);
    } catch (error) {
      if (
        signal.aborted ||
        this.abortController !== scanController ||
        this.activeScanGeneration !== this.generation
      ) {
        return;
      }
      this.dependencies.onError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      if (this.abortController === scanController) {
        this.abortController = undefined;
        this.activeScanKey = undefined;
      }
    }
  }

  private publish(generation: number, candidates: FileCandidate[]): void {
    if (
      generation === this.generation &&
      !this.dependencies.parentSignal.aborted
    ) {
      this.dependencies.onCandidates(candidates);
    }
  }
}
