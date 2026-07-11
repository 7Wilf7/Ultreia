import { describe, expect, it } from "vitest";
import { attachCalendarActionOutcome, evaluateExecutedCalendarAction, evaluateExecutedCalendarActions } from "./agentActionOutcome";

function action(overrides = {}) {
  return {
    id: "a1", type: "create_plans", status: "executed",
    payload: {
      affectedDates: ["2026-07-01"],
      plans: [
        { date: "2026-07-01", type: "Road Run", subTypes: ["Easy Run"], distance: 10 },
        { date: "2026-07-01", type: "Road Run", subTypes: ["Tempo Run"], distance: 6 },
      ],
    },
    result: { calendarSaved: true, createdWorkoutIds: ["p1", "p2"], auditToken: "keep-me" },
    ...overrides,
  };
}

const plans = [
  { id: "p1", isPlanned: true, date: "2026-07-01", type: "Road Run", subTypes: ["Easy Run"], distance: 10, planDetail: { agentActionId: "a1", agentActionItemKey: "0:2026-07-01:Road Run" } },
  { id: "p2", isPlanned: true, date: "2026-07-01", type: "Road Run", subTypes: ["Tempo Run"], distance: 6, planDetail: { agentActionId: "a1", agentActionItemKey: "1:2026-07-01:Road Run" } },
];

describe("executed Calendar action outcome", () => {
  it("waits until every affected date is past and ignores non-executed actions", () => {
    expect(evaluateExecutedCalendarAction(action(), plans, new Date("2026-07-01T20:00:00+08:00"))).toBeNull();
    expect(evaluateExecutedCalendarAction(action({ status: "failed" }), plans, new Date("2026-07-03T12:00:00+08:00"))).toBeNull();
  });

  it("does not evaluate when the authoritative refresh failed", () => {
    const original = [action()];
    expect(evaluateExecutedCalendarActions(original, plans, new Date("2026-07-03T12:00:00+08:00"), { contextFresh: false })).toBe(original);
    expect(original[0].result.outcome).toBeUndefined();
  });

  it("reuses one-to-one matching and records high RPE without causal claims", () => {
    const outcome = evaluateExecutedCalendarAction(action(), [
      ...plans,
      { id: "w1", isPlanned: false, date: "2026-07-01", type: "Road Run", subTypes: ["Tempo Run"], distance: 6, rpe: 9 },
    ], new Date("2026-07-03T12:00:00+08:00"));
    expect(outcome.counts).toMatchObject({ total: 2, completed: 1, missed: 1 });
    expect(outcome.highRpeCount).toBe(1);
    expect(outcome.observation).toContain("does not establish");
  });

  it("counts modified and deleted plans", () => {
    const outcome = evaluateExecutedCalendarAction(action({
      result: {
        calendarSaved: true,
        createdWorkoutSnapshots: [
          { date: "2026-07-01", type: "Road Run", subTypes: ["Easy Run"], distance: 10 },
          { date: "2026-07-01", type: "Road Run", subTypes: ["Tempo Run"], distance: 6 },
        ],
      },
    }), [{ ...plans[0], distance: 8 }], new Date("2026-07-03T12:00:00+08:00"));
    expect(outcome.counts).toMatchObject({ modified: 1, deleted: 1 });
  });

  it("preserves execution audit and is idempotent", () => {
    const first = attachCalendarActionOutcome(action(), plans, new Date("2026-07-03T12:00:00+08:00"));
    const second = attachCalendarActionOutcome(first, plans, new Date("2026-07-04T12:00:00+08:00"));
    expect(first.result.auditToken).toBe("keep-me");
    expect(second).toBe(first);
  });
});
