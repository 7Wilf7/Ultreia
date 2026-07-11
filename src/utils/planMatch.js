// Deterministic one-to-one plan ↔ actual reconciliation.
//
// Matching is performed per date and activity type. An actual workout can
// satisfy at most one planned row. Explicit planStatus="done" remains a manual
// override and does not consume an actual workout. Candidate preference is:
//   1. compatible explicit subtypes / training content;
//   2. closest available distance, duration and ascent targets;
//   3. matching morning/evening slot;
//   4. stable ids/indexes as deterministic tie-breakers.
//
// Calendar, AI Coach adherence, proactive deviation and outcome evaluation all
// use this module so the runner never sees competing definitions of "done".

export const PLAN_DONE_RATIO = 0.8;

const RACE_SUBTYPE = "race";

function numeric(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function stableKey(item, index) {
  return String(item?.id || item?.clientId || `${index}`).trim();
}

function normalizedContentSubtypes(item) {
  return [...new Set((Array.isArray(item?.subTypes) ? item.subTypes : [])
    .map(value => String(value || "").trim().toLowerCase())
    .filter(value => value && value !== RACE_SUBTYPE))]
    .sort();
}

function subtypeCompatibility(plan, actual) {
  const planned = normalizedContentSubtypes(plan);
  const completed = normalizedContentSubtypes(actual);
  if (!planned.length && !completed.length) return { compatible: true, penalty: 0.2 };
  if (!planned.length || !completed.length) return { compatible: true, penalty: 0.35 };
  const overlap = planned.filter(value => completed.includes(value)).length;
  if (overlap === 0) return { compatible: false, penalty: Number.POSITIVE_INFINITY };
  const exact = planned.length === completed.length && overlap === planned.length;
  return { compatible: true, penalty: exact ? 0 : 0.1 };
}

function metricDistance(plan, actual) {
  const metrics = ["distance", "duration", "ascent"];
  let compared = 0;
  let total = 0;
  for (const metric of metrics) {
    const target = numeric(plan?.[metric]);
    const completed = numeric(actual?.[metric]);
    if (!target) continue;
    compared += 1;
    total += completed ? Math.abs(completed - target) / target : 2;
  }
  return compared ? total / compared : 0.75;
}

function timeSlot(item) {
  const explicit = String(item?.timeOfDay || item?.planDetail?.timeOfDay || "").toLowerCase();
  if (explicit === "am" || explicit === "pm") return explicit;
  if (!item?.startedAt) return "";
  const d = new Date(item.startedAt);
  if (Number.isNaN(d.getTime())) return "";
  return d.getHours() < 12 ? "am" : "pm";
}

function candidateScore(plan, actual) {
  const subtype = subtypeCompatibility(plan, actual);
  if (!subtype.compatible) return null;
  const planSlot = timeSlot(plan);
  const actualSlot = timeSlot(actual);
  const timePenalty = planSlot && actualSlot ? (planSlot === actualSlot ? 0 : 0.3) : 0.12;
  return subtype.penalty * 100 + metricDistance(plan, actual) * 10 + timePenalty;
}

function planTarget(plan) {
  if (numeric(plan?.distance)) return { kind: "distance", target: numeric(plan.distance) };
  if (numeric(plan?.ascent)) return { kind: "ascent", target: numeric(plan.ascent) };
  if (numeric(plan?.duration)) return { kind: "duration", target: numeric(plan.duration) };
  return { kind: "none", target: 0 };
}

function resultForMatch(plan, actual, isPast) {
  if (!actual) return { outcome: isPast ? "missed" : "pending", ratio: null, actual: null };
  const { kind, target } = planTarget(plan);
  if (kind === "none" || target <= 0) return { outcome: "done", ratio: null, actual };
  const ratio = numeric(actual?.[kind]) / target;
  return ratio >= PLAN_DONE_RATIO
    ? { outcome: "done", ratio, actual }
    : { outcome: "partial", ratio, actual };
}

// Returns one result per planned row, in input order:
// { plan, actual, outcome, ratio }. Plans and completed workouts may span
// multiple dates; candidates are always restricted to the same date + type.
export function matchPlansToActuals(plans = [], dayLogs = [], { isPast = false } = {}) {
  const safePlans = (Array.isArray(plans) ? plans : []).filter(plan => plan?.isPlanned);
  const actuals = (Array.isArray(dayLogs) ? dayLogs : []).filter(log => log && !log.isPlanned);
  const results = new Map();
  const availablePlans = [];

  safePlans.forEach((plan, planIndex) => {
    if (plan.planStatus === "done") {
      results.set(plan, { plan, outcome: "done", ratio: null, actual: null });
    } else {
      availablePlans.push({ plan, planIndex, key: stableKey(plan, planIndex) });
    }
  });

  const candidates = [];
  availablePlans.forEach((planEntry) => {
    actuals.forEach((actual, actualIndex) => {
      if (actual.date !== planEntry.plan.date || actual.type !== planEntry.plan.type) return;
      const score = candidateScore(planEntry.plan, actual);
      if (score == null) return;
      candidates.push({
        ...planEntry,
        actual,
        actualIndex,
        actualKey: stableKey(actual, actualIndex),
        score,
      });
    });
  });

  candidates.sort((a, b) => (
    a.score - b.score
    || a.key.localeCompare(b.key)
    || a.actualKey.localeCompare(b.actualKey)
    || a.planIndex - b.planIndex
    || a.actualIndex - b.actualIndex
  ));

  const matchedPlans = new Set();
  const matchedActuals = new Set();
  for (const candidate of candidates) {
    if (matchedPlans.has(candidate.plan) || matchedActuals.has(candidate.actual)) continue;
    matchedPlans.add(candidate.plan);
    matchedActuals.add(candidate.actual);
    results.set(candidate.plan, {
      plan: candidate.plan,
      ...resultForMatch(candidate.plan, candidate.actual, isPast),
    });
  }

  for (const { plan } of availablePlans) {
    if (!results.has(plan)) results.set(plan, { plan, ...resultForMatch(plan, null, isPast) });
  }
  return safePlans.map(plan => results.get(plan));
}

// Compatibility helper for isolated callers. Shared product flows with more
// than one plan must call matchPlansToActuals once for the whole day/window.
export function evaluatePlanOutcome(plan, dayLogs, { isPast } = {}) {
  if (!plan?.isPlanned) return { outcome: null, ratio: null };
  const result = matchPlansToActuals([plan], dayLogs, { isPast })[0];
  return { outcome: result?.outcome ?? null, ratio: result?.ratio ?? null };
}
