import { findPersistedAgentPlans, isCreatePlansAction, isRestPlanItem } from "./agentActions";
import { matchPlansToActuals } from "./planMatch";

export const AGENT_OUTCOME_VERSION = 1;

function localDateKey(now = new Date()) {
  const d = new Date(now);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function normalizedSnapshot(plan = {}) {
  const startedAt = plan.startedAt || plan.started_at || "";
  const hour = startedAt ? new Date(startedAt).getHours() : null;
  return {
    date: plan.date || "",
    type: plan.type || "",
    subTypes: [...(Array.isArray(plan.subTypes) ? plan.subTypes : [])].sort(),
    distance: Number(plan.distance || 0) || 0,
    ascent: Number(plan.ascent || 0) || 0,
    durationMin: Number(plan.durationMin || 0) || Math.round((Number(plan.duration || 0) || 0) / 60),
    timeOfDay: plan.timeOfDay || (Number.isFinite(hour) ? (hour < 12 ? "am" : "pm") : ""),
  };
}

function payloadPlan(plan = {}, index = 0) {
  return {
    id: `suggested-${index}`,
    isPlanned: true,
    date: plan.date || "",
    type: plan.type || "",
    subTypes: Array.isArray(plan.subTypes) ? plan.subTypes : [],
    distance: Number(plan.distance || 0) || 0,
    ascent: Number(plan.ascent || 0) || 0,
    duration: Math.round((Number(plan.duration || plan.durationMin || 0) || 0) * 60),
    timeOfDay: plan.timeOfDay || "",
  };
}

function sameSnapshot(a, b) {
  return JSON.stringify(normalizedSnapshot(a)) === JSON.stringify(normalizedSnapshot(b));
}

function outcomeSignature(outcome) {
  const c = outcome.counts;
  return [outcome.periodEnd, c.total, c.completed, c.partial, c.missed, c.modified, c.deleted, outcome.highRpeCount].join(":");
}

export function evaluateExecutedCalendarAction(action, logs = [], now = new Date()) {
  if (!isCreatePlansAction(action) || action?.status !== "executed") return null;
  const suggestions = (Array.isArray(action.payload?.plans) ? action.payload.plans : []).filter(plan => !isRestPlanItem(plan));
  const affectedDates = [...new Set((action.payload?.affectedDates || suggestions.map(plan => plan.date)).filter(Boolean))].sort();
  const today = localDateKey(now);
  if (!suggestions.length || !affectedDates.length || affectedDates.some(date => date >= today)) return null;

  const persisted = findPersistedAgentPlans(logs, action.id);
  const persistedByKey = new Map(persisted.map(plan => [plan.planDetail?.agentActionItemKey, plan]));
  const hasStableItemKeys = persisted.some(plan => plan.planDetail?.agentActionItemKey);
  const executionSnapshots = Array.isArray(action.result?.createdWorkoutSnapshots) ? action.result.createdWorkoutSnapshots : [];
  const evaluationPlans = [];
  let deleted = 0;
  let modified = 0;

  suggestions.forEach((suggestion, index) => {
    const key = `${index}:${suggestion.date || ""}:${suggestion.type || ""}`;
    const current = persistedByKey.get(key) || (!hasStableItemKeys ? persisted[index] : null) || null;
    const intended = executionSnapshots[index] || payloadPlan(suggestion, index);
    if (!current) deleted += 1;
    else if (!sameSnapshot(current, intended)) modified += 1;
    evaluationPlans.push(current || payloadPlan(suggestion, index));
  });

  const matches = matchPlansToActuals(evaluationPlans, logs, { isPast: true });
  const completed = matches.filter(match => match.outcome === "done").length;
  const partial = matches.filter(match => match.outcome === "partial").length;
  const missed = matches.filter(match => match.outcome === "missed").length;
  const highRpeCount = matches.filter(match => Number(match.actual?.rpe || 0) >= 8).length;
  const periodEnd = affectedDates.at(-1);
  const outcome = {
    version: AGENT_OUTCOME_VERSION,
    evaluatedAt: new Date(now).toISOString(),
    periodEnd,
    counts: {
      total: evaluationPlans.length,
      completed,
      partial,
      missed,
      modified,
      deleted,
    },
    highRpeCount,
    observation: "Observed completion after the suggestion; this does not establish that the suggestion caused the result.",
  };
  outcome.signature = outcomeSignature(outcome);
  return outcome;
}

export function attachCalendarActionOutcome(action, logs = [], now = new Date()) {
  const outcome = evaluateExecutedCalendarAction(action, logs, now);
  if (!outcome) return action;
  const previous = action.result?.outcome;
  if (previous?.signature === outcome.signature) return action;
  return {
    ...action,
    result: {
      ...(action.result || {}),
      outcome,
    },
  };
}

export function evaluateExecutedCalendarActions(actions = [], logs = [], now = new Date(), { contextFresh = true } = {}) {
  if (!contextFresh) return actions;
  return (actions || []).map(action => attachCalendarActionOutcome(action, logs, now));
}
