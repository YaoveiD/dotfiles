import {
  mkdirSync,
  mkdtempSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listDirectory } from "./browser.js";

describe("listDirectory", () => {
  it("lists only one level with directories first", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-fzf-browser-"));
    mkdirSync(join(root, "dir", "nested"), { recursive: true });
    writeFileSync(join(root, "dir", "nested", "deep.ts"), "");
    writeFileSync(join(root, "file.ts"), "");
    writeFileSync(join(root, ".hidden"), "");

    const candidates = await listDirectory(root, []);
    expect(candidates.map((candidate) => candidate.displayPath)).toEqual([
      "dir/",
      ".hidden",
      "file.ts",
    ]);
  });

  it("excludes configured names", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-fzf-browser-"));
    mkdirSync(join(root, "node_modules"));
    writeFileSync(join(root, ".DS_Store"), "");
    writeFileSync(join(root, "keep.ts"), "");

    const candidates = await listDirectory(root, ["node_modules", ".DS_Store"]);
    expect(candidates.map((candidate) => candidate.displayPath)).toEqual([
      "keep.ts",
    ]);
  });

  it("treats directory symlinks as directories", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-fzf-browser-"));
    const target = mkdtempSync(join(tmpdir(), "pi-fzf-target-"));
    symlinkSync(target, join(root, "linked"));

    const candidates = await listDirectory(root, []);
    expect(candidates[0]?.displayPath).toBe("linked/");
    expect(candidates[0]?.isDirectory).toBe(true);
  });
});
