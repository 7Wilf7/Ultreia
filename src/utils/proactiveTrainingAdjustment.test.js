import { describe, expect, it } from "vitest";
import { buildCombinedTrainingAdjustmentPrompt } from "./proactiveTrainingAdjustment";

describe("proactive training adjustment helpers", () => {
  it("includes coach preference context in combined adjustment prompts", () => {
    const prompt = buildCombinedTrainingAdjustmentPrompt({
      planSummary: {
        lookbackDays: 14,
        items: [{ line: "plan_id=p1 2026-06-20 Road Run 10km", outcome: "missed", ratio: null }],
        futurePlans: [{ line: "plan_id=p2 2026-06-26 Road Run 8km" }],
      },
      recoverySummary: {
        lookbackDays: 7,
        severity: "watch",
        signals: [{ label: "High recent RPE", detail: "2026-06-24 RPE 8" }],
        recentSessions: [{ line: "2026-06-24 Trail Run 18km RPE 8" }],
        futurePlans: [{ line: "plan_id=p2 2026-06-26 Road Run 8km" }],
      },
      dataBlock: "[Planned Sessions]\nplan_id=p2 2026-06-26 Road Run 8km",
      coachPreferenceBlock: "[Weekly Training Preferences]\nFriday Morning: Rest\nFriday Evening: Strength",
      now: new Date("2026-06-25T10:00:00+08:00"),
    });

    expect(prompt).toContain("[Weekly Training Preferences]");
    expect(prompt).toContain("Friday Evening: Strength");
    expect(prompt).toContain("materially identical");
    expect(prompt).toContain("evening/晚上");
    expect(prompt).toContain("Generate ONE combined");
    expect(prompt).toContain("Output the JSON array ONLY");
  });
});
