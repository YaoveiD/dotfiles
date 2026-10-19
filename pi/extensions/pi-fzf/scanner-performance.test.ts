import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scanRoot, type ExecFunction } from "./scanner.js";

let root = "";
const signal = new AbortController().signal;
const exec: ExecFunction = async () => ({
  stdout: "",
  stderr: "",
  code: 0,
});

function median(samples: number[]): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)]!;
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "pi-fzf-scanner-performance-"));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("Project root scan setup performance", () => {
  it("measures metadata work for an unfiltered initial scan", async () => {
    const samples: number[] = [];
    let lastResult = await scanRoot(exec, {
      root,
      scope: "project",
      excludes: [".git"],
      signal,
      maxResults: 2_000,
    });
    for (let round = 0; round < 15; round += 1) {
      const start = performance.now();
      lastResult = await scanRoot(exec, {
        root,
        scope: "project",
        excludes: [".git"],
        signal,
        maxResults: 2_000,
      });
      samples.push((performance.now() - start) * 1_000);
    }

    const filteredSamples: number[] = [];
    for (let round = 0; round < 15; round += 1) {
      const start = performance.now();
      await scanRoot(exec, {
        root,
        scope: "project",
        excludes: [".git"],
        signal,
        query: "selector",
        maxResults: 2_000,
      });
      filteredSamples.push((performance.now() - start) * 1_000);
    }

    expect(lastResult).toEqual([]);
    console.log(`METRIC scan_setup_us=${median(samples).toFixed(2)}`);
    console.log(
      `METRIC filtered_scan_setup_us=${median(filteredSamples).toFixed(2)}`,
    );
  });
});
