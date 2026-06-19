import { describe, expect, it } from "vitest";
import { evaluatePlanOutcome, PLAN_DONE_RATIO } from "./planMatch";

describe("evaluatePlanOutcome", () => {
  it("uses explicit plan status before matching activities", () => {
    expect(evaluatePlanOutcome(
      { isPlanned: true, planStatus: "skipped", type: "Road Run", distance: 10 },
      [{ type: "Road Run", distance: 10 }],
      { isPast: true },
    )).toEqual({ outcome: "skipped", ratio: null });
  });

  it("marks a distance plan done when same-type completed distance reaches the threshold", () => {
    const result = evaluatePlanOutcome(
      { isPlanned: true, type: "Road Run", distance: 10 },
      [
        { isPlanned: false, type: "Road Run", distance: 4 },
        { isPlanned: false, type: "Road Run", distance: 4 },
      ],
      { isPast: true },
    );

    expect(PLAN_DONE_RATIO).toBe(0.8);
    expect(result).toEqual({ outcome: "done", ratio: 0.8 });
  });

  it("marks a quantitative plan partial when same-type activity falls short", () => {
    expect(evaluatePlanOutcome(
      { isPlanned: true, type: "Road Run", distance: 10 },
      [{ isPlanned: false, type: "Road Run", distance: 6 }],
      { isPast: true },
    )).toEqual({ outcome: "partial", ratio: 0.6 });
  });

  it("separates missed past plans from pending current or future plans", () => {
    const plan = { isPlanned: true, type: "Strength", duration: 45 * 60 };

    expect(evaluatePlanOutcome(plan, [], { isPast: true })).toEqual({ outcome: "missed", ratio: null });
    expect(evaluatePlanOutcome(plan, [], { isPast: false })).toEqual({ outcome: "pending", ratio: null });
  });

  it("treats metric-less same-type plans as done", () => {
    expect(evaluatePlanOutcome(
      { isPlanned: true, type: "HIIT" },
      [{ isPlanned: false, type: "HIIT", duration: 20 * 60 }],
      { isPast: true },
    )).toEqual({ outcome: "done", ratio: null });
  });
});
