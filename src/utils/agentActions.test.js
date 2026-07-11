import { describe, expect, it } from "vitest";
import {
  AGENT_ACTION_STATUS,
  buildCreatePlansAction,
  buildMemoryUpdateAction,
  buildRaceBriefingAction,
  completeAgentAction,
  describeCreatePlansImpact,
  getCreatePlans,
  getMemoryUpdate,
  getRaceBriefing,
  getAgentActionQualitySignal,
  getPlanTargetId,
  isCreatePlansAction,
  isMemoryUpdateAction,
  isRaceBriefingAction,
  isPlanUpdateItem,
  tagAgentPlanWorkouts,
  findPersistedAgentPlans,
  failAgentAction,
  isAgentPlanBatchPersisted,
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

  it("builds a saved race briefing action that does not require confirmation", () => {
    const action = buildRaceBriefingAction({
      race: { id: "race-1", name: "Main Race", date: "2026-07-02", priority: "A", category: "Trail" },
      summary: { daysToRace: 7, signature: "race-1::2026-07-02" },
      briefingMarkdown: "## 赛前重点\n- Keep it calm",
    }, {
      id: "briefing-1",
      createdAt: "2026-06-25T00:00:00.000Z",
    });

    expect(action).toMatchObject({
      id: "briefing-1",
      type: "race_briefing",
      risk: "low",
      requiresConfirmation: false,
      source: "race_briefing_checklist",
      status: "executed",
      createdAt: "2026-06-25T00:00:00.000Z",
      decidedAt: "2026-06-25T00:00:00.000Z",
      executedAt: "2026-06-25T00:00:00.000Z",
    });
    expect(action.payload.raceBriefing).toMatchObject({
      raceId: "race-1",
      name: "Main Race",
      date: "2026-07-02",
      daysToRace: 7,
      signature: "race-1::2026-07-02",
    });
    expect(isRaceBriefingAction(action)).toBe(true);
    expect(getRaceBriefing(action)).toContain("赛前重点");
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
      updateCount: 0,
      restCount: 0,
      affectedDates: ["2026-06-20", "2026-06-21"],
      restDates: [],
      updatedPlanIds: [],
      overwrittenDates: [
        { date: "2026-06-20", count: 1 },
        { date: "2026-06-21", count: 2 },
      ],
      dateImpacts: [
        {
          date: "2026-06-20",
          itemCount: 1,
          createCount: 1,
          updateCount: 0,
          restCount: 0,
          existingPlanCount: 1,
          dateWideReplace: true,
          updatedPlanIds: [],
        },
        {
          date: "2026-06-21",
          itemCount: 1,
          createCount: 1,
          updateCount: 0,
          restCount: 0,
          existingPlanCount: 2,
          dateWideReplace: true,
          updatedPlanIds: [],
        },
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
      updateCount: 0,
      restCount: 1,
      restDates: ["2026-06-20"],
      updatedPlanIds: [],
      overwrittenDates: [
        { date: "2026-06-20", count: 1 },
        { date: "2026-06-21", count: 1 },
      ],
      dateImpacts: [
        {
          date: "2026-06-20",
          itemCount: 1,
          createCount: 0,
          updateCount: 0,
          restCount: 1,
          existingPlanCount: 1,
          dateWideReplace: true,
          updatedPlanIds: [],
        },
        {
          date: "2026-06-21",
          itemCount: 1,
          createCount: 1,
          updateCount: 0,
          restCount: 0,
          existingPlanCount: 1,
          dateWideReplace: true,
          updatedPlanIds: [],
        },
      ],
    });
  });

  it("derives quality signals from runner decisions", () => {
    expect(getAgentActionQualitySignal({
      type: "create_plans",
      status: "executed",
    })).toMatchObject({
      label: "accepted_saved",
      score: 1,
    });

    expect(getAgentActionQualitySignal({
      type: "create_plans",
      status: "rejected",
    })).toMatchObject({
      label: "runner_skipped",
      score: -1,
    });

    expect(getAgentActionQualitySignal({
      type: "create_plans",
      status: "failed",
    })).toMatchObject({
      label: "save_failed",
      score: 0,
    });

    expect(getAgentActionQualitySignal({
      type: "create_plans",
      status: "proposed",
      result: { executionGuard: { state: "stale" } },
    })).toMatchObject({
      label: "stale",
      score: 0,
    });
  });

  it("describes targeted plan updates without date-wide overwrite warnings", () => {
    const action = buildCreatePlansAction([
      { action: "update", targetPlanId: "plan-1", date: "2026-06-20", type: "Road Run", distance: 8 },
    ]);

    expect(action.risk).toBe("medium");
    expect(action.payload.updatedPlanIds).toEqual(["plan-1"]);
    expect(getPlanTargetId(action.payload.plans[0])).toBe("plan-1");
    expect(isPlanUpdateItem(action.payload.plans[0])).toBe(true);
    expect(describeCreatePlansImpact(action, [
      { id: "plan-1", date: "2026-06-20", isPlanned: true },
      { id: "plan-2", date: "2026-06-20", isPlanned: true },
    ])).toEqual({
      itemCount: 1,
      createCount: 0,
      updateCount: 1,
      restCount: 0,
      affectedDates: ["2026-06-20"],
      restDates: [],
      updatedPlanIds: ["plan-1"],
      overwrittenDates: [],
      dateImpacts: [
        {
          date: "2026-06-20",
          itemCount: 1,
          createCount: 0,
          updateCount: 1,
          restCount: 0,
          existingPlanCount: 2,
          dateWideReplace: false,
          updatedPlanIds: ["plan-1"],
        },
      ],
      replacesExistingPlans: true,
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

  it("tags Calendar writes so a failed action-log save can retry without duplicate plans", () => {
    const tagged = tagAgentPlanWorkouts([
      { date: "2026-06-20", type: "Road Run", isPlanned: true, planDetail: { keySession: true } },
      { date: "2026-06-21", type: "Strength", isPlanned: true },
    ], "action-1");
    expect(tagged[0].planDetail).toMatchObject({ keySession: true, agentActionId: "action-1", agentActionItemKey: "0:2026-06-20:Road Run" });
    expect(findPersistedAgentPlans(tagged, "action-1")).toHaveLength(2);
    expect(isAgentPlanBatchPersisted(tagged, "action-1", 2)).toBe(true);
    expect(isAgentPlanBatchPersisted(tagged.slice(0, 1), "action-1", 2)).toBe(false);

    const targeted = tagAgentPlanWorkouts([{
      date: "2026-06-22",
      type: "Road Run",
      isPlanned: true,
      _targetPlanId: "old-plan-1",
    }], "action-2");
    expect(targeted[0].planDetail.agentActionTargetPlanId).toBe("old-plan-1");
  });

  it("keeps partial or failed execution out of the executed state", () => {
    const accepted = markAgentActionStatus(
      buildCreatePlansAction([{ date: "2026-06-20", type: "Road Run" }], { id: "a2" }),
      AGENT_ACTION_STATUS.EXECUTING,
    );
    const failed = failAgentAction(accepted, new Error("network unavailable"), "2026-06-19T08:00:00.000Z");
    expect(failed).toMatchObject({ status: "failed", error: "network unavailable" });
    expect(failed.executedAt).toBeNull();

    const completed = completeAgentAction(accepted, { calendarSaved: true, actionLogSaved: true }, "2026-06-19T08:05:00.000Z");
    expect(completed).toMatchObject({ status: "executed", result: { calendarSaved: true, actionLogSaved: true } });
  });
});
