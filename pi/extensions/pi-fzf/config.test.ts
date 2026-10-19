import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_GLOBAL_ROOT,
  loadConfig,
  resolveGlobalRoot,
} from "./config.js";

describe("config", () => {
  it("defaults to ~/repos", () => {
    const home = "/home/test";
    const loaded = loadConfig("/missing/pi-fzf.json", home);
    expect(loaded.config.globalRoot).toBe("/home/test/repos");
    expect(loaded.warning).toBeUndefined();
    expect(loaded.config.search).toMatchObject({
      mode: "dynamic",
      maxResults: 2000,
      debounceMs: 30,
      cacheTtlMs: 30000,
    });
  });

  it("loads a configured root", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-fzf-"));
    const path = join(dir, "config.json");
    writeFileSync(path, JSON.stringify({ globalRoot: "~/work" }));
    expect(loadConfig(path, "/home/test").config.globalRoot).toBe(
      "/home/test/work",
    );
  });

  it("loads partial search options", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-fzf-"));
    const path = join(dir, "config.json");
    writeFileSync(
      path,
      JSON.stringify({
        search: { mode: "preload", debounceMs: 0 },
      }),
    );

    const loaded = loadConfig(path, "/home/test");
    expect(loaded.config.search.mode).toBe("preload");
    expect(loaded.config.search.maxResults).toBe(0);
    expect(loaded.config.search.debounceMs).toBe(0);
  });

  it("falls back on invalid config", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-fzf-"));
    const path = join(dir, "config.json");
    writeFileSync(path, JSON.stringify({ globalRoot: 42 }));
    const loaded = loadConfig(path, "/home/test");
    expect(loaded.config.globalRoot).toBe("/home/test/repos");
    expect(loaded.warning).toContain(DEFAULT_GLOBAL_ROOT);
  });

  it("rejects unsupported tilde users", () => {
    expect(() => resolveGlobalRoot("~someone/repos", "/home/test")).toThrow();
  });
});
