import { describe, expect, it } from "vitest";
import { filterActionableProactivePlans, isProactiveCalendarAction } from "./actionPlanFilters";

describe("action plan filters", () => {
  it("filters today and past items only for proactive calendar actions", () => {
    const plans = [
      { date: "2026-06-27", type: "Road Run" },
      { date: "2026-06-28", type: "Trail Run" },
      { date: "2026-06-29", type: "Road Run" },
    ];
    const now = new Date("2026-06-28T23:30:00+08:00");

    expect(filterActionableProactivePlans(plans, "combined_training_adjustment", now))
      .toEqual([{ date: "2026-06-29", type: "Road Run" }]);
    expect(filterActionableProactivePlans(plans, "ai_coach_reply", now)).toHaveLength(3);
  });

  it("recognizes stored proactive action payloads", () => {
    expect(isProactiveCalendarAction({
      source: "ai_coach_reply",
      payload: { proactiveTrigger: { kind: "recovery_load_guard" } },
    })).toBe(true);
  });
});
