import { describe, expect, it } from "vitest";
import { buildPlanDeviationRescuePrompt, summarizePlanDeviation } from "./planDeviation";

describe("plan deviation helpers", () => {
  it("summarizes missed and partial past plans only", () => {
    const now = new Date("2026-06-24T10:00:00+08:00");
    const logs = [
      { id: "p1", isPlanned: true, date: "2026-06-20", type: "Road Run", distance: 10, subTypes: ["Easy Run"] },
      { id: "w1", isPlanned: false, date: "2026-06-20", type: "Road Run", distance: 4, subTypes: ["Easy Run"] },
      { id: "p2", isPlanned: true, date: "2026-06-21", type: "Strength", duration: 1800, subTypes: ["Core"] },
      { id: "p3", isPlanned: true, date: "2026-06-22", type: "Road Run", distance: 5, planStatus: "done" },
      { id: "p4", isPlanned: true, date: "2026-06-24", type: "Road Run", distance: 6 },
      { id: "p5", isPlanned: true, date: "2026-06-25", type: "Road Run", distance: 8 },
    ];

    const summary = summarizePlanDeviation(logs, now);

    expect(summary).toMatchObject({
      lookbackDays: 14,
      doneCount: 1,
      partialCount: 1,
      missedCount: 1,
      affectedCount: 2,
      totalPastPlanCount: 3,
      today: "2026-06-24",
    });
    expect(summary.items.map(i => i.outcome)).toEqual(["partial", "missed"]);
    expect(summary.items.map(i => i.planId)).toEqual(["p1", "p2"]);
    expect(summary.futurePlans.map(p => p.planId)).toEqual(["p4", "p5"]);
  });

  it("returns null when all past plans are completed", () => {
    const now = new Date("2026-06-24T10:00:00+08:00");
    const logs = [
      { id: "p1", isPlanned: true, date: "2026-06-20", type: "Road Run", distance: 10 },
      { id: "w1", isPlanned: false, date: "2026-06-20", type: "Road Run", distance: 8 },
    ];

    expect(summarizePlanDeviation(logs, now)).toBeNull();
  });

  it("builds a JSON-only rescue prompt with the deviation and plan id context", () => {
    const summary = {
      lookbackDays: 14,
      items: [{ line: "plan_id=p1 2026-06-20 Road Run 10km", outcome: "missed", ratio: null }],
      futurePlans: [{ line: "plan_id=p2 2026-06-25 Road Run 8km" }],
    };

    const prompt = buildPlanDeviationRescuePrompt({
      summary,
      dataBlock: "[Planned Sessions]\nplan_id=p2 2026-06-25 Road Run 8km",
      now: new Date("2026-06-24T10:00:00+08:00"),
    });

    expect(prompt).toContain("plan_id=p1 2026-06-20 Road Run 10km -> missed");
    expect(prompt).toContain("targetPlanId");
    expect(prompt).toContain("Output the JSON array ONLY");
  });
});
