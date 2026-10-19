import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import type { SearchConfig } from "./config.js";
import type { FileCandidate } from "./model.js";
import {
  ProjectSearchController,
  type ProjectCacheEntry,
} from "./project-search.js";

const config: SearchConfig = {
  mode: "dynamic",
  maxResults: 2_000,
  debounceMs: 30,
  cacheTtlMs: 30_000,
  followSymlinks: false,
};
const candidate: FileCandidate = {
  scope: "project",
  absolutePath: "/repo/alpha.ts",
  displayPath: "alpha.ts",
  referencePath: "alpha.ts",
  isDirectory: false,
};

function median(samples: number[]): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)]!;
}

async function cachedFeedback(
  seedQuery: string,
  requestQuery: string,
): Promise<{ elapsed: number; scans: number }> {
  const cache = new Map<string, ProjectCacheEntry>();
  let scans = 0;
  let resolveCandidates: (() => void) | undefined;
  const nextCandidates = () =>
    new Promise<void>((resolve) => {
      resolveCandidates = resolve;
    });
  const controller = new ProjectSearchController(config, {
    parentSignal: new AbortController().signal,
    cacheKey: (query, includeGitIgnored) =>
      `${query}\0${includeGitIgnored}`,
    getCached: (key) => cache.get(key),
    setCached: (key, candidates, metadata) => {
      const entry = {
        candidates,
        createdAt: metadata.createdAt ?? Date.now(),
        complete: metadata.complete,
      };
      cache.set(key, entry);
      return entry;
    },
    scan: async () => {
      scans += 1;
      return [candidate];
    },
    getIncludeGitIgnored: () => false,
    onLoading: () => {},
    onCandidates: () => resolveCandidates?.(),
    onError: (error) => {
      throw new Error(error);
    },
  });

  let completed = nextCandidates();
  controller.request(seedQuery, true);
  await completed;

  completed = nextCandidates();
  const start = performance.now();
  controller.request(requestQuery);
  await completed;
  const elapsed = performance.now() - start;
  controller.dispose();
  return { elapsed, scans };
}

async function pendingDuplicateFeedback(): Promise<{
  elapsed: number;
  scans: number;
}> {
  let scans = 0;
  let resolveCandidates: (() => void) | undefined;
  const completed = new Promise<void>((resolve) => {
    resolveCandidates = resolve;
  });
  const controller = new ProjectSearchController(config, {
    parentSignal: new AbortController().signal,
    cacheKey: (query) => query,
    getCached: () => undefined,
    setCached: (_key, candidates, metadata) => ({
      candidates,
      createdAt: Date.now(),
      complete: metadata.complete,
    }),
    scan: async () => {
      scans += 1;
      return [candidate];
    },
    getIncludeGitIgnored: () => false,
    onLoading: () => {},
    onCandidates: () => resolveCandidates?.(),
    onError: (error) => {
      throw new Error(error);
    },
  });

  const start = performance.now();
  controller.request("alpha");
  await new Promise((resolve) => setTimeout(resolve, 20));
  controller.request("alpha");
  await completed;
  const elapsed = performance.now() - start;
  controller.dispose();
  return { elapsed, scans };
}

describe("Project search request performance", () => {
  it("measures cached feedback while preserving debounce coalescing", async () => {
    const exactSamples: number[] = [];
    const prefixSamples: number[] = [];
    for (let round = 0; round < 7; round += 1) {
      const exact = await cachedFeedback("alpha", "alpha");
      exactSamples.push(exact.elapsed);
      expect(exact.scans).toBe(1);
      const prefix = await cachedFeedback("", "alpha");
      prefixSamples.push(prefix.elapsed);
      expect(prefix.scans).toBe(1);
    }

    const pendingSamples: number[] = [];
    for (let round = 0; round < 5; round += 1) {
      const pending = await pendingDuplicateFeedback();
      pendingSamples.push(pending.elapsed);
      expect(pending.scans).toBe(1);
    }

    let rapidScans = 0;
    const rapidController = new ProjectSearchController(config, {
      parentSignal: new AbortController().signal,
      cacheKey: (query) => query,
      getCached: () => undefined,
      setCached: (_key, candidates, metadata) => ({
        candidates,
        createdAt: Date.now(),
        complete: metadata.complete,
      }),
      scan: async () => {
        rapidScans += 1;
        return [candidate];
      },
      getIncludeGitIgnored: () => false,
      onLoading: () => {},
      onCandidates: () => {},
      onError: (error) => {
        throw new Error(error);
      },
    });
    rapidController.request("a");
    rapidController.request("al");
    rapidController.request("alpha");
    await new Promise((resolve) =>
      setTimeout(resolve, config.debounceMs + 10),
    );
    rapidController.dispose();
    expect(rapidScans).toBe(1);

    console.log(
      `METRIC cache_feedback_ms=${median(exactSamples).toFixed(4)}`,
    );
    console.log(
      `METRIC prefix_feedback_ms=${median(prefixSamples).toFixed(4)}`,
    );
    console.log(
      `METRIC pending_duplicate_ms=${median(pendingSamples).toFixed(4)}`,
    );
  }, 30_000);
  it("measures duplicate in-flight query process starts", async () => {
    const resolvers: Array<(candidates: FileCandidate[]) => void> = [];
    const published: string[] = [];
    const controller = new ProjectSearchController(config, {
      parentSignal: new AbortController().signal,
      cacheKey: (query) => query,
      getCached: () => undefined,
      setCached: (_key, candidates, metadata) => ({
        candidates,
        createdAt: Date.now(),
        complete: metadata.complete,
      }),
      scan: () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
      getIncludeGitIgnored: () => false,
      onLoading: () => {},
      onCandidates: (candidates) =>
        published.push(candidates[0]?.displayPath ?? "empty"),
      onError: (error) => {
        throw new Error(error);
      },
    });

    controller.request("alpha", true);
    controller.request("alpha", true);
    console.log(`METRIC duplicate_starts=${resolvers.length}`);
    expect(resolvers.length).toBeGreaterThanOrEqual(1);
    for (const resolve of resolvers) resolve([candidate]);
    await Promise.resolve();
    await Promise.resolve();
    controller.dispose();
    expect(published).toEqual(["alpha.ts"]);
  });

  it("suppresses stale scan completion after cancellation", async () => {
    const resolvers: Array<(candidates: FileCandidate[]) => void> = [];
    const published: string[] = [];
    const controller = new ProjectSearchController(config, {
      parentSignal: new AbortController().signal,
      cacheKey: (query) => query,
      getCached: () => undefined,
      setCached: (_key, candidates, metadata) => ({
        candidates,
        createdAt: Date.now(),
        complete: metadata.complete,
      }),
      scan: () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
      getIncludeGitIgnored: () => false,
      onLoading: () => {},
      onCandidates: (candidates) =>
        published.push(candidates[0]?.displayPath ?? "empty"),
      onError: (error) => {
        throw new Error(error);
      },
    });

    controller.request("first", true);
    controller.request("second", true);
    expect(resolvers).toHaveLength(2);
    resolvers[0]!([{ ...candidate, displayPath: "first.ts" }]);
    resolvers[1]!([{ ...candidate, displayPath: "second.ts" }]);
    await Promise.resolve();
    await Promise.resolve();
    controller.dispose();
    expect(published).toEqual(["second.ts"]);
  });
});
