import { realpath, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { FileCandidate, PickerScope } from "./model.js";
import { createCandidateFromAbsoluteRoot } from "./paths.js";

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
  killed?: boolean;
}

export type ExecFunction = (
  command: string,
  args: string[],
  options: { cwd: string; signal: AbortSignal },
) => Promise<ExecResult>;

export interface ScanOptions {
  root: string;
  scope: PickerScope;
  excludes: string[];
  signal: AbortSignal;
  query?: string;
  maxResults?: number;
  followSymlinks?: boolean;
  includeGitIgnored?: boolean;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isCaseSensitiveQuery(query: string): boolean {
  return query.toLocaleLowerCase() !== query;
}

export function buildFdQuery(query: string): string | undefined {
  const trimmed = query.trim();
  const normalized = sep === "\\" ? trimmed.replaceAll("\\", "/") : trimmed;
  if (!normalized) return undefined;

  return Array.from(normalized)
    .map((character) =>
      character === "/" ? "[\\\\/]" : escapeRegex(character),
    )
    .join(".*");
}

export function buildScopedFdQuery(
  canonicalRoot: string,
  query: string,
): string | undefined {
  const fuzzyQuery = buildFdQuery(query);
  if (!fuzzyQuery) return undefined;
  const normalizedRoot = (
    sep === "\\" ? canonicalRoot.replaceAll("\\", "/") : canonicalRoot
  ).replace(/[\\/]+$/, "");
  return `^${escapeRegex(normalizedRoot)}[\\\\/].*${fuzzyQuery}`;
}

export function filterCandidatesByQuery(
  candidates: FileCandidate[],
  query: string,
): FileCandidate[] {
  const pattern = buildFdQuery(query);
  if (!pattern) return candidates;
  const matcher = new RegExp(
    pattern,
    isCaseSensitiveQuery(query) ? "u" : "iu",
  );
  return candidates.filter((candidate) => matcher.test(candidate.displayPath));
}

export function parseFdOutput(
  output: string,
  root: string,
  scope: PickerScope,
): FileCandidate[] {
  const candidates: FileCandidate[] = [];
  const seen = new Set<string>();
  const absoluteRoot = resolve(root);

  let start = 0;
  while (start < output.length) {
    const end = output.indexOf("\0", start);
    const entry = output.slice(start, end < 0 ? output.length : end);
    const candidate = createCandidateFromAbsoluteRoot(
      absoluteRoot,
      entry,
      scope,
    );
    if (candidate && !seen.has(candidate.displayPath)) {
      seen.add(candidate.displayPath);
      candidates.push(candidate);
    }
    if (end < 0) break;
    start = end + 1;
  }

  return candidates;
}

export async function scanRoot(
  exec: ExecFunction,
  options: ScanOptions,
): Promise<FileCandidate[]> {
  const rawQuery = options.query ?? "";
  const hasQuery = rawQuery.trim().length > 0;
  let rootStats;
  let canonicalResult: PromiseSettledResult<string> | undefined;
  if (hasQuery) {
    const [rootResult, resolvedCanonicalResult] = await Promise.allSettled([
      stat(options.root),
      realpath(options.root),
    ]);
    if (rootResult.status === "rejected") {
      throw new Error(`Root not found: ${options.root}`);
    }
    rootStats = rootResult.value;
    canonicalResult = resolvedCanonicalResult;
  } else {
    try {
      rootStats = await stat(options.root);
    } catch {
      throw new Error(`Root not found: ${options.root}`);
    }
  }
  if (!rootStats.isDirectory()) {
    throw new Error(`Root is not a directory: ${options.root}`);
  }
  if (canonicalResult?.status === "rejected") throw canonicalResult.reason;

  const args = [
    "--type",
    "f",
    "--type",
    "d",
    "--hidden",
    "--color",
    "never",
    "--print0",
  ];
  if (options.followSymlinks) args.push("--follow");
  if (options.includeGitIgnored) args.push("--no-ignore-vcs");
  if ((options.maxResults ?? 0) > 0) {
    args.push("--max-results", String(options.maxResults));
  }
  for (const exclude of options.excludes) {
    args.push("--exclude", exclude);
  }

  const query = canonicalResult
    ? buildScopedFdQuery(canonicalResult.value, rawQuery)
    : undefined;
  if (query) {
    args.push(
      isCaseSensitiveQuery(rawQuery) ? "--case-sensitive" : "--ignore-case",
      "--full-path",
      query,
    );
  }

  let result: ExecResult;
  try {
    result = await exec("fd", args, {
      cwd: options.root,
      signal: options.signal,
    });
  } catch (error) {
    if (options.signal.aborted) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to run fd: ${message}`);
  }

  if (options.signal.aborted) throw new Error("Scan cancelled");
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout).trim();
    throw new Error(
      detail ? `fd failed: ${detail}` : `fd failed with exit ${result.code}`,
    );
  }

  return parseFdOutput(result.stdout, options.root, options.scope);
}
