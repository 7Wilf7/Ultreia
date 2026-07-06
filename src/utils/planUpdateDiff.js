import { RUN_PACE_TYPES, STRENGTH_SUBS } from "../constants";
import { getPlanTargetId, isRestPlanItem } from "./agentActions";
import { startedAtToTimeOfDay } from "./format";
import { planFields } from "./planFields";

function numberOrZero(value) {
  if (value == null || value === "") return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function closeEnough(a, b, tolerance = 0) {
  return Math.abs(numberOrZero(a) - numberOrZero(b)) <= tolerance;
}

function stringSet(values, allowed) {
  const allowedSet = new Set(allowed);
  return new Set((Array.isArray(values) ? values : [])
    .map(v => String(v || "").trim())
    .filter(v => allowedSet.has(v)));
}

function sameSet(a, b) {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

function runType(values) {
  return (Array.isArray(values) ? values : []).find(st => RUN_PACE_TYPES.includes(st)) || "";
}

function planDurationMinutes(plan) {
  if (plan?.durationMin != null) return numberOrZero(plan.durationMin);
  return numberOrZero(plan?.duration);
}

function existingDurationMinutes(plan) {
  return numberOrZero(plan?.duration) / 60;
}

function planSpeed(plan) {
  return numberOrZero(plan?.speed ?? plan?.planDetail?.speed);
}

function existingSpeed(plan) {
  return numberOrZero(plan?.planDetail?.speed);
}

function proposedTimeOfDay(plan) {
  if (plan?.timeOfDay === "am" || plan?.timeOfDay === "pm") return plan.timeOfDay;
  if (plan?.startedAt) return startedAtToTimeOfDay(plan.startedAt);
  return "";
}

function sameWorkoutShape(proposal, existing) {
  const type = String(proposal?.type || "").trim();
  if (!type || type !== String(existing?.type || "").trim()) return false;
  if (String(proposal?.date || "") !== String(existing?.date || "")) return false;
  if (proposedTimeOfDay(proposal) !== startedAtToTimeOfDay(existing?.startedAt)) return false;

  const f = planFields(type);
  if (f.distance && !closeEnough(proposal?.distance, existing?.distance, 0.05)) return false;
  if (f.ascent && !closeEnough(proposal?.ascent, existing?.ascent, 1)) return false;
  if (f.speed && !closeEnough(planSpeed(proposal), existingSpeed(existing), 0.05)) return false;
  if (f.duration && !closeEnough(planDurationMinutes(proposal), existingDurationMinutes(existing), 1)) return false;
  if (f.runType && runType(proposal?.subTypes) !== runType(existing?.subTypes)) return false;
  if (f.strength && !sameSet(
    stringSet(proposal?.subTypes, STRENGTH_SUBS),
    stringSet(existing?.subTypes, STRENGTH_SUBS),
  )) return false;

  if (proposal?.keySession === true && existing?.planDetail?.keySession !== true) return false;
  return true;
}

export function isNoopPlanUpdate(plan, existingPlans = []) {
  if (!plan || isRestPlanItem(plan)) return false;
  const targetPlanId = getPlanTargetId(plan);
  if (!targetPlanId) return false;
  const existing = (Array.isArray(existingPlans) ? existingPlans : [])
    .find(p => String(p?.id || "") === targetPlanId && p?.isPlanned);
  if (!existing) return false;
  return sameWorkoutShape(plan, existing);
}

export function filterNoopPlanUpdates(plans = [], existingPlans = []) {
  return (Array.isArray(plans) ? plans : [])
    .filter(plan => !isNoopPlanUpdate(plan, existingPlans));
}
