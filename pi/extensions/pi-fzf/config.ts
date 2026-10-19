import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export const DEFAULT_GLOBAL_ROOT = "~/repos";
export const DEFAULT_CONFIG_PATH = join(homedir(), ".pi", "agent", "pi-fzf.json");

export type ProjectSearchMode = "dynamic" | "preload";

export interface SearchConfig {
  mode: ProjectSearchMode;
  maxResults: number;
  debounceMs: number;
  cacheTtlMs: number;
  followSymlinks: boolean;
}

export interface PiFzfConfig {
  globalRoot: string;
  search: SearchConfig;
}

export interface LoadedConfig {
  config: PiFzfConfig;
  warning?: string;
}

const DEFAULT_SEARCH: SearchConfig = {
  mode: "dynamic",
  maxResults: 2_000,
  debounceMs: 30,
  cacheTtlMs: 30_000,
  followSymlinks: false,
};

export function resolveGlobalRoot(value: string, home = homedir()): string {
  const root = value.trim();
  if (!root) throw new Error("globalRoot must not be empty");
  if (root === "~") return home;
  if (root.startsWith("~/")) return resolve(home, root.slice(2));
  if (root.startsWith("~")) {
    throw new Error("globalRoot only supports ~ or ~/...");
  }
  return isAbsolute(root) ? resolve(root) : resolve(home, root);
}

function numberOption(
  value: unknown,
  fallback: number,
  name: string,
  minimum: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || (value as number) < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}`);
  }
  return value as number;
}

function booleanOption(
  value: unknown,
  fallback: boolean,
  name: string,
): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error(`${name} must be a boolean`);
  return value;
}

export function loadConfig(
  configPath = DEFAULT_CONFIG_PATH,
  home = homedir(),
): LoadedConfig {
  const fallback: PiFzfConfig = {
    globalRoot: resolveGlobalRoot(DEFAULT_GLOBAL_ROOT, home),
    search: { ...DEFAULT_SEARCH },
  };
  if (!existsSync(configPath)) return { config: fallback };

  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as {
      globalRoot?: unknown;
      search?: unknown;
    };
    if (parsed.globalRoot !== undefined && typeof parsed.globalRoot !== "string") {
      throw new Error("globalRoot must be a string");
    }
    if (
      parsed.search !== undefined &&
      (typeof parsed.search !== "object" || parsed.search === null)
    ) {
      throw new Error("search must be an object");
    }
    const search = (parsed.search ?? {}) as Record<string, unknown>;
    const mode = search.mode ?? DEFAULT_SEARCH.mode;
    if (mode !== "dynamic" && mode !== "preload") {
      throw new Error('search.mode must be "dynamic" or "preload"');
    }
    const defaultMaxResults =
      mode === "preload" ? 0 : DEFAULT_SEARCH.maxResults;

    return {
      config: {
        globalRoot:
          parsed.globalRoot === undefined
            ? fallback.globalRoot
            : resolveGlobalRoot(parsed.globalRoot as string, home),
        search: {
          mode,
          maxResults: numberOption(
            search.maxResults,
            defaultMaxResults,
            "search.maxResults",
            0,
          ),
          debounceMs: numberOption(
            search.debounceMs,
            DEFAULT_SEARCH.debounceMs,
            "search.debounceMs",
            0,
          ),
          cacheTtlMs: numberOption(
            search.cacheTtlMs,
            DEFAULT_SEARCH.cacheTtlMs,
            "search.cacheTtlMs",
            0,
          ),
          followSymlinks: booleanOption(
            search.followSymlinks,
            DEFAULT_SEARCH.followSymlinks,
            "search.followSymlinks",
          ),
        },
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      config: fallback,
      warning: `pi-fzf: invalid ${configPath}; using defaults (${DEFAULT_GLOBAL_ROOT}; ${message})`,
    };
  }
}
