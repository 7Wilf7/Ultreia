import { describe, expect, it } from "vitest";
import { normalizeComposerTextChange } from "./composerInput";

describe("normalizeComposerTextChange", () => {
  it("collapses a full duplicated speech insertion", () => {
    expect(normalizeComposerTextChange("", "今天练得不错今天练得不错", {
      inputType: "insertText",
      selectionStart: 12,
    })).toEqual({
      value: "今天练得不错",
      selectionStart: 6,
      changed: true,
    });
  });

  it("ignores a repeated final phrase appended after the same previous phrase", () => {
    expect(normalizeComposerTextChange("今天练得不错", "今天练得不错今天练得不错", {
      inputType: "insertText",
      selectionStart: 12,
    })).toEqual({
      value: "今天练得不错",
      selectionStart: 6,
      changed: true,
    });
  });

  it("keeps deletion changes untouched", () => {
    expect(normalizeComposerTextChange("今天练得不错", "今天练得不", {
      inputType: "deleteContentBackward",
      selectionStart: 5,
    })).toEqual({
      value: "今天练得不",
      selectionStart: 5,
      changed: false,
    });
  });

  it("does not collapse paste input", () => {
    expect(normalizeComposerTextChange("", "今天练得不错今天练得不错", {
      inputType: "insertFromPaste",
      selectionStart: 12,
    })).toEqual({
      value: "今天练得不错今天练得不错",
      selectionStart: 12,
      changed: false,
    });
  });
});
