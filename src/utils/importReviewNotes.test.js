import { describe, expect, it } from "vitest";
import {
  buildImportCoachReviewNote,
  buildImportSelfReviewNote,
  formatWorkoutNoteForDisplay,
  formatWorkoutReviewNoteParts,
  mergeImportCoachReviewNote,
  mergeImportFeelingNote,
} from "./importReviewNotes";

describe("import review note helpers", () => {
  it("builds a concise language-neutral selfreview note", () => {
    expect(buildImportSelfReviewNote("  腿很沉，但心率稳定  ", "", "zh"))
      .toBe("selfreview: 腿很沉，但心率稳定");
    expect(buildImportSelfReviewNote("felt controlled", "", "en"))
      .toBe("selfreview: felt controlled");
  });

  it("drops blank notes and strips lightweight markdown", () => {
    expect(buildImportSelfReviewNote("   ", "", "zh")).toBe("");
    expect(buildImportSelfReviewNote("**heavy**\n> but ok", "", "en"))
      .toBe("selfreview: heavy but ok");
  });

  it("stores only the runner's own self review, not the coach reply", () => {
    const raw = "今天前半段腿很沉，第三公里以后才慢慢打开，最后两公里心率稳定但不想再加速";
    const coach = "整体强度可控，但腿部疲劳信号明显。下次保留 easy，不建议追配速。";
    const note = buildImportSelfReviewNote(raw, coach, "zh");
    expect(note).toBe("selfreview: 今天前半段腿很沉，第三公里以后才慢慢打开");
    expect(note).not.toContain("最后两公里心率稳定但不想再加速");
    expect(note).not.toContain("整体强度可控");
  });

  it("builds a concise coach review note from AI text", () => {
    expect(buildImportCoachReviewNote("完成质量不错，心率控制稳定。下次保持 easy。", "zh"))
      .toBe("coachreview: 完成质量不错，心率控制稳定");
    expect(buildImportCoachReviewNote("Controlled aerobic work. Keep the next run easy.", "en"))
      .toBe("coachreview: Controlled aerobic work");
  });

  it("localizes review labels at display time", () => {
    expect(formatWorkoutNoteForDisplay("selfreview: 腿很沉", "zh")).toBe("自评：腿很沉");
    expect(formatWorkoutNoteForDisplay("selfreview: 腿很沉", "en")).toBe("Self review: 腿很沉");
    expect(formatWorkoutNoteForDisplay("coachreview: 控制得不错", "zh")).toBe("教练点评：控制得不错");
    expect(formatWorkoutNoteForDisplay("换了新鞋\n自评：腿很沉\ncoachreview: 控制得不错", "en"))
      .toBe("换了新鞋\nSelf review: 腿很沉\nCoach review: 控制得不错");
  });

  it("splits display note parts for the activity detail two-column layout", () => {
    expect(formatWorkoutReviewNoteParts("换了新鞋\nselfreview: 腿很沉\ncoachreview: 控制得不错", "zh"))
      .toEqual({
        other: "换了新鞋",
        selfReview: "腿很沉",
        coachReview: "控制得不错",
      });
  });

  it("merges without duplicating review notes", () => {
    const note = "selfreview: 腿很沉";
    expect(mergeImportFeelingNote("", note)).toBe(note);
    expect(mergeImportFeelingNote("换了新鞋", note)).toBe("换了新鞋\nselfreview: 腿很沉");
    expect(mergeImportFeelingNote(`换了新鞋\n${note}`, note)).toBe(`换了新鞋\n${note}`);
    expect(mergeImportFeelingNote("换了新鞋\n自评：腿很沉", note)).toBe("换了新鞋\n自评：腿很沉");
    expect(mergeImportFeelingNote("换了新鞋\nselfreview: 呃今天那个腿好像很沉然后然后", "selfreview: 腿沉但后程稳定"))
      .toBe("换了新鞋\nselfreview: 腿沉但后程稳定");

    const coachNote = "coachreview: 控制得不错";
    expect(mergeImportCoachReviewNote("换了新鞋", coachNote)).toBe("换了新鞋\ncoachreview: 控制得不错");
    expect(mergeImportCoachReviewNote("换了新鞋\ncoachreview: 太激进", coachNote)).toBe("换了新鞋\ncoachreview: 控制得不错");
  });
});
