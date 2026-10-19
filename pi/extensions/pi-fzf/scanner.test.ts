import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildFdQuery,
  buildScopedFdQuery,
  filterCandidatesByQuery,
  parseFdOutput,
  scanRoot,
} from "./scanner.js";

const fdAvailable = spawnSync("fd", ["--version"], {
  stdio: "ignore",
}).status === 0;

describe("scanner", () => {
  it("parses null-delimited files and directories", () => {
    const result = parseFdOutput(
      "./src/\0./src/index.ts\0",
      "/home/test/project",
      "project",
    );
    expect(result.map((item) => [item.displayPath, item.isDirectory])).toEqual([
      ["src/", true],
      ["src/index.ts", false],
    ]);
  });

  it("deduplicates paths", () => {
    const result = parseFdOutput(
      "./src/index.ts\0src/index.ts\0",
      "/home/test/project",
      "project",
    );
    expect(result).toHaveLength(1);
  });
});

describe("dynamic scanner", () => {
  it("builds a fuzzy fd regex", () => {
    expect(buildFdQuery("abc")).toBe("a.*b.*c");
    expect(buildFdQuery("a.b")).toBe("a.*\\..*b");
    expect(buildFdQuery("  ")).toBeUndefined();
    expect(buildScopedFdQuery("/repo/abc-root", "needle")).toBe(
      "^/repo/abc-root[\\\\/].*n.*e.*e.*d.*l.*e",
    );
    expect(buildScopedFdQuery("/", "abc")).toBe(
      "^[\\\\/].*a.*b.*c",
    );
  });

  it("passes configurable limits and query to fd", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-fzf-scanner-"));
    let capturedArgs: string[] = [];
    const candidates = await scanRoot(
      async (_command, args) => {
        capturedArgs = args;
        return { stdout: "./abc.ts\0", stderr: "", code: 0 };
      },
      {
        root,
        scope: "project",
        excludes: [".git"],
        signal: new AbortController().signal,
        query: "abc",
        maxResults: 25,
        followSymlinks: true,
        includeGitIgnored: true,
      },
    );

    expect(candidates).toHaveLength(1);
    expect(capturedArgs).toContain("--follow");
    expect(capturedArgs).toContain("--no-ignore-vcs");
    expect(capturedArgs).toContain("--max-results");
    expect(capturedArgs).toContain("25");
    expect(capturedArgs).toContain("--full-path");
    expect(capturedArgs).toContain("--ignore-case");
    expect(capturedArgs.at(-1)).toBe(
      buildScopedFdQuery(realpathSync(root), "abc"),
    );
  });

  it("uses only the user query to select fd case sensitivity", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-fzf-scanner-"));
    let capturedArgs: string[] = [];
    await scanRoot(
      async (_command, args) => {
        capturedArgs = args;
        return { stdout: "", stderr: "", code: 0 };
      },
      {
        root,
        scope: "project",
        excludes: [".git"],
        signal: new AbortController().signal,
        query: "ABC",
      },
    );

    expect(capturedArgs).toContain("--case-sensitive");
    expect(capturedArgs).not.toContain("--ignore-case");
  });

  it("filters complete cached results with fd-compatible matching", () => {
    const candidates = parseFdOutput(
      "./src/abc.ts\0./src/alpha.ts\0./src/ABC.ts\0",
      "/repo",
      "project",
    );

    expect(
      filterCandidatesByQuery(candidates, "ac").map(
        (candidate) => candidate.displayPath,
      ),
    ).toEqual(["src/abc.ts", "src/ABC.ts"]);
    expect(
      filterCandidatesByQuery(candidates, "AC").map(
        (candidate) => candidate.displayPath,
      ),
    ).toEqual(["src/ABC.ts"]);
  });

  it.runIf(fdAvailable)("searches fd relative paths", async () => {
    const parent = mkdtempSync(join(tmpdir(), "pi-fzf-scanner-"));
    const root = join(parent, "abc-project");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "abc.ts"), "");
    writeFileSync(join(root, "src", "ABC.md"), "");
    writeFileSync(join(root, "unrelated.ts"), "");

    const candidates = await scanRoot(
      async (command, args, options) => {
        const result = spawnSync(command, args, {
          cwd: options.cwd,
          encoding: "utf8",
        });
        return {
          stdout: result.stdout ?? "",
          stderr: result.stderr ?? "",
          code: result.status ?? 1,
        };
      },
      {
        root,
        scope: "project",
        excludes: [".git"],
        signal: new AbortController().signal,
        query: "abc",
      },
    );

    expect(candidates.map((candidate) => candidate.displayPath)).toContain(
      "src/abc.ts",
    );
    expect(candidates.map((candidate) => candidate.displayPath)).toContain(
      "src/ABC.md",
    );
    expect(candidates.map((candidate) => candidate.displayPath)).not.toContain(
      "unrelated.ts",
    );
  });
});
