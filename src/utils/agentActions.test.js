import { describe, expect, it } from "vitest";
import {
  buildCreatePlansAction,
  describeCreatePlansImpact,
  getCreatePlans,
  isCreatePlansAction,
} from "./agentActions";

describe("agent action helpers", () => {
  it("builds a confirmable create_plans action", () => {
    const action = buildCreatePlansAction([{ date: "2026-06-20", type: "Road Run" }], {
      id: "a1",
      sourceMessageId: "m1",
      createdAt: "2026-06-19T00:00:00.000Z",
    });

    expect(action).toMatchObject({
      id: "a1",
      type: "create_plans",
      risk: "medium",
      requiresConfirmation: true,
      source: "ai_coach_reply",
      sourceMessageId: "m1",
      status: "proposed",
      createdAt: "2026-06-19T00:00:00.000Z",
    });
    expect(action.payload.affectedDates).toEqual(["2026-06-20"]);
    expect(action.payload.replacesExistingPlans).toBe(true);
    expect(isCreatePlansAction(action)).toBe(true);
    expect(getCreatePlans(action)).toHaveLength(1);
  });

  it("normalizes missing plan payloads to an empty list", () => {
    const action = buildCreatePlansAction(null, { id: "empty" });

    expect(getCreatePlans(action)).toEqual([]);
    expect(getCreatePlans({ type: "unknown" })).toEqual([]);
  });

  it("describes affected dates and existing plan overwrites", () => {
    const action = buildCreatePlansAction([
      { date: "2026-06-20", type: "Road Run" },
      { date: "2026-06-21", type: "Strength" },
    ]);

    expect(describeCreatePlansImpact(action, [
      { date: "2026-06-20", isPlanned: true },
      { date: "2026-06-20", isPlanned: false },
      { date: "2026-06-21", isPlanned: true },
      { date: "2026-06-21", isPlanned: true },
    ])).toEqual({
      createCount: 2,
      affectedDates: ["2026-06-20", "2026-06-21"],
      overwrittenDates: [
        { date: "2026-06-20", count: 1 },
        { date: "2026-06-21", count: 2 },
      ],
      replacesExistingPlans: true,
    });
  });
});
