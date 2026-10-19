import { performance } from "node:perf_hooks";
import { matchesKey } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import type { FileCandidate } from "./model.js";
import {
  FileSelector,
  type KeybindingsLike,
  type SelectorTheme,
} from "./selector.js";

const CACHE_ENTRIES = 40;
const CANDIDATES_PER_ENTRY = 2_000;

const keybindings: KeybindingsLike = {
  matches: (data, action) =>
    action === "tui.select.confirm" && matchesKey(data, "enter"),
  getKeys: () => [],
};
const theme: SelectorTheme = {
  accent: (text) => text,
  muted: (text) => text,
  dim: (text) => text,
  match: (text) => text,
  border: (text) => text,
  bold: (text) => text,
};

function candidates(batch: number): FileCandidate[] {
  return Array.from({ length: CANDIDATES_PER_ENTRY }, (_, index) => {
    const displayPath = `packages/cache-${batch}/feature-${index % 257}/src/components/searchable-selector-controller-${index}.test.ts`;
    return {
      scope: "project",
      absolutePath: `/repo/${displayPath}`,
      displayPath,
      referencePath: displayPath,
      isDirectory: false,
    };
  });
}

function collectHeap(): number {
  if (!globalThis.gc) {
    throw new Error("memory benchmark requires node --expose-gc");
  }
  for (let index = 0; index < 3; index += 1) globalThis.gc();
  return process.memoryUsage().heapUsed;
}

describe("pi-fzf prepared-index retention", () => {
  it.runIf(globalThis.gc !== undefined)(
    "measures indexes retained while query candidates remain cached",
    () => {
      const cachedCandidates = Array.from(
        { length: CACHE_ENTRIES },
        (_, batch) => candidates(batch),
      );
      const baseHeap = collectHeap();

      let target: FileSelector | undefined = new FileSelector(
        12,
        theme,
        keybindings,
      );
      target.handleInput("x");
      const buildStart = performance.now();
      for (const entry of cachedCandidates) {
        target.setScopeCandidates("project", entry);
      }
      const buildMs = performance.now() - buildStart;
      const indexedHeap = collectHeap();

      target.dispose();
      target = undefined;
      const retainedHeap = collectHeap();

      const indexMb = (indexedHeap - baseHeap) / 1_048_576;
      const retainedMb = Math.max(0, retainedHeap - baseHeap) / 1_048_576;
      expect(cachedCandidates).toHaveLength(CACHE_ENTRIES);
      expect(retainedMb).toBeLessThan(indexMb + 1);

      console.log(`METRIC retained_mb=${retainedMb.toFixed(3)}`);
      console.log(`METRIC index_mb=${indexMb.toFixed(3)}`);
      console.log(`METRIC index_build_ms=${buildMs.toFixed(3)}`);
    },
    30_000,
  );
});
