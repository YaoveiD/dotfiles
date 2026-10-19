import { describe, expect, it } from "vitest";
import { setCached, type CacheEntry } from "./index.js";
import type { FileCandidate } from "./model.js";

const CACHE_ENTRIES = 40;
const CANDIDATES_PER_ENTRY = 2_000;
const TTL_MS = 20;

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
    throw new Error("cache memory benchmark requires node --expose-gc");
  }
  for (let index = 0; index < 3; index += 1) globalThis.gc();
  return process.memoryUsage().heapUsed;
}

function populate(cache: Map<string, CacheEntry>): void {
  for (let batch = 0; batch < CACHE_ENTRIES; batch += 1) {
    setCached(cache, String(batch), candidates(batch), TTL_MS);
  }
}

describe("pi-fzf expired query-cache retention", () => {
  it.runIf(globalThis.gc !== undefined)(
    "measures candidates retained after their TTL passes without reads",
    async () => {
      const cache = new Map<string, CacheEntry>();
      const baseHeap = collectHeap();
      populate(cache);
      const activeHeap = collectHeap();
      await new Promise((resolve) => setTimeout(resolve, TTL_MS + 30));
      const expiredHeap = collectHeap();

      const activeMb = Math.max(0, activeHeap - baseHeap) / 1_048_576;
      const expiredMb = Math.max(0, expiredHeap - baseHeap) / 1_048_576;
      expect(cache.size).toBeLessThanOrEqual(CACHE_ENTRIES);
      expect(activeMb).toBeGreaterThan(0);
      console.log(`METRIC active_cache_mb=${activeMb.toFixed(3)}`);
      console.log(`METRIC expired_cache_mb=${expiredMb.toFixed(3)}`);
    },
    30_000,
  );
});
