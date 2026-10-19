import { matchesKey, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import type { FileCandidate, PickerResult } from "./model.js";
import {
  FileSelector,
  type KeybindingsLike,
  type SelectorTheme,
} from "./selector.js";

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

const theme: SelectorTheme = {
  accent: (text) => text,
  muted: (text) => text,
  dim: (text) => text,
  match: (text) => text,
  border: (text) => text,
  bold: (text) => text,
};

function candidate(
  scope: "project" | "global",
  path: string,
): FileCandidate {
  const root = scope === "project" ? "/project" : "/home/test/repos";
  return {
    scope,
    absolutePath: `${root}/${path}`,
    displayPath: path,
    referencePath: scope === "project" ? path : `~/repos/${path}`,
    isDirectory: path.endsWith("/"),
  };
}

function readySelector(): FileSelector {
  const selector = new FileSelector(5, theme, keybindings);
  selector.setProjectRoot("/project");
  selector.setScopeCandidates("project", [
    candidate("project", "foo.ts"),
    candidate("project", "bar.ts"),
  ]);
  selector.setGlobalRoot("/home/test/repos");
  selector.setGlobalDirectoryCandidates("/home/test/repos", [
    candidate("global", "foo-global.ts"),
    candidate("global", "other.ts"),
  ]);
  return selector;
}

describe("FileSelector", () => {
  it("keeps independent queries when switching scope", () => {
    const selector = readySelector();
    let result: PickerResult | undefined;
    selector.onResult = (value) => {
      result = value;
    };

    selector.handleInput("b");
    selector.handleInput("]");
    for (const character of "other") selector.handleInput(character);
    selector.handleInput("[");
    selector.handleInput("\r");
    expect(result).toBeUndefined();
    expect(selector.render(50).join("\n")).toContain("Confirm insertion");
    selector.handleInput("\r");

    expect(result).toEqual({
      kind: "select",
      candidates: [candidate("project", "bar.ts")],
    });

    selector.handleInput("\x1b");
    result = undefined;
    selector.handleInput("]");
    selector.handleInput("\r");
    selector.handleInput("\r");
    expect(result).toEqual({
      kind: "select",
      candidates: [candidate("global", "other.ts")],
    });
  });

  it("toggles Git-ignored Project entries", () => {
    const selector = readySelector();
    const changes: boolean[] = [];
    selector.onProjectIgnoreChange = (includeGitIgnored) => {
      changes.push(includeGitIgnored);
    };

    selector.handleInput("\x07");
    expect(selector.getIncludeGitIgnored()).toBe(true);
    expect(changes).toEqual([true]);
    expect(selector.render(70).join("\n")).toContain("gitignored shown");

    selector.handleInput("\x07");
    expect(selector.getIncludeGitIgnored()).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  it("keeps marked items across scopes", () => {
    const selector = readySelector();
    let result: PickerResult | undefined;
    selector.onResult = (value) => {
      result = value;
    };

    selector.handleInput("\t");
    selector.handleInput("]");
    selector.handleInput("\t");
    selector.handleInput("\r");
    selector.handleInput("\r");

    expect(result).toEqual({
      kind: "select",
      candidates: [
        candidate("project", "foo.ts"),
        candidate("global", "foo-global.ts"),
      ],
    });
  });

  it("inserts a literal at sign on a second @", () => {
    const selector = readySelector();
    let result: PickerResult | undefined;
    selector.onResult = (value) => {
      result = value;
    };

    selector.handleInput("@");
    expect(result).toEqual({ kind: "literal-at" });
  });

  it("navigates the Project search root in both directions", () => {
    const selector = new FileSelector(5, theme, keybindings);
    const directory = {
      ...candidate("project", "src/"),
      absolutePath: "/home/test/project/src",
    };
    selector.setProjectRoot("/home/test/project");
    selector.setScopeCandidates("project", [directory]);
    const requested: string[] = [];
    selector.onProjectDirectoryRequest = (value) => {
      requested.push(value);
    };

    selector.handleInput("\x1b[C");
    expect(requested).toEqual(["/home/test/project/src"]);
    expect(selector.render(60).join("\n")).toContain("Project · src/");

    selector.setScopeCandidates("project", []);
    selector.handleInput("\x1b[D");
    selector.handleInput("\x1b[D");
    expect(requested).toEqual([
      "/home/test/project/src",
      "/home/test/project",
      "/home/test",
    ]);
    expect(selector.render(60).join("\n")).toContain("Project · ../");
  });

  it("restores queries when returning to a Project root", () => {
    const selector = readySelector();
    const requested: string[] = [];
    selector.onProjectDirectoryRequest = (value) => {
      requested.push(value);
    };

    selector.handleInput("f");
    selector.handleInput("\x1b[D");
    expect(selector.getQuery("project")).toBe("");
    selector.setScopeCandidates("project", [
      {
        ...candidate("project", "project/"),
        absolutePath: "/project",
      },
    ]);
    selector.handleInput("\x1b[C");

    expect(requested).toEqual(["/", "/project"]);
    expect(selector.getQuery("project")).toBe("f");
  });

  it("uses Ctrl+H as Project backspace while querying", () => {
    const selector = readySelector();
    let requested: string | undefined;
    selector.onProjectDirectoryRequest = (value) => {
      requested = value;
    };

    selector.handleInput("x");
    selector.handleInput("\x08");
    expect(selector.getQuery("project")).toBe("");
    expect(requested).toBeUndefined();
    selector.handleInput("\x08");
    expect(requested).toBe("/");
  });

  it("opens Global directories one level at a time", () => {
    const selector = new FileSelector(5, theme, keybindings);
    const directory = candidate("global", "project/");
    selector.setGlobalRoot("/home/test/repos");
    selector.setGlobalDirectoryCandidates("/home/test/repos", [directory]);
    let requested: string | undefined;
    selector.onGlobalDirectoryRequest = (value) => {
      requested = value;
    };

    selector.handleInput("]");
    selector.handleInput("\r");
    expect(requested).toBe("/home/test/repos/project");
  });

  it("opens Global directories explicitly even with Project marks", () => {
    const selector = readySelector();
    selector.handleInput("\t");
    const directory = candidate("global", "project/");
    selector.setGlobalDirectoryCandidates("/home/test/repos", [directory]);
    let requested: string | undefined;
    let result: PickerResult | undefined;
    selector.onGlobalDirectoryRequest = (value) => {
      requested = value;
    };
    selector.onResult = (value) => {
      result = value;
    };

    selector.handleInput("]");
    selector.handleInput("\x0c");
    expect(requested).toBe("/home/test/repos/project");
    expect(result).toBeUndefined();
  });

  it("opens when the same directory was marked in Project", () => {
    const selector = new FileSelector(5, theme, keybindings);
    const projectDirectory = candidate("project", "src/");
    const globalDirectory = {
      ...candidate("global", "src/"),
      absolutePath: projectDirectory.absolutePath,
    };
    selector.setScopeCandidates("project", [projectDirectory]);
    selector.setGlobalRoot("/project");
    selector.setGlobalDirectoryCandidates("/project", [globalDirectory]);
    selector.handleInput("\t");
    let requested: string | undefined;
    selector.onGlobalDirectoryRequest = (value) => {
      requested = value;
    };

    selector.handleInput("]");
    selector.handleInput("\x1b[C");
    expect(requested).toBe("/project/src");
  });

  it("submits marked Global directories before opening another directory", () => {
    const selector = new FileSelector(5, theme, keybindings);
    const first = candidate("global", "first/");
    const second = candidate("global", "second/");
    selector.setGlobalRoot("/home/test/repos");
    selector.setGlobalDirectoryCandidates("/home/test/repos", [first, second]);
    let result: PickerResult | undefined;
    let requested: string | undefined;
    selector.onResult = (value) => {
      result = value;
    };
    selector.onGlobalDirectoryRequest = (value) => {
      requested = value;
    };

    selector.handleInput("]");
    selector.handleInput("\t");
    selector.handleInput("\r");
    expect(result).toBeUndefined();
    selector.handleInput("\r");

    expect(result).toEqual({ kind: "select", candidates: [first] });
    expect(requested).toBeUndefined();
  });

  it("clears hidden marks", () => {
    const selector = readySelector();
    let result: PickerResult | undefined;
    selector.onResult = (value) => {
      result = value;
    };

    selector.handleInput("\t");
    selector.handleInput("\x18");
    selector.handleInput("\r");
    selector.handleInput("\r");

    expect(result).toEqual({
      kind: "select",
      candidates: [candidate("project", "bar.ts")],
    });
  });

  it("reviews, toggles, and confirms marked files", () => {
    const selector = readySelector();
    let result: PickerResult | undefined;
    selector.onResult = (value) => {
      result = value;
    };

    selector.handleInput("\t");
    selector.handleInput("\t");
    selector.handleInput("\x13");
    expect(selector.render(70).join("\n")).toContain("Selected files");
    expect(selector.render(70).join("\n")).toContain("foo.ts");
    expect(selector.render(70).join("\n")).toContain("bar.ts");

    selector.handleInput(" ");
    expect(selector.render(70).join("\n")).toContain("○ foo.ts");
    selector.handleInput(" ");
    selector.handleInput("\x18");
    expect(selector.render(70).join("\n")).toContain("0/2 selected");
    selector.handleInput("\x01");
    expect(selector.render(70).join("\n")).toContain("2/2 selected");

    selector.handleInput("\r");
    expect(result).toBeUndefined();
    expect(selector.render(70).join("\n")).toContain("Confirm insertion");
    selector.handleInput("\x1b");
    expect(selector.render(70).join("\n")).toContain("Selected files");
    selector.handleInput("\r");
    selector.handleInput("\r");
    expect(result).toEqual({
      kind: "select",
      candidates: [
        candidate("project", "foo.ts"),
        candidate("project", "bar.ts"),
      ],
    });
  });

  it("restores Global directory queries and selection", () => {
    const selector = new FileSelector(5, theme, keybindings);
    const first = candidate("global", "first/");
    const second = candidate("global", "second/");
    selector.setGlobalRoot("/home/test/repos");
    selector.setGlobalDirectoryCandidates("/home/test/repos", [first, second]);
    let requested: string | undefined;
    selector.onGlobalDirectoryRequest = (value) => {
      requested = value;
    };

    selector.handleInput("]");
    selector.handleInput("\x1b[B");
    selector.handleInput("\x1b[C");
    expect(requested).toBe("/home/test/repos/second");

    selector.setGlobalDirectoryLoading(second.absolutePath);
    selector.setGlobalDirectoryCandidates(second.absolutePath, [
      {
        ...candidate("global", "file.ts"),
        absolutePath: `${second.absolutePath}/file.ts`,
      },
    ]);
    selector.handleInput("f");
    selector.handleInput("\x1b[D");
    expect(requested).toBe("/home/test/repos");

    selector.setGlobalDirectoryLoading("/home/test/repos");
    selector.setGlobalDirectoryCandidates("/home/test/repos", [first, second]);
    selector.handleInput("\x1b[C");
    expect(requested).toBe("/home/test/repos/second");

    selector.setGlobalDirectoryLoading(second.absolutePath);
    expect(selector.getQuery("global")).toBe("f");
  });

  it("moves to the Global parent with backspace, Left, or Ctrl+H", () => {
    const selector = new FileSelector(5, theme, keybindings);
    selector.setGlobalRoot("/home/test/repos");
    selector.setGlobalDirectoryLoading("/home/test/repos/project/src");
    let requested: string | undefined;
    selector.onGlobalDirectoryRequest = (value) => {
      requested = value;
    };

    selector.handleInput("]");
    selector.handleInput("\x7f");
    expect(requested).toBe("/home/test/repos/project");
    selector.setGlobalDirectoryLoading("/home/test/repos/project/src");
    requested = undefined;
    selector.handleInput("\x1b[D");
    expect(requested).toBe("/home/test/repos/project");
    selector.setGlobalDirectoryLoading("/home/test/repos/project/src");
    requested = undefined;
    selector.handleInput("\x08");
    expect(requested).toBe("/home/test/repos/project");
    selector.setGlobalDirectoryLoading("/home/test/repos/project/src");
    requested = undefined;
    selector.handleInput("x");
    selector.handleInput("\x08");
    expect(selector.getQuery("global")).toBe("");
    expect(requested).toBeUndefined();
  });

  it("renders Yazi-style parent, current, and preview panes", () => {
    const selector = new FileSelector(6, theme, keybindings);
    const directory = candidate("global", "project/");
    const sibling = candidate("global", "notes.txt");
    const child = {
      ...candidate("global", "src/"),
      absolutePath: `${directory.absolutePath}/src`,
      referencePath: `${directory.referencePath}src/`,
    };
    const previewRequests: string[] = [];
    selector.setGlobalRoot("/home/test/repos");
    selector.setGlobalDirectoryCandidates("/home/test/repos", [
      directory,
      sibling,
    ]);
    selector.onGlobalPreviewRequest = (value) => {
      previewRequests.push(value);
      selector.setGlobalPreviewLoading(value);
    };

    selector.handleInput("]");
    expect(previewRequests).toEqual([directory.absolutePath]);
    selector.setGlobalPreviewCandidates(directory.absolutePath, [child]);

    const rendered = selector.render(100).join("\n");
    expect(rendered).toContain("/home/test/repos");
    expect(rendered).toContain("project/");
    expect(rendered).toContain("src/");
    expect(rendered).toMatch(/│.*│.*│/);
    let navigated: string | undefined;
    selector.onGlobalDirectoryRequest = (value) => {
      navigated = value;
    };
    selector.handleInput("\x0c");
    expect(navigated).toBe("/home/test/repos/project");
    selector.setGlobalDirectoryLoading(directory.absolutePath);
    selector.setGlobalDirectoryCandidates(directory.absolutePath, [child]);
    const nested = selector.render(100).join("\n");
    expect(nested).toContain("notes.txt");
    expect(nested).toContain("src/");
  });

  it("prefetches the newly highlighted Global directory", () => {
    const selector = new FileSelector(5, theme, keybindings);
    const first = candidate("global", "first/");
    const second = candidate("global", "second/");
    const previewRequests: string[] = [];
    selector.setGlobalRoot("/home/test/repos");
    selector.setGlobalDirectoryCandidates("/home/test/repos", [first, second]);
    selector.onGlobalPreviewRequest = (value) => {
      previewRequests.push(value);
      selector.setGlobalPreviewLoading(value);
    };

    selector.handleInput("]");
    selector.handleInput("\x1b[B");
    expect(previewRequests).toEqual([first.absolutePath, second.absolutePath]);
  });

  it("uses substring filtering instead of fuzzy matching in Global", () => {
    const selector = readySelector();
    selector.handleInput("]");
    selector.handleInput("f");
    selector.handleInput("g");
    expect(selector.render(50).join("\n")).toContain("No matches");
  });

  it("filters ready Project results while a dynamic refresh is pending", () => {
    const selector = readySelector();
    const queries: string[] = [];
    selector.setScopeQueryDriven("project", true);
    selector.onQueryChange = (scope, query) => {
      queries.push(query);
      selector.setScopeLoading(scope);
    };

    selector.handleInput("b");
    const rendered = selector.render(50).join("\n");

    expect(queries).toEqual(["b"]);
    expect(rendered).toContain("bar.ts");
    expect(rendered).not.toContain("foo.ts");
    expect(rendered).not.toContain("Loading…");
  });

  it("requests global data lazily", () => {
    const selector = new FileSelector(5, theme, keybindings);
    const requested: string[] = [];
    selector.onScopeRequest = (scope) => {
      requested.push(scope);
      selector.setScopeLoading(scope);
    };

    selector.requestInitialScope();
    selector.handleInput("]");
    expect(requested).toEqual(["project", "global"]);
  });

  it("highlights astral Unicode as one character", () => {
    const unicodeTheme = { ...theme, match: (text: string) => `[${text}]` };
    const selector = new FileSelector(5, unicodeTheme, keybindings);
    selector.setScopeCandidates("project", [candidate("project", "a😀b.ts")]);
    selector.handleInput("😀");
    const rendered = selector.render(50).join("\n");
    expect(rendered).toContain("[😀]");
    expect(rendered).not.toContain("[b]");
    expect(rendered).not.toContain("�");
  });

  it("restores a cached Project index after an error", () => {
    const selector = new FileSelector(3, theme, keybindings);
    const candidates = [candidate("project", "foo.ts")];
    selector.setScopeCandidates("project", candidates);
    selector.setScopeError("project", "temporary");
    selector.setScopeCandidates("project", candidates);
    selector.handleInput("f");

    expect(selector.render(40).join("\n")).toContain("foo.ts");
  });

  it("keeps multiline errors inside the box", () => {
    const selector = new FileSelector(3, theme, keybindings);
    selector.setScopeError("project", "first line\nsecond line");
    const rendered = selector.render(40);
    expect(rendered.join("\n")).toContain("second line");
    for (const line of rendered) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(40);
    }
  });

  it("stays within extremely narrow widths", () => {
    const selector = readySelector();
    for (const width of [1, 2]) {
      for (const line of selector.render(width)) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });

  it("renders eight fixed rows plus visible candidates", () => {
    const selector = new FileSelector(1, theme, keybindings);
    selector.setScopeCandidates("project", [candidate("project", "foo.ts")]);
    expect(selector.render(50)).toHaveLength(9);
  });

  it("never renders beyond the given width", () => {
    const selector = readySelector();
    for (const line of selector.render(50)) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(50);
    }
  });
});
