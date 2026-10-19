import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { FileCandidate } from "./model.js";
import { formatHomePath } from "./paths.js";

const naturalCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});
const exclusionSets = new WeakMap<readonly string[], ReadonlySet<string>>();

function exclusionSet(excludes: readonly string[]): ReadonlySet<string> {
  const cached = exclusionSets.get(excludes);
  if (cached) return cached;
  const created = new Set(excludes);
  exclusionSets.set(excludes, created);
  return created;
}

export async function listDirectory(
  directory: string,
  excludes: readonly string[],
  signal?: AbortSignal,
): Promise<FileCandidate[]> {
  signal?.throwIfAborted();
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to open ${directory}: ${message}`);
  }

  const excluded = exclusionSet(excludes);
  const directories: FileCandidate[] = [];
  const files: FileCandidate[] = [];
  const absoluteDirectory = resolve(directory);
  const home = homedir();
  const absolutePrefix = `${absoluteDirectory}${absoluteDirectory.endsWith(sep) ? "" : sep}`;
  const referenceDirectory = formatHomePath(absoluteDirectory, home);
  const referencePrefix = `${referenceDirectory}${referenceDirectory.endsWith("/") ? "" : "/"}`;
  const symlinkDirectories = new Set<string>();
  const includedEntries = entries.filter((entry) => !excluded.has(entry.name));
  const symlinks = includedEntries.filter(
    (entry) =>
      !entry.isDirectory() && entry.isSymbolicLink(),
  );
  await Promise.all(
    symlinks.map(async (entry) => {
      try {
        if ((await stat(join(directory, entry.name))).isDirectory()) {
          symlinkDirectories.add(entry.name);
        }
      } catch {
        // Keep broken or inaccessible symlinks selectable as files.
      }
      signal?.throwIfAborted();
    }),
  );

  for (const entry of includedEntries) {
    signal?.throwIfAborted();

    const isDirectory = entry.isDirectory() || symlinkDirectories.has(entry.name);
    const displayPath = `${entry.name}${isDirectory ? "/" : ""}`;
    const candidate: FileCandidate = {
      scope: "global",
      absolutePath: `${absolutePrefix}${entry.name}`,
      displayPath,
      referencePath: `${referencePrefix}${displayPath}`,
      isDirectory,
    };
    (isDirectory ? directories : files).push(candidate);
  }

  const compare = (left: FileCandidate, right: FileCandidate): number =>
    naturalCollator.compare(left.displayPath, right.displayPath);
  directories.sort(compare);
  files.sort(compare);
  return directories.concat(files);
}
