import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { FileCandidate, PickerScope } from "./model.js";

function toPosix(value: string): string {
  return sep === "\\" ? value.replaceAll("\\", "/") : value;
}

export function normalizeFdPath(value: string): {
  relativePath: string;
  isDirectory: boolean;
} | null {
  let normalized = sep === "\\" ? value.replaceAll("\\", "/") : value;
  while (normalized.startsWith("./")) normalized = normalized.slice(2);
  if (!normalized || normalized === ".") return null;

  const isDirectory = normalized.endsWith("/");
  normalized = normalized.replace(/\/+$/, "");
  if (!normalized) return null;

  return {
    relativePath: `${normalized}${isDirectory ? "/" : ""}`,
    isDirectory,
  };
}

export function formatHomePath(absolutePath: string, home = homedir()): string {
  const relativeToHome = relative(home, absolutePath);
  const isInsideHome =
    relativeToHome === "" ||
    (!relativeToHome.startsWith(`..${sep}`) &&
      relativeToHome !== ".." &&
      !isAbsolute(relativeToHome));
  return isInsideHome
    ? relativeToHome
      ? `~/${toPosix(relativeToHome)}`
      : "~"
    : toPosix(absolutePath);
}

export function createCandidate(
  root: string,
  fdPath: string,
  scope: PickerScope,
  home?: string,
): FileCandidate | null {
  return createCandidateFromAbsoluteRoot(resolve(root), fdPath, scope, home);
}

export function createCandidateFromAbsoluteRoot(
  absoluteRoot: string,
  fdPath: string,
  scope: PickerScope,
  home?: string,
): FileCandidate | null {
  const normalized = normalizeFdPath(fdPath);
  if (!normalized) return null;

  const pathWithoutSlash = normalized.isDirectory
    ? normalized.relativePath.slice(0, -1)
    : normalized.relativePath;
  const nativePath =
    sep === "\\" ? pathWithoutSlash.replaceAll("/", sep) : pathWithoutSlash;
  const absolutePath = isAbsolute(nativePath)
    ? resolve(nativePath)
    : `${absoluteRoot}${absoluteRoot.endsWith(sep) ? "" : sep}${nativePath}`;
  const referenceBase =
    scope === "project"
      ? normalized.relativePath
      : `${formatHomePath(absolutePath, home ?? homedir())}${normalized.isDirectory ? "/" : ""}`;

  return {
    scope,
    absolutePath,
    displayPath: normalized.relativePath,
    referencePath: referenceBase,
    isDirectory: normalized.isDirectory,
  };
}

export function formatProjectReference(
  root: string,
  absolutePath: string,
  isDirectory: boolean,
  home = homedir(),
): string {
  const resolvedPath = resolve(absolutePath);
  const relativePath = relative(resolve(root), resolvedPath);
  const path =
    relativePath === ""
      ? "."
      : isAbsolute(relativePath)
        ? formatHomePath(resolvedPath, home)
        : toPosix(relativePath);
  return `${path}${isDirectory && !path.endsWith("/") ? "/" : ""}`;
}

export function formatReference(path: string): string {
  if (!/[\s"\\]/.test(path)) return `@${path}`;
  const escaped = path.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return `@"${escaped}"`;
}

export function formatReferences(candidates: FileCandidate[]): string {
  const unique = new Map<string, FileCandidate>();
  for (const candidate of candidates) {
    if (!unique.has(candidate.absolutePath)) {
      unique.set(candidate.absolutePath, candidate);
    }
  }
  return `${[...unique.values()]
    .map((candidate) => formatReference(candidate.referencePath))
    .join(" ")} `;
}
