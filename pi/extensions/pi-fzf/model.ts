export type PickerScope = "project" | "global";

export interface FileCandidate {
  scope: PickerScope;
  absolutePath: string;
  displayPath: string;
  referencePath: string;
  isDirectory: boolean;
}

export type PickerResult =
  | { kind: "select"; candidates: FileCandidate[] }
  | { kind: "literal-at" }
  | { kind: "cancel" };
