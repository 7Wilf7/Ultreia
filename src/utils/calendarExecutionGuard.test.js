import { describe, expect, it, vi } from "vitest";
import { buildCreatePlansAction } from "./agentActions";
import {
  CALENDAR_BASELINE_VERSION,
  CALENDAR_CONFLICT_CODE,
  attachCalendarBaseline,
  buildCalendarExecutionRequest,
  compareCalendarExecutionGuard,
  markCalendarActionAttempt,
  persistCalendarBaseline,
  runCalendarMutationIfSafe,
} from "./calendarExecutionGuard";

function planned(id, overrides = {}) {
  return {
    id,
    updatedAt: "2026-07-12T00:00:00.000Z",
    date: "2026-07-15",
    type: "Road Run",
    subTypes: ["Easy Run"],
    distance: 8,
    duration: 0,
    ascent: 0,
    startedAt: "2026-07-15T08:00:00+08:00",
    planStatus: "pending",
    planDetail: { keySession: false },
    note: "Keep this note",
    isPlanned: true,
    ...overrides,
  };
}

function note(date = "2026-07-15", tags = []) {
  return { date, tags };
}

function createAction(plans, logs, notes = [note()]) {
  const action = buildCreatePlansAction(plans, {
    id: "action-1",
    createdAt: "2026-07-12T01:00:00.000Z",
  });
  return attachCalendarBaseline(action, logs, notes, "2026-07-12T01:01:00.000Z");
}

function createRequest(overrides = {}) {
  return buildCalendarExecutionRequest({
    workouts: [{
      date: "2026-07-15",
      type: "Road Run",
      subTypes: ["Easy Run"],
      distance: 10,
      duration: 0,
      ascent: 0,
      startedAt: "2026-07-15T08:00:00+08:00",
      isPlanned: true,
    }],
    replacePlannedDates: ["2026-07-15"],
    ...overrides,
  });
}

describe("Calendar execution guard", () => {
  it("saves a versioned, stable and complete review baseline", () => {
    const logs = [
      planned("plan-b", { subTypes: ["Tempo Run", "Easy Run"] }),
      planned("plan-a", {
        updatedAt: "2026-07-12T00:02:00.000Z",
        type: "Trail Run",
        subTypes: [],
        distance: 12,
        duration: 3600,
        ascent: 600,
        startedAt: "2026-07-15T18:00:00+08:00",
        planStatus: "done",
        planDetail: { keySession: true, location: "West Hill" },
        note: "Bring poles",
      }),
    ];
    const action = createAction([{ date: "2026-07-15", type: "Strength" }], logs, [note("2026-07-15", ["planned_rest"])]);
    const baseline = action.payload.calendarBaseline;

    expect(baseline.version).toBe(CALENDAR_BASELINE_VERSION);
    expect(baseline.scope).toEqual({
      affectedDates: ["2026-07-15"],
      updatedPlanIds: [],
      dateWideReplaceDates: ["2026-07-15"],
    });
    expect(baseline.replacementPlanSets[0].plans.map(plan => plan.id)).toEqual(["plan-a", "plan-b"]);
    expect(baseline.replacementPlanSets[0].plans[0]).toMatchObject({
      id: "plan-a",
      updatedAt: "2026-07-12T00:02:00.000Z",
      date: "2026-07-15",
      type: "Trail Run",
      subTypes: [],
      distance: 12,
      duration: 3600,
      ascent: 600,
      timeOfDay: "pm",
      planStatus: "done",
      keySession: true,
    });
    expect(baseline.replacementPlanSets[0].plans[0].noteFingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(baseline.plannedRest).toEqual([{ date: "2026-07-15", active: true }]);
  });

  it("allows execution when state matches even if Supabase order and array order differ", () => {
    const logs = [
      planned("plan-a", { subTypes: ["Easy Run", "Tempo Run"] }),
      planned("plan-b", { type: "Strength", subTypes: ["Core", "Upper Body"] }),
    ];
    const action = createAction([{ date: "2026-07-15", type: "Trail Run" }], logs);
    const latest = [
      { ...logs[1], subTypes: ["Upper Body", "Core"] },
      { ...logs[0], subTypes: ["Tempo Run", "Easy Run"] },
    ];

    expect(compareCalendarExecutionGuard({
      action,
      logs: latest,
      dailyNotes: [note()],
      request: createRequest(),
    })).toMatchObject({ ok: true, state: "safe", conflicts: [] });
  });

  it("blocks a targeted plan that was modified, deleted, or changed to a completed item", () => {
    const target = planned("plan-1");
    const action = createAction([{
      action: "update",
      targetPlanId: "plan-1",
      date: "2026-07-15",
      type: "Road Run",
      distance: 10,
    }], [target]);
    const request = createRequest({
      workouts: [{ ...planned("draft"), id: undefined, _targetPlanId: "plan-1", distance: 10 }],
      replacePlannedDates: [],
      replacePlannedIds: ["plan-1"],
    });

    const modified = compareCalendarExecutionGuard({
      action,
      logs: [{ ...target, distance: 9, updatedAt: "2026-07-12T02:00:00.000Z" }],
      dailyNotes: [note()],
      request,
    });
    const deleted = compareCalendarExecutionGuard({ action, logs: [], dailyNotes: [note()], request });
    const completed = compareCalendarExecutionGuard({
      action,
      logs: [{ ...target, isPlanned: false }],
      dailyNotes: [note()],
      request,
    });

    expect(modified.reasonCodes).toContain(CALENDAR_CONFLICT_CODE.TARGET_PLAN_MODIFIED);
    expect(deleted.reasonCodes).toContain(CALENDAR_CONFLICT_CODE.TARGET_PLAN_MISSING);
    expect(completed.reasonCodes).toContain(CALENDAR_CONFLICT_CODE.TARGET_NOT_PLANNED);
  });

  it("blocks when an affected date gains or loses a plan", () => {
    const logs = [planned("plan-a"), planned("plan-b")];
    const action = createAction([{ date: "2026-07-15", type: "Strength" }], logs);
    const request = createRequest();
    const added = compareCalendarExecutionGuard({
      action,
      logs: [...logs, planned("plan-c")],
      dailyNotes: [note()],
      request,
    });
    const removed = compareCalendarExecutionGuard({
      action,
      logs: [logs[0]],
      dailyNotes: [note()],
      request,
    });

    expect(added.reasonCodes).toContain(CALENDAR_CONFLICT_CODE.DATE_PLAN_SET_CHANGED);
    expect(removed.reasonCodes).toContain(CALENDAR_CONFLICT_CODE.DATE_PLAN_SET_CHANGED);
  });

  it("blocks when planned_rest changes after review", () => {
    const action = createAction([{ kind: "rest", date: "2026-07-15" }], [], [note()]);
    const request = buildCalendarExecutionRequest({ restDates: ["2026-07-15"] });
    const result = compareCalendarExecutionGuard({
      action,
      logs: [],
      dailyNotes: [note("2026-07-15", ["planned_rest"])],
      request,
    });

    expect(result.reasonCodes).toContain(CALENDAR_CONFLICT_CODE.PLANNED_REST_CHANGED);
  });

  it("does not execute a historical action without a baseline, then allows it only after the baseline persists", async () => {
    const rawAction = buildCreatePlansAction([{ date: "2026-07-15", type: "Road Run" }], { id: "historical" });
    const request = createRequest();
    const missing = compareCalendarExecutionGuard({ action: rawAction, logs: [], dailyNotes: [note()], request });
    expect(missing).toMatchObject({ ok: false, state: "missing_baseline" });

    const persist = vi.fn(async action => action);
    const reviewable = await persistCalendarBaseline({
      action: rawAction,
      logs: [],
      dailyNotes: [note()],
      persist,
      capturedAt: "2026-07-12T02:00:00.000Z",
    });
    expect(persist).toHaveBeenCalledOnce();
    expect(compareCalendarExecutionGuard({ action: reviewable, logs: [], dailyNotes: [note()], request })).toMatchObject({ ok: true });
  });

  it("blocks review when baseline persistence fails", async () => {
    const persist = vi.fn(async () => { throw new Error("offline"); });
    await expect(persistCalendarBaseline({
      action: buildCreatePlansAction([{ date: "2026-07-15", type: "Road Run" }], { id: "offline" }),
      logs: [],
      dailyNotes: [note()],
      persist,
    })).rejects.toThrow("offline");
    expect(persist).toHaveBeenCalledOnce();
  });

  it("performs zero Calendar and rest writes when the guard reports a conflict", async () => {
    const original = planned("plan-a");
    const action = createAction([{ date: "2026-07-15", type: "Strength" }], [original]);
    const guard = compareCalendarExecutionGuard({
      action,
      logs: [{ ...original, distance: 12, updatedAt: "2026-07-12T03:00:00.000Z" }],
      dailyNotes: [note()],
      request: createRequest(),
    });
    const writeRest = vi.fn();
    const writeCalendar = vi.fn();
    const onBlocked = vi.fn();

    const outcome = await runCalendarMutationIfSafe(guard, {
      onBlocked,
      execute: async () => {
        await writeRest();
        await writeCalendar();
      },
    });

    expect(outcome.executed).toBe(false);
    expect(onBlocked).toHaveBeenCalledOnce();
    expect(writeRest).not.toHaveBeenCalled();
    expect(writeCalendar).not.toHaveBeenCalled();
  });

  it("treats this action's partial Calendar writes as retry progress, not an external conflict", () => {
    const original = [planned("plan-a"), planned("plan-b")];
    const action = createAction([
      { date: "2026-07-15", type: "Road Run", distance: 10 },
      { date: "2026-07-15", type: "Strength" },
    ], original);
    const request = buildCalendarExecutionRequest({
      workouts: [
        { date: "2026-07-15", type: "Road Run", distance: 10, isPlanned: true },
        { date: "2026-07-15", type: "Strength", isPlanned: true },
      ],
      replacePlannedDates: ["2026-07-15"],
    });
    const attempted = markCalendarActionAttempt(action, request, "2026-07-12T04:00:00.000Z");
    const partialOwnWrite = planned("new-1", {
      updatedAt: "2026-07-12T04:01:00.000Z",
      subTypes: [],
      distance: 10,
      startedAt: null,
      note: "",
      planDetail: { agentActionId: "action-1", agentActionItemKey: "0:2026-07-15:Road Run" },
    });

    const result = compareCalendarExecutionGuard({
      action: { ...attempted, status: "failed" },
      logs: [partialOwnWrite],
      dailyNotes: [note()],
      request,
    });
    expect(result).toMatchObject({ ok: true, ownWritesComplete: false });
  });

  it("accepts this action's own planned_rest write during a safe retry", () => {
    const action = createAction([{ kind: "rest", date: "2026-07-15" }], [planned("plan-a")], [note()]);
    const request = buildCalendarExecutionRequest({ restDates: ["2026-07-15"] });
    const attempted = markCalendarActionAttempt(action, request, "2026-07-12T04:30:00.000Z");
    const result = compareCalendarExecutionGuard({
      action: { ...attempted, status: "failed" },
      logs: [],
      dailyNotes: [note("2026-07-15", ["planned_rest"])],
      request,
    });

    expect(result).toMatchObject({ ok: true, ownWritesComplete: false });
  });

  it("detects a cross-device modification between two confirmation attempts", () => {
    const original = planned("plan-a");
    const action = createAction([{ date: "2026-07-15", type: "Strength" }], [original]);
    const request = createRequest();
    const first = compareCalendarExecutionGuard({ action, logs: [original], dailyNotes: [note()], request });
    const second = compareCalendarExecutionGuard({
      action,
      logs: [{ ...original, note: "Changed on phone", updatedAt: "2026-07-12T05:00:00.000Z" }],
      dailyNotes: [note()],
      request,
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.reasonCodes).toContain(CALENDAR_CONFLICT_CODE.REPLACEMENT_PLAN_SET_CHANGED);
  });
});
