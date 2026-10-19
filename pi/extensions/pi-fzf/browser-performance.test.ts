import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listDirectory } from "./browser.js";

const ENTRY_COUNT = 1_000;
const SYMLINK_COUNT = 50;
let root = "";
const GLOBAL_EXCLUDES = [
  ".git",
  "node_modules",
  "Library",
  ".cache",
  ".Trash",
  ".DS_Store",
];

const signal = new AbortController().signal;
function median(samples: number[]): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)]!;
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "pi-fzf-browser-performance-"));
  for (let index = 0; index < ENTRY_COUNT / 2; index += 1) {
    mkdirSync(join(root, `project-${index}`));
    writeFileSync(join(root, `notes-${index}.txt`), "");
  }
  for (let index = 0; index < SYMLINK_COUNT; index += 1) {
    symlinkSync("notes-0.txt", join(root, `shortcut-${index}`));
  }
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("pi-fzf Global directory performance", () => {
  it("measures one-level candidate construction and natural sorting", async () => {
    const samples: number[] = [];
    let lastResult = await listDirectory(root, GLOBAL_EXCLUDES, signal);
    for (let round = 0; round < 9; round += 1) {
      const start = performance.now();
      lastResult = await listDirectory(root, GLOBAL_EXCLUDES, signal);
      samples.push(performance.now() - start);
    }

    expect(lastResult).toHaveLength(ENTRY_COUNT + SYMLINK_COUNT);
    expect(lastResult[0]?.displayPath).toBe("project-0/");
    expect(lastResult[2]?.displayPath).toBe("project-2/");
    expect(lastResult[10]?.displayPath).toBe("project-10/");
    expect(lastResult[ENTRY_COUNT / 2]?.displayPath).toBe("notes-0.txt");

    console.log(`METRIC browse_ms=${median(samples).toFixed(4)}`);
  }, 30_000);
});
