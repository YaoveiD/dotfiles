import { performance } from "node:perf_hooks";
import { matchesKey, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import type { FileCandidate } from "./model.js";
import { loadConfig } from "./config.js";
import {
  ProjectSearchController,
  type ProjectCacheEntry,
} from "./project-search.js";
import { parseFdOutput } from "./scanner.js";
import {
  FileSelector,
  type KeybindingsLike,
  type SelectorTheme,
} from "./selector.js";

const DYNAMIC_COUNT = 2_000;
const PRELOAD_COUNT = 10_000;
const QUERIES = ["s", "se", "sel", "sele", "select"] as const;
const DEFAULT_DEBOUNCE_MS = loadConfig(
  "/missing/pi-fzf-performance.json",
  "/home/test",
).config.search.debounceMs;

const keyMap: Record<string, string> = {
  "tui.select.up": "up",
  "tui.select.down": "down",
  "tui.select.pageUp": "pageUp",
  "tui.select.pageDown": "pageDown",
  "tui.select.confirm": "enter",
  "tui.select.cancel": "escape",
};

const keybindings: KeybindingsLike = {
  matches: (data, action) =>
    keyMap[action] ? matchesKey(data, keyMap[action] as never) : false,
  getKeys: (action) => (keyMap[action] ? [keyMap[action]] : []),
};

const color = (code: number) => (text: string): string =>
  `\x1b[${code}m${text}\x1b[39m`;
const theme: SelectorTheme = {
  accent: color(36),
  muted: color(90),
  dim: color(2),
  match: (text) => `\x1b[33;1m${text}\x1b[22;39m`,
  border: color(34),
  bold: (text) => `\x1b[1m${text}\x1b[22m`,
};

function makeCandidates(
  count: number,
  allMatch: boolean,
  matchingFlavor = "searchable-selector-controller",
): FileCandidate[] {
  return Array.from({ length: count }, (_, index) => {
    const group = index % 257;
    const flavor = allMatch || index % 3 !== 0
      ? matchingFlavor
      : index % 3 === 0
        ? "render-engine"
        : "scanner-cache";
    const suffix = index % 37 === 0 ? "-résumé with space" : "";
    const displayPath = `packages/feature-${group}/src/components/${flavor}/very-long-file-${index}${suffix}.test.ts`;
    return {
      scope: "project",
      absolutePath: `/repo/${displayPath}`,
      displayPath,
      referencePath: displayPath,
      isDirectory: false,
    };
  });
}

function makeGlobalCandidates(
  directory: string,
  count: number,
  prefix: string,
): FileCandidate[] {
  return Array.from({ length: count }, (_, index) => {
    const displayPath = `${prefix}-${index}/`;
    return {
      scope: "global",
      absolutePath: `${directory}/${displayPath.slice(0, -1)}`,
      displayPath,
      referencePath: `~/${displayPath}`,
      isDirectory: true,
    };
  });
}

function selector(maxVisible = 12): FileSelector {
  return new FileSelector(maxVisible, theme, keybindings);
}

function median(samples: number[]): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function measureMedian(operation: () => number, rounds = 7): number {
  operation();
  operation();
  return median(Array.from({ length: rounds }, operation));
}

async function measureMedianAsync(
  operation: () => Promise<number>,
  rounds = 5,
): Promise<number> {
  await operation();
  await operation();
  const samples: number[] = [];
  for (let round = 0; round < rounds; round += 1) {
    samples.push(await operation());
  }
  return median(samples);
}

function typeQuery(target: FileSelector, query: string): void {
  for (const character of query) target.handleInput(character);
}

function dynamicInteraction(candidates: FileCandidate[]): number {
  let elapsed = 0;
  for (const query of QUERIES) {
    const target = selector();
    target.setScopeQueryDriven("project", true);
    target.onQueryChange = () => {};
    typeQuery(target, query);

    const start = performance.now();
    target.setScopeCandidates("project", candidates);
    const lines = target.render(110);
    elapsed += performance.now() - start;

    expect(lines.join("\n")).toContain("1/2000");
    expect(lines.every((line) => visibleWidth(line) <= 110)).toBe(true);
  }
  return elapsed / QUERIES.length;
}

function preloadInteraction(candidates: FileCandidate[]): number {
  const target = selector();
  target.setScopeCandidates("project", candidates);
  let elapsed = 0;
  for (const character of "select") {
    const start = performance.now();
    target.handleInput(character);
    const lines = target.render(110);
    elapsed += performance.now() - start;
    expect(lines.every((line) => visibleWidth(line) <= 110)).toBe(true);
  }
  const rendered = target.render(110).join("\n");
  expect(rendered).toContain("1/6757");
  return elapsed / "select".length;
}

function dynamicFeedback(
  candidates: FileCandidate[],
  query = "s",
  completedCandidates = candidates,
): number {
  const target = selector();
  target.setScopeCandidates("project", candidates);
  target.setScopeQueryDriven("project", true);
  target.onQueryChange = (scope) => target.setScopeLoading(scope);

  const start = performance.now();
  typeQuery(target, query);
  let rendered = target.render(110).join("\n");
  let elapsed = performance.now() - start;

  if (rendered.includes("Loading…") || rendered.includes("No matches")) {
    const completionStart = performance.now();
    target.setScopeCandidates("project", completedCandidates);
    rendered = target.render(110).join("\n");
    elapsed += DEFAULT_DEBOUNCE_MS + performance.now() - completionStart;
  }

  expect(rendered).toContain("1/2000");
  return elapsed;
}

function completePrefixInteraction(
  candidates: FileCandidate[],
  query = "s",
): number {
  const cache = new Map<string, ProjectCacheEntry>();
  cache.set("\0false", {
    createdAt: Date.now(),
    candidates,
    complete: true,
  });
  const target = selector();
  const controller = new ProjectSearchController(
    {
      mode: "dynamic",
      maxResults: DYNAMIC_COUNT,
      debounceMs: DEFAULT_DEBOUNCE_MS,
      cacheTtlMs: 30_000,
      followSymlinks: false,
    },
    {
      parentSignal: new AbortController().signal,
      cacheKey: (query, includeGitIgnored) =>
        `${query}\0${includeGitIgnored}`,
      getCached: (key) => cache.get(key),
      setCached: (key, nextCandidates, metadata) => {
        const entry = {
          createdAt: metadata.createdAt ?? Date.now(),
          candidates: nextCandidates,
          complete: metadata.complete,
        };
        cache.set(key, entry);
        return entry;
      },
      scan: async () => candidates,
      getIncludeGitIgnored: () => false,
      onLoading: () => target.setScopeLoading("project"),
      onCandidates: (nextCandidates) =>
        target.setScopeCandidates("project", nextCandidates),
      onError: (error) => target.setScopeError("project", error),
    },
  );
  target.setScopeCandidates("project", candidates);
  target.setScopeQueryDriven("project", true);
  target.onQueryChange = (_scope, query) => controller.request(query);

  let elapsed = 0;
  let rendered = "";
  for (const character of query) {
    const start = performance.now();
    target.handleInput(character);
    rendered = target.render(110).join("\n");
    elapsed += performance.now() - start;
  }
  expect(rendered).toContain("1/2000");
  controller.dispose();
  target.dispose();
  return elapsed / query.length;
}

function exactCacheSwitchInteraction(
  currentCandidates: FileCandidate[],
  cachedCandidates: FileCandidate[],
): number {
  const cache = new Map<string, ProjectCacheEntry>();
  cache.set("s\0false", {
    createdAt: Date.now(),
    candidates: cachedCandidates,
    complete: false,
  });
  const prepared = selector();
  prepared.setScopeCandidates("project", cachedCandidates);
  prepared.handleInput("s");

  const target = selector();
  const controller = new ProjectSearchController(
    {
      mode: "dynamic",
      maxResults: DYNAMIC_COUNT,
      debounceMs: DEFAULT_DEBOUNCE_MS,
      cacheTtlMs: 30_000,
      followSymlinks: false,
    },
    {
      parentSignal: new AbortController().signal,
      cacheKey: (query, includeGitIgnored) =>
        `${query}\0${includeGitIgnored}`,
      getCached: (key) => cache.get(key),
      setCached: (key, nextCandidates, metadata) => {
        const entry = {
          createdAt: metadata.createdAt ?? Date.now(),
          candidates: nextCandidates,
          complete: metadata.complete,
        };
        cache.set(key, entry);
        return entry;
      },
      scan: async () => cachedCandidates,
      getIncludeGitIgnored: () => false,
      onLoading: () => target.setScopeLoading("project"),
      onCandidates: (nextCandidates) =>
        target.setScopeCandidates("project", nextCandidates),
      onError: (error) => target.setScopeError("project", error),
    },
  );
  target.setScopeCandidates("project", currentCandidates);
  target.setScopeQueryDriven("project", true);
  target.onQueryChange = (_scope, query) => controller.request(query);

  const start = performance.now();
  target.handleInput("s");
  const rendered = target.render(110).join("\n");
  const elapsed = performance.now() - start;
  expect(rendered).toContain("1/2000");
  controller.dispose();
  target.dispose();
  prepared.dispose();
  return elapsed;
}

describe("pi-fzf representative performance", () => {
  it("measures production search and render paths", async () => {
    const dynamicCandidates = makeCandidates(DYNAMIC_COUNT, true);
    const cachedDynamicCandidates = makeCandidates(DYNAMIC_COUNT, true);
    const unseenCandidates = makeCandidates(
      DYNAMIC_COUNT,
      true,
      "query-target",
    );
    const preloadCandidates = makeCandidates(PRELOAD_COUNT, false);

    const dynamicMs = measureMedian(() =>
      dynamicInteraction(dynamicCandidates),
    );
    const preloadMs = measureMedian(() =>
      preloadInteraction(preloadCandidates),
    );
    const feedbackMs = measureMedian(
      () =>
        (dynamicFeedback(dynamicCandidates) +
          dynamicFeedback(dynamicCandidates, "q", unseenCandidates)) /
        2,
    );
    const completePrefixMs = measureMedian(() =>
      completePrefixInteraction(dynamicCandidates),
    );
    const repeatedCompletePrefixMs = measureMedian(() =>
      completePrefixInteraction(dynamicCandidates, "select"),
    );
    const exactCacheSwitchMs = measureMedian(() =>
      exactCacheSwitchInteraction(
        dynamicCandidates,
        cachedDynamicCandidates,
      ),
    );

    const openMs = measureMedian(() => {
      const target = selector();
      const start = performance.now();
      target.setScopeCandidates("project", preloadCandidates);
      target.render(110);
      return performance.now() - start;
    });

    const coldOpenMs = measureMedian(() => {
      const coldCandidates = makeCandidates(PRELOAD_COUNT, false);
      const target = selector();
      const start = performance.now();
      target.setScopeCandidates("project", coldCandidates);
      target.render(110);
      const elapsed = performance.now() - start;
      target.dispose();
      return elapsed;
    }, 5);

    const coldFirstKeyMs = measureMedian(() => {
      const coldCandidates = makeCandidates(PRELOAD_COUNT, false);
      const target = selector();
      target.setScopeCandidates("project", coldCandidates);
      target.render(110);
      const start = performance.now();
      target.handleInput("s");
      target.render(110);
      const elapsed = performance.now() - start;
      target.dispose();
      return elapsed;
    }, 5);

    const deferredFirstKeyMs = await measureMedianAsync(async () => {
      const coldCandidates = makeCandidates(PRELOAD_COUNT, false);
      const target = selector();
      target.setScopeCandidates("project", coldCandidates);
      target.render(110);
      await new Promise((resolve) => setTimeout(resolve, 0));
      const start = performance.now();
      target.handleInput("s");
      target.render(110);
      const elapsed = performance.now() - start;
      target.dispose();
      return elapsed;
    });

    const renderedTarget = selector();
    renderedTarget.setScopeCandidates("project", dynamicCandidates);
    typeQuery(renderedTarget, "select");
    renderedTarget.render(110);
    const rerenderUs = measureMedian(() => {
      const start = performance.now();
      for (let index = 0; index < 100; index += 1) {
        renderedTarget.render(110);
      }
      return ((performance.now() - start) * 1_000) / 100;
    });

    const globalRoot = "/home/test";
    const currentDirectory = `${globalRoot}/current`;
    const rootCandidates = makeGlobalCandidates(globalRoot, 1_000, "root");
    rootCandidates[500] = {
      scope: "global",
      absolutePath: currentDirectory,
      displayPath: "current/",
      referencePath: "~/current/",
      isDirectory: true,
    };
    const currentCandidates = makeGlobalCandidates(
      currentDirectory,
      1_000,
      "child",
    );
    const previewCandidates = makeGlobalCandidates(
      currentCandidates[0]!.absolutePath,
      1_000,
      "preview",
    );
    const globalTarget = selector();
    globalTarget.setGlobalRoot(globalRoot);
    globalTarget.setGlobalDirectoryCandidates(globalRoot, rootCandidates);
    globalTarget.setGlobalDirectoryLoading(currentDirectory);
    globalTarget.setGlobalDirectoryCandidates(
      currentDirectory,
      currentCandidates,
    );
    globalTarget.setGlobalPreviewCandidates(
      currentCandidates[0]!.absolutePath,
      previewCandidates,
    );
    globalTarget.handleInput("]");
    globalTarget.render(120);
    const globalRenderUs = measureMedian(() => {
      const start = performance.now();
      for (let index = 0; index < 100; index += 1) {
        globalTarget.render(120);
      }
      return ((performance.now() - start) * 1_000) / 100;
    });

    const globalFilterMs = measureMedian(() => {
      const target = selector();
      target.setGlobalRoot(currentDirectory);
      target.setGlobalDirectoryCandidates(
        currentDirectory,
        currentCandidates,
      );
      target.handleInput("]");
      const start = performance.now();
      typeQuery(target, "999");
      const rendered = target.render(120).join("\n");
      const elapsed = performance.now() - start;
      expect(rendered).toContain("child-999/");
      return elapsed / 3;
    });

    const fdOutput = `${preloadCandidates
      .map((candidate) => `./${candidate.displayPath}`)
      .join("\0")}\0`;
    const parseMs = measureMedian(() => {
      const start = performance.now();
      const parsed = parseFdOutput(fdOutput, "/repo", "project");
      expect(parsed).toHaveLength(PRELOAD_COUNT);
      return performance.now() - start;
    });

    const interactionMs = (dynamicMs + preloadMs + feedbackMs) / 3;
    console.log(`METRIC interaction_ms=${interactionMs.toFixed(4)}`);
    console.log(`METRIC dynamic_ms=${dynamicMs.toFixed(4)}`);
    console.log(`METRIC preload_ms=${preloadMs.toFixed(4)}`);
    console.log(`METRIC feedback_ms=${feedbackMs.toFixed(4)}`);
    console.log(
      `METRIC complete_prefix_pipeline_ms=${completePrefixMs.toFixed(4)}`,
    );
    console.log(
      `METRIC repeated_complete_prefix_ms=${repeatedCompletePrefixMs.toFixed(4)}`,
    );
    console.log(
      `METRIC exact_cache_switch_ms=${exactCacheSwitchMs.toFixed(4)}`,
    );
    console.log(`METRIC open_ms=${openMs.toFixed(4)}`);
    console.log(`METRIC cold_open_ms=${coldOpenMs.toFixed(4)}`);
    console.log(`METRIC cold_first_key_ms=${coldFirstKeyMs.toFixed(4)}`);
    console.log(
      `METRIC deferred_first_key_ms=${deferredFirstKeyMs.toFixed(4)}`,
    );
    console.log(`METRIC rerender_us=${rerenderUs.toFixed(2)}`);
    console.log(`METRIC global_render_us=${globalRenderUs.toFixed(2)}`);
    console.log(`METRIC global_filter_ms=${globalFilterMs.toFixed(4)}`);
    console.log(`METRIC parse_ms=${parseMs.toFixed(4)}`);
  }, 30_000);
});
