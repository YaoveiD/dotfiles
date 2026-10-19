import { describe, expect, it } from "vitest";
import type { FileCandidate } from "./model.js";
import {
  createCandidate,
  formatProjectReference,
  formatReference,
  formatReferences,
  normalizeFdPath,
} from "./paths.js";

describe("paths", () => {
  it("normalizes fd paths and directory suffixes", () => {
    expect(normalizeFdPath("./src/index.ts")).toEqual({
      relativePath: "src/index.ts",
      isDirectory: false,
    });
    expect(normalizeFdPath("./src/")).toEqual({
      relativePath: "src/",
      isDirectory: true,
    });
  });

  it.runIf(process.platform !== "win32")(
    "preserves POSIX backslashes",
    () => {
      expect(normalizeFdPath("dir\\name.ts")).toEqual({
        relativePath: "dir\\name.ts",
        isDirectory: false,
      });
      expect(formatReference("dir\\name.ts")).toBe('@"dir\\\\name.ts"');
    },
  );

  it("creates relative project references", () => {
    const candidate = createCandidate(
      "/home/test/project",
      "./src/index.ts",
      "project",
      "/home/test",
    );
    expect(candidate?.referencePath).toBe("src/index.ts");
  });

  it("creates tilde global references", () => {
    const candidate = createCandidate(
      "/home/test/repos",
      "./pi/src/",
      "global",
      "/home/test",
    );
    expect(candidate?.referencePath).toBe("~/repos/pi/src/");
  });

  it("keeps references relative to the original Project root", () => {
    expect(
      formatProjectReference(
        "/home/test/project",
        "/home/test/shared/config.ts",
        false,
        "/home/test",
      ),
    ).toBe("../shared/config.ts");
    expect(
      formatProjectReference(
        "/home/test/project",
        "/home/test/shared",
        true,
        "/home/test",
      ),
    ).toBe("../shared/");
  });

  it("quotes paths with spaces", () => {
    expect(formatReference("src/my file.ts")).toBe('@"src/my file.ts"');
  });

  it("deduplicates and adds a trailing space", () => {
    const candidate: FileCandidate = {
      scope: "project",
      absolutePath: "/repo/a.ts",
      displayPath: "a.ts",
      referencePath: "a.ts",
      isDirectory: false,
    };
    expect(formatReferences([candidate, candidate])).toBe("@a.ts ");
  });
});
