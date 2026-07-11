import { getCreatePlans, getPlanTargetId, isPlanUpdateItem, isRestPlanItem } from "./agentActions";

export const CALENDAR_BASELINE_VERSION = 1;

export const CALENDAR_GUARD_STATE = {
  SAFE: "safe",
  MISSING_BASELINE: "missing_baseline",
  STALE: "stale",
  SUPERSEDED: "superseded",
  EXECUTING: "executing",
  EXECUTED: "executed",
};

export const CALENDAR_CONFLICT_CODE = {
  MISSING_BASELINE: "missing_baseline",
  UNSUPPORTED_BASELINE: "unsupported_baseline",
  ACTION_STALE: "action_stale",
  ACTION_NOT_EXECUTABLE: "action_not_executable",
  SCOPE_DATE_NOT_REVIEWED: "scope_date_not_reviewed",
  SCOPE_TARGET_NOT_REVIEWED: "scope_target_not_reviewed",
  SCOPE_REPLACE_DATE_NOT_REVIEWED: "scope_replace_date_not_reviewed",
  EXECUTION_REQUEST_CHANGED: "execution_request_changed",
  OWN_WRITE_MODIFIED: "own_write_modified",
  TARGET_PLAN_MISSING: "target_plan_missing",
  TARGET_NOT_PLANNED: "target_not_planned",
  TARGET_PLAN_MODIFIED: "target_plan_modified",
  DATE_PLAN_SET_CHANGED: "date_plan_set_changed",
  REPLACEMENT_PLAN_SET_CHANGED: "replacement_plan_set_changed",
  PLANNED_REST_CHANGED: "planned_rest_changed",
};

function uniqueSorted(values = []) {
  return [...new Set((values || []).filter(Boolean).map(String))].sort();
}

function finiteNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && !Object.is(number, -0) ? number : 0;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, stableValue(value[key])]),
  );
}

export function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function fingerprint(value) {
  const input = String(value || "");
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function normalizedNote(plan) {
  return String(plan?.note ?? plan?.notes ?? "").replace(/\r\n/g, "\n").trim();
}

function stablePlanDetail(plan) {
  const detail = plan?.planDetail && typeof plan.planDetail === "object"
    ? { ...plan.planDetail }
    : {};
  delete detail.agentActionId;
  delete detail.agentActionItemKey;
  delete detail.agentActionTargetPlanId;
  return stableValue(detail);
}

function planTimeOfDay(plan) {
  if (plan?.timeOfDay === "am" || plan?.timeOfDay === "pm") return plan.timeOfDay;
  const startedAt = plan?.startedAt || plan?.started_at;
  if (!startedAt) return "";
  const date = new Date(startedAt);
  if (Number.isNaN(date.getTime())) return "";
  const hourPart = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(date).find(part => part.type === "hour");
  const hour = Number(hourPart?.value);
  return Number.isFinite(hour) ? (hour < 12 ? "am" : "pm") : "";
}

export function normalizeCalendarPlan(plan) {
  const detail = stablePlanDetail(plan);
  return {
    id: String(plan?.id || ""),
    updatedAt: String(plan?.updatedAt || plan?.updated_at || ""),
    date: String(plan?.date || ""),
    type: String(plan?.type || ""),
    subTypes: uniqueSorted(plan?.subTypes || plan?.sub_types || []),
    distance: finiteNumber(plan?.distance),
    duration: finiteNumber(plan?.duration),
    ascent: finiteNumber(plan?.ascent),
    timeOfDay: planTimeOfDay(plan),
    planStatus: String(plan?.planStatus || plan?.plan_status || ""),
    keySession: plan?.keySession === true || detail.keySession === true,
    noteFingerprint: fingerprint(normalizedNote(plan)),
    planDetailFingerprint: fingerprint(stableStringify(detail)),
  };
}

function sortPlans(plans = []) {
  return [...plans].sort((left, right) => {
    const a = normalizeCalendarPlan(left);
    const b = normalizeCalendarPlan(right);
    return [a.date, a.id, a.type, stableStringify(a)].join("|")
      .localeCompare([b.date, b.id, b.type, stableStringify(b)].join("|"));
  });
}

function normalizedPlans(plans = []) {
  return sortPlans(plans).map(normalizeCalendarPlan);
}

function plannedRestOn(date, dailyNotes = []) {
  const note = (dailyNotes || []).find(item => item?.date === date);
  return Array.isArray(note?.tags) && note.tags.includes("planned_rest");
}

function conflict(code, details = {}) {
  return { code, ...details };
}

export class CalendarBaselineError extends Error {
  constructor(message, conflicts = []) {
    super(message);
    this.name = "CalendarBaselineError";
    this.conflicts = conflicts;
  }
}

export function deriveCalendarBaselineScope(action, logs = []) {
  const plans = getCreatePlans(action);
  const updatedPlanIds = uniqueSorted(plans.map(getPlanTargetId));
  const targetById = new Map(
    (logs || []).filter(log => updatedPlanIds.includes(String(log?.id || "")))
      .map(log => [String(log.id), log]),
  );
  const affectedDates = uniqueSorted([
    ...plans.map(plan => plan?.date),
    ...updatedPlanIds.map(id => targetById.get(id)?.date),
  ]);
  const dateWideReplaceDates = uniqueSorted(
    plans.filter(plan => isRestPlanItem(plan) || !isPlanUpdateItem(plan)).map(plan => plan?.date),
  );
  return { affectedDates, updatedPlanIds, dateWideReplaceDates };
}

export function buildCalendarBaseline(action, logs = [], dailyNotes = [], capturedAt = new Date().toISOString()) {
  const plannedLogs = (logs || []).filter(log => log?.isPlanned === true);
  const scope = deriveCalendarBaselineScope(action, plannedLogs);
  const plannedById = new Map(plannedLogs.map(plan => [String(plan.id || ""), plan]));
  const invalidTargets = [];
  for (const id of scope.updatedPlanIds) {
    const target = (logs || []).find(log => String(log?.id || "") === id);
    if (!target) invalidTargets.push(conflict(CALENDAR_CONFLICT_CODE.TARGET_PLAN_MISSING, { planId: id }));
    else if (target.isPlanned !== true) invalidTargets.push(conflict(CALENDAR_CONFLICT_CODE.TARGET_NOT_PLANNED, { planId: id, date: target.date || "" }));
  }
  if (invalidTargets.length) {
    throw new CalendarBaselineError("Calendar baseline target is no longer a planned workout", invalidTargets);
  }

  const plansOnDate = date => plannedLogs.filter(plan => plan?.date === date);
  return {
    version: CALENDAR_BASELINE_VERSION,
    capturedAt: String(capturedAt),
    scope,
    targetPlans: scope.updatedPlanIds.map(id => normalizeCalendarPlan(plannedById.get(id))),
    datePlanSets: scope.affectedDates.map(date => ({
      date,
      planIds: uniqueSorted(plansOnDate(date).map(plan => plan?.id)),
    })),
    replacementPlanSets: scope.dateWideReplaceDates.map(date => ({
      date,
      plans: normalizedPlans(plansOnDate(date)),
    })),
    plannedRest: scope.affectedDates.map(date => ({ date, active: plannedRestOn(date, dailyNotes) })),
  };
}

export function hasCalendarBaseline(action) {
  return Number(action?.payload?.calendarBaseline?.version) === CALENDAR_BASELINE_VERSION;
}

export function attachCalendarBaseline(action, logs = [], dailyNotes = [], capturedAt) {
  const calendarBaseline = buildCalendarBaseline(action, logs, dailyNotes, capturedAt);
  return {
    ...action,
    payload: {
      ...(action?.payload || {}),
      affectedDates: calendarBaseline.scope.affectedDates,
      updatedPlanIds: calendarBaseline.scope.updatedPlanIds,
      dateWideReplaceDates: calendarBaseline.scope.dateWideReplaceDates,
      calendarBaseline,
    },
  };
}

export async function persistCalendarBaseline({ action, logs = [], dailyNotes = [], persist, capturedAt }) {
  if (typeof persist !== "function") throw new Error("persistCalendarBaseline: persist is required");
  const prepared = attachCalendarBaseline(action, logs, dailyNotes, capturedAt);
  const saved = await persist(prepared);
  if (!saved) throw new Error("Calendar baseline was not persisted");
  return saved;
}

function normalizeWriteItem(workout = {}) {
  const targetPlanId = String(workout?._targetPlanId || workout?.planDetail?.agentActionTargetPlanId || "");
  const detail = stablePlanDetail(workout);
  return {
    targetPlanId,
    date: String(workout?.date || ""),
    type: String(workout?.type || ""),
    subTypes: uniqueSorted(workout?.subTypes || []),
    distance: finiteNumber(workout?.distance),
    duration: finiteNumber(workout?.duration),
    ascent: finiteNumber(workout?.ascent),
    startedAt: String(workout?.startedAt || ""),
    noteFingerprint: fingerprint(normalizedNote(workout)),
    planDetailFingerprint: fingerprint(stableStringify(detail)),
  };
}

export function buildCalendarExecutionRequest({
  workouts = [],
  restDates = [],
  replacePlannedDates = [],
  replacePlannedIds = [],
} = {}) {
  const workoutDates = uniqueSorted(workouts.map(workout => workout?.date));
  const workoutDateSet = new Set(workoutDates);
  const restOnlyDates = uniqueSorted(restDates).filter(date => !workoutDateSet.has(date));
  const targetPlanIds = uniqueSorted([
    ...replacePlannedIds,
    ...workouts.map(workout => workout?._targetPlanId || workout?.planDetail?.agentActionTargetPlanId),
  ]);
  const dateWideReplaceDates = uniqueSorted([
    ...replacePlannedDates,
    ...restOnlyDates,
  ]);
  const affectedDates = uniqueSorted([...workoutDates, ...restOnlyDates, ...dateWideReplaceDates]);
  const plannedRest = uniqueSorted([...workoutDates, ...restOnlyDates]).map(date => ({
    date,
    active: restOnlyDates.includes(date),
  }));
  const items = workouts.map(normalizeWriteItem).sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)));
  const body = {
    affectedDates,
    workoutDates,
    restDates: restOnlyDates,
    dateWideReplaceDates,
    targetPlanIds,
    plannedRest,
    items,
  };
  return { ...body, signature: fingerprint(stableStringify(body)) };
}

function sameValue(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function conflictResult(state, conflicts, baseline = null, request = null) {
  const rows = conflicts.filter(Boolean);
  return {
    ok: false,
    state,
    baselineVersion: baseline?.version || null,
    requestSignature: request?.signature || "",
    conflicts: rows,
    reasonCodes: uniqueSorted(rows.map(item => item.code)),
    affectedDates: uniqueSorted(rows.map(item => item.date)),
    planIds: uniqueSorted(rows.map(item => item.planId)),
  };
}

function mapByDate(rows = []) {
  return new Map((rows || []).map(row => [row.date, row]));
}

function isOwnPlan(plan, actionId) {
  return !!actionId && plan?.planDetail?.agentActionId === actionId;
}

function targetIdForOwnPlan(plan) {
  return String(plan?.planDetail?.agentActionTargetPlanId || "");
}

function existingGuard(action) {
  return action?.result?.executionGuard && typeof action.result.executionGuard === "object"
    ? action.result.executionGuard
    : null;
}

export function isCalendarActionStale(action) {
  const state = existingGuard(action)?.state;
  return state === CALENDAR_GUARD_STATE.STALE || state === CALENDAR_GUARD_STATE.SUPERSEDED;
}

export function compareCalendarExecutionGuard({ action, logs = [], dailyNotes = [], request }) {
  const baseline = action?.payload?.calendarBaseline;
  if (!baseline) {
    return conflictResult(CALENDAR_GUARD_STATE.MISSING_BASELINE, [
      conflict(CALENDAR_CONFLICT_CODE.MISSING_BASELINE),
    ], null, request);
  }
  if (Number(baseline.version) !== CALENDAR_BASELINE_VERSION) {
    return conflictResult(CALENDAR_GUARD_STATE.MISSING_BASELINE, [
      conflict(CALENDAR_CONFLICT_CODE.UNSUPPORTED_BASELINE, { baselineVersion: baseline.version }),
    ], baseline, request);
  }

  const guard = existingGuard(action);
  if (guard?.state === CALENDAR_GUARD_STATE.STALE || guard?.state === CALENDAR_GUARD_STATE.SUPERSEDED) {
    const previous = Array.isArray(guard.conflicts) && guard.conflicts.length
      ? guard.conflicts
      : [conflict(CALENDAR_CONFLICT_CODE.ACTION_STALE)];
    return conflictResult(guard.state, previous, baseline, request);
  }
  if (["executed", "rejected", "cancelled"].includes(String(action?.status || ""))) {
    return conflictResult(CALENDAR_GUARD_STATE.STALE, [
      conflict(CALENDAR_CONFLICT_CODE.ACTION_NOT_EXECUTABLE, { status: action.status }),
    ], baseline, request);
  }

  const safeRequest = request || buildCalendarExecutionRequest();
  const conflicts = [];
  const baselineDates = new Set(baseline.scope?.affectedDates || []);
  const baselineTargets = new Set(baseline.scope?.updatedPlanIds || []);
  const baselineReplaceDates = new Set(baseline.scope?.dateWideReplaceDates || []);
  for (const date of safeRequest.affectedDates || []) {
    if (!baselineDates.has(date)) conflicts.push(conflict(CALENDAR_CONFLICT_CODE.SCOPE_DATE_NOT_REVIEWED, { date }));
  }
  for (const id of safeRequest.targetPlanIds || []) {
    if (!baselineTargets.has(id)) conflicts.push(conflict(CALENDAR_CONFLICT_CODE.SCOPE_TARGET_NOT_REVIEWED, { planId: id }));
  }
  for (const date of safeRequest.dateWideReplaceDates || []) {
    if (!baselineReplaceDates.has(date)) conflicts.push(conflict(CALENDAR_CONFLICT_CODE.SCOPE_REPLACE_DATE_NOT_REVIEWED, { date }));
  }

  const attempt = guard?.attempt || null;
  if (attempt?.request?.signature && attempt.request.signature !== safeRequest.signature) {
    conflicts.push(conflict(CALENDAR_CONFLICT_CODE.EXECUTION_REQUEST_CHANGED));
  }
  if (conflicts.length) return conflictResult(CALENDAR_GUARD_STATE.STALE, conflicts, baseline, safeRequest);

  const actionId = String(action?.id || "");
  const plannedLogs = (logs || []).filter(log => log?.isPlanned === true);
  const ownPlans = plannedLogs.filter(plan => isOwnPlan(plan, actionId));
  const externalPlans = plannedLogs.filter(plan => !isOwnPlan(plan, actionId));
  const externalById = new Map(externalPlans.map(plan => [String(plan.id || ""), plan]));
  const allLogsById = new Map((logs || []).map(plan => [String(plan?.id || ""), plan]));
  const targetBaselineById = new Map((baseline.targetPlans || []).map(plan => [String(plan.id || ""), plan]));
  const requestedTargetIds = new Set(safeRequest.targetPlanIds || []);
  const requestedReplaceDates = new Set(safeRequest.dateWideReplaceDates || []);
  const attempted = !!attempt?.request?.signature;

  if (attempted && ownPlans.length) {
    const expectedOwnItems = new Map();
    for (const item of safeRequest.items || []) {
      const key = stableStringify(item);
      expectedOwnItems.set(key, (expectedOwnItems.get(key) || 0) + 1);
    }
    for (const plan of ownPlans) {
      const item = normalizeWriteItem(plan);
      const key = stableStringify(item);
      const remaining = expectedOwnItems.get(key) || 0;
      if (remaining <= 0) {
        conflicts.push(conflict(CALENDAR_CONFLICT_CODE.OWN_WRITE_MODIFIED, { planId: plan.id || "", date: plan.date || "" }));
      } else {
        expectedOwnItems.set(key, remaining - 1);
      }
    }
  }

  for (const id of requestedTargetIds) {
    const expected = targetBaselineById.get(id);
    const current = externalById.get(id);
    if (!expected) {
      conflicts.push(conflict(CALENDAR_CONFLICT_CODE.SCOPE_TARGET_NOT_REVIEWED, { planId: id }));
      continue;
    }
    const currentAny = allLogsById.get(id);
    if (currentAny && currentAny.isPlanned !== true) {
      conflicts.push(conflict(CALENDAR_CONFLICT_CODE.TARGET_NOT_PLANNED, { planId: id, date: currentAny.date || expected.date }));
      continue;
    }
    if (current && !sameValue(normalizeCalendarPlan(current), expected)) {
      conflicts.push(conflict(CALENDAR_CONFLICT_CODE.TARGET_PLAN_MODIFIED, { planId: id, date: current.date || expected.date }));
      continue;
    }
    if (!current) {
      const ownReplacement = ownPlans.some(plan => targetIdForOwnPlan(plan) === id);
      if (!attempted && !ownReplacement) {
        conflicts.push(conflict(CALENDAR_CONFLICT_CODE.TARGET_PLAN_MISSING, { planId: id, date: expected.date }));
      }
    }
  }

  const baselineDateSets = mapByDate(baseline.datePlanSets);
  const replacementSets = mapByDate(baseline.replacementPlanSets);
  const comparisonDates = uniqueSorted([
    ...(safeRequest.affectedDates || []),
    ...(baseline.targetPlans || []).filter(plan => requestedTargetIds.has(plan.id)).map(plan => plan.date),
  ]);
  for (const date of comparisonDates) {
    const expectedIds = uniqueSorted(baselineDateSets.get(date)?.planIds || []);
    const currentExternalOnDate = externalPlans.filter(plan => plan.date === date);
    const currentIds = uniqueSorted(currentExternalOnDate.map(plan => plan.id));
    if (requestedReplaceDates.has(date)) {
      const unchanged = sameValue(currentIds, expectedIds);
      const replaced = attempted && currentIds.length === 0;
      if (!unchanged && !replaced) {
        conflicts.push(conflict(CALENDAR_CONFLICT_CODE.DATE_PLAN_SET_CHANGED, { date, expectedPlanIds: expectedIds, actualPlanIds: currentIds }));
        continue;
      }
      if (unchanged) {
        const expectedPlans = replacementSets.get(date)?.plans || [];
        const currentPlans = normalizedPlans(currentExternalOnDate);
        if (!sameValue(currentPlans, expectedPlans)) {
          conflicts.push(conflict(CALENDAR_CONFLICT_CODE.REPLACEMENT_PLAN_SET_CHANGED, { date }));
        }
      }
      continue;
    }

    const progressedTargets = new Set();
    if (attempted) {
      for (const id of requestedTargetIds) {
        const target = targetBaselineById.get(id);
        if (target?.date === date && !externalById.has(id)) progressedTargets.add(id);
      }
    }
    const expectedCurrentIds = expectedIds.filter(id => !progressedTargets.has(id));
    if (!sameValue(currentIds, expectedCurrentIds)) {
      conflicts.push(conflict(CALENDAR_CONFLICT_CODE.DATE_PLAN_SET_CHANGED, { date, expectedPlanIds: expectedCurrentIds, actualPlanIds: currentIds }));
    }
  }

  const plannedRestBaseline = mapByDate(baseline.plannedRest);
  const desiredRestByDate = mapByDate(safeRequest.plannedRest);
  for (const date of comparisonDates) {
    const desired = desiredRestByDate.get(date);
    const expected = plannedRestBaseline.get(date)?.active === true;
    const current = plannedRestOn(date, dailyNotes);
    const ownProgress = attempted && desired && current === desired.active;
    if (current !== expected && !ownProgress) {
      conflicts.push(conflict(CALENDAR_CONFLICT_CODE.PLANNED_REST_CHANGED, {
        date,
        expected,
        actual: current,
      }));
    }
  }

  if (conflicts.length) return conflictResult(CALENDAR_GUARD_STATE.STALE, conflicts, baseline, safeRequest);
  const ownPlansComplete = (safeRequest.items || []).length > 0
    && ownPlans.length === safeRequest.items.length;
  const targetWritesComplete = [...requestedTargetIds].every(id => !externalById.has(id));
  const replacementWritesComplete = [...requestedReplaceDates].every(
    date => externalPlans.every(plan => plan.date !== date),
  );
  const restWritesComplete = (safeRequest.plannedRest || []).every(
    desired => plannedRestOn(desired.date, dailyNotes) === desired.active,
  );
  return {
    ok: true,
    state: CALENDAR_GUARD_STATE.SAFE,
    baselineVersion: baseline.version,
    requestSignature: safeRequest.signature,
    conflicts: [],
    reasonCodes: [],
    affectedDates: [],
    planIds: [],
    ownWritesComplete: ownPlansComplete && targetWritesComplete && replacementWritesComplete && restWritesComplete,
  };
}

export function markCalendarActionAttempt(action, request, now = new Date().toISOString()) {
  return {
    ...action,
    result: {
      ...(action?.result || {}),
      executionGuard: {
        state: CALENDAR_GUARD_STATE.EXECUTING,
        baselineVersion: action?.payload?.calendarBaseline?.version || null,
        attempt: { startedAt: String(now), request },
        conflicts: [],
        reasonCodes: [],
      },
    },
  };
}

export function markCalendarActionStale(action, guardResult, now = new Date().toISOString()) {
  return {
    ...action,
    status: "proposed",
    decidedAt: null,
    executedAt: null,
    error: "",
    result: {
      ...(action?.result || {}),
      executionGuard: {
        state: CALENDAR_GUARD_STATE.STALE,
        detectedAt: String(now),
        baselineVersion: guardResult?.baselineVersion || action?.payload?.calendarBaseline?.version || null,
        requestSignature: guardResult?.requestSignature || "",
        conflicts: guardResult?.conflicts || [],
        reasonCodes: guardResult?.reasonCodes || [],
        affectedDates: guardResult?.affectedDates || [],
        planIds: guardResult?.planIds || [],
      },
    },
  };
}

export function markCalendarActionSuperseded(action, successorActionId, now = new Date().toISOString()) {
  const guard = existingGuard(action) || {};
  return {
    ...action,
    status: "proposed",
    decidedAt: null,
    executedAt: null,
    error: "",
    result: {
      ...(action?.result || {}),
      executionGuard: {
        ...guard,
        state: CALENDAR_GUARD_STATE.SUPERSEDED,
        supersededAt: String(now),
        successorActionId: String(successorActionId || ""),
      },
    },
  };
}

export function createCalendarActionSuccessor(action, {
  id = `${action?.id || "create-plans"}-review-${Date.now()}`,
  createdAt = new Date().toISOString(),
} = {}) {
  const payload = { ...(action?.payload || {}) };
  delete payload.calendarBaseline;
  payload.supersedesActionId = action?.id || null;
  return {
    ...action,
    id,
    rowId: undefined,
    payload,
    status: "proposed",
    createdAt,
    updatedAt: undefined,
    decidedAt: null,
    executedAt: null,
    result: {},
    error: "",
  };
}

export async function runCalendarMutationIfSafe(guardResult, { onBlocked, execute } = {}) {
  if (!guardResult?.ok) {
    await onBlocked?.(guardResult);
    return { executed: false, guard: guardResult, value: null };
  }
  if (typeof execute !== "function") throw new Error("runCalendarMutationIfSafe: execute is required");
  return { executed: true, guard: guardResult, value: await execute(guardResult) };
}
