import { describe, expect, it } from "vitest";
import {
  AGENT_ACTION_STATUS,
  buildCreatePlansAction,
  buildMemoryUpdateAction,
  describeCreatePlansImpact,
  getCreatePlans,
  getMemoryUpdate,
  isCreatePlansAction,
  isMemoryUpdateAction,
  isRestPlanItem,
  markAgentActionStatus,
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
      risk: "low",
      requiresConfirmation: true,
      source: "ai_coach_reply",
      sourceMessageId: "m1",
      status: "proposed",
      createdAt: "2026-06-19T00:00:00.000Z",
      decidedAt: null,
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

  it("builds a confirmable memory_update action", () => {
    const memory = { en: "- Prefers morning runs", zh: "- 偏好晨跑" };
    const action = buildMemoryUpdateAction(memory, {
      id: "mem1",
      sourceMessageCount: 4,
      createdAt: "2026-06-19T00:00:00.000Z",
    });

    expect(action).toMatchObject({
      id: "mem1",
      type: "memory_update",
      risk: "low",
      requiresConfirmation: true,
      source: "ai_coach_memory",
      status: "proposed",
      createdAt: "2026-06-19T00:00:00.000Z",
      decidedAt: null,
    });
    expect(action.payload.sourceMessageCount).toBe(4);
    expect(getMemoryUpdate(action)).toEqual(memory);
    expect(isMemoryUpdateAction(action)).toBe(true);
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
      itemCount: 2,
      createCount: 2,
      restCount: 0,
      affectedDates: ["2026-06-20", "2026-06-21"],
      restDates: [],
      overwrittenDates: [
        { date: "2026-06-20", count: 1 },
        { date: "2026-06-21", count: 2 },
      ],
      replacesExistingPlans: true,
    });
  });

  it("keeps explicit rest days as plan items without counting them as workouts", () => {
    const action = buildCreatePlansAction([
      { kind: "rest", date: "2026-06-20", notes: "No planned workout" },
      { date: "2026-06-21", type: "Trail Run" },
    ]);

    expect(action.risk).toBe("medium");
    expect(isRestPlanItem(action.payload.plans[0])).toBe(true);
    expect(describeCreatePlansImpact(action, [
      { date: "2026-06-20", isPlanned: true },
      { date: "2026-06-21", isPlanned: true },
    ])).toMatchObject({
      itemCount: 2,
      createCount: 1,
      restCount: 1,
      restDates: ["2026-06-20"],
      overwrittenDates: [
        { date: "2026-06-20", count: 1 },
        { date: "2026-06-21", count: 1 },
      ],
    });
  });

  it("marks action decisions with a decided timestamp", () => {
    const action = buildCreatePlansAction([{ date: "2026-06-20", type: "Road Run" }], {
      id: "a1",
      createdAt: "2026-06-19T00:00:00.000Z",
    });

    expect(markAgentActionStatus(action, AGENT_ACTION_STATUS.EXECUTED, "2026-06-19T08:00:00.000Z")).toMatchObject({
      id: "a1",
      status: "executed",
      decidedAt: "2026-06-19T08:00:00.000Z",
    });
  });
});
