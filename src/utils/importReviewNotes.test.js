import { describe, expect, it } from "vitest";
import { buildImportFeelingNote, mergeImportFeelingNote } from "./importReviewNotes";

describe("import review note helpers", () => {
  it("builds a concise localized feeling note", () => {
    expect(buildImportFeelingNote("  腿很沉，但心率稳定  ", "zh"))
      .toBe("导入自评：腿很沉，但心率稳定");
    expect(buildImportFeelingNote("felt controlled", "en"))
      .toBe("Import self-review: felt controlled");
  });

  it("drops blank notes and strips lightweight markdown", () => {
    expect(buildImportFeelingNote("   ", "zh")).toBe("");
    expect(buildImportFeelingNote("**heavy**\n> but ok", "en"))
      .toBe("Import self-review: heavy but ok");
  });

  it("merges without duplicating the same feeling note", () => {
    const note = "导入自评：腿很沉";
    expect(mergeImportFeelingNote("", note)).toBe(note);
    expect(mergeImportFeelingNote("换了新鞋", note)).toBe("换了新鞋\n导入自评：腿很沉");
    expect(mergeImportFeelingNote(`换了新鞋\n${note}`, note)).toBe(`换了新鞋\n${note}`);
  });
});
