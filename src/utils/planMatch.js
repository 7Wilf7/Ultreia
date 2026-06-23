// Plan ↔ actual reconciliation. A planned session is matched against the
// COMPLETED (non-planned) workouts on the SAME DATE and of the SAME TYPE, then
// the planned target metric is compared to what was actually done:
//   • distance types (runs / trail / hiking / cycling) → compare distance
//   • floor-climbing-style ascent-only plans            → compare ascent
//   • swim / strength (time targets)                    → compare duration
//   • HIIT / metric-less plans                          → any same-type session = done
// Over-achievement counts as done (planned 5 km, ran 8 km → done). A same-type
// session that falls short is "partial"; no same-type session at all is "missed"
// (past) or "pending" (today/future). Explicit "done" still wins; legacy
// "skipped" values are intentionally ignored and fall back to matching.
//
// Shared by the Calendar day modal (per-row badge) and the AI Coach prompt's
// plan-adherence block so the app and the coach agree on what "done" means.

// Completion threshold — actual/planned at or above this counts as done.
export const PLAN_DONE_RATIO = 0.8;

// Which planned field is the target to compare against. Order matters: distance
// is the headline metric for endurance types; ascent for pure climbs; duration
// for time-based work.
function planTarget(plan) {
  if (plan.distance > 0) return { kind: "distance", target: plan.distance };
  if (plan.ascent > 0) return { kind: "ascent", target: plan.ascent };
  if (plan.duration > 0) return { kind: "duration", target: plan.duration };
  return { kind: "none", target: 0 };
}

// Evaluate one planned row against a day's logs.
//   plan     — the planned workout row (isPlanned === true)
//   dayLogs  — ALL logs on that date (planned + completed); we filter internally
//   isPast   — whether the date is strictly before today
// Returns { outcome, ratio }:
//   outcome: 'done' | 'partial' | 'missed' | 'pending' | null
//   ratio:   actual/target when a quantitative compare happened, else null
export function evaluatePlanOutcome(plan, dayLogs, { isPast } = {}) {
  if (!plan?.isPlanned) return { outcome: null, ratio: null };
  if (plan.planStatus === "done") return { outcome: "done", ratio: null };

  const sameType = (dayLogs || []).filter(l => !l.isPlanned && l.type === plan.type);
  if (sameType.length === 0) return { outcome: isPast ? "missed" : "pending", ratio: null };

  const { kind, target } = planTarget(plan);
  if (kind === "none" || target <= 0) return { outcome: "done", ratio: null };

  const actual = sameType.reduce((sum, l) => sum + (Number(l[kind]) || 0), 0);
  const ratio = target > 0 ? actual / target : 0;
  return ratio >= PLAN_DONE_RATIO
    ? { outcome: "done", ratio }
    : { outcome: "partial", ratio };
}
