import { describe, expect, it } from "vitest";
import {
  filterActionableProactivePlans,
  isProactiveCalendarAction,
  shouldAutoQuietProactiveAction,
  shouldAutoTriggerPlanDeviation,
  shouldAutoTriggerRecoveryGuard,
} from "./actionPlanFilters";

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

  it("does not auto-trigger plan rescue for one ordinary missed plan", () => {
    expect(shouldAutoTriggerPlanDeviation({
      affectedCount: 1,
      missedCount: 1,
      partialCount: 0,
      items: [{ outcome: "missed" }],
    })).toBe(false);

    expect(shouldAutoTriggerPlanDeviation({
      affectedCount: 2,
      missedCount: 1,
      partialCount: 1,
      items: [{ outcome: "missed" }, { outcome: "partial" }],
    })).toBe(true);

    expect(shouldAutoTriggerPlanDeviation({
      affectedCount: 1,
      missedCount: 1,
      partialCount: 0,
      items: [{ outcome: "missed", keySession: true }],
    })).toBe(true);
  });

  it("auto-triggers recovery guard only for stronger recovery risk", () => {
    expect(shouldAutoTriggerRecoveryGuard({
      signalCount: 1,
      severity: "watch",
      score: 2,
      hardFuturePlanCount: 0,
      signals: [{ level: 2 }],
    })).toBe(false);

    expect(shouldAutoTriggerRecoveryGuard({
      signalCount: 1,
      severity: "watch",
      score: 2,
      hardFuturePlanCount: 1,
      signals: [{ level: 2 }],
    })).toBe(true);
  });

  it("quiets repeated rejected proactive suggestions without blocking unrelated kinds", () => {
    const now = new Date("2026-06-29T10:00:00+08:00");
    const actions = [
      {
        status: "rejected",
        source: "plan_deviation_rescue",
        decidedAt: "2026-06-28T08:00:00+08:00",
      },
      {
        status: "cancelled",
        source: "combined_training_adjustment",
        decidedAt: "2026-06-27T08:00:00+08:00",
      },
    ];

    expect(shouldAutoQuietProactiveAction(actions, "plan_deviation_rescue", now)).toBe(true);
    expect(shouldAutoQuietProactiveAction(actions, "combined_training_adjustment", now)).toBe(false);
  });
});
