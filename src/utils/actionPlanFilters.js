export const PROACTIVE_PLAN_ACTION_SOURCES = new Set([
  "plan_deviation_rescue",
  "recovery_load_guard",
  "combined_training_adjustment",
]);

const PROACTIVE_KIND_ALIASES = {
  plan_deviation_rescue: ["plan_deviation_rescue", "combined_training_adjustment"],
  recovery_load_guard: ["recovery_load_guard", "combined_training_adjustment"],
  combined_training_adjustment: ["combined_training_adjustment"],
};

function localDateKey(d = new Date()) {
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function isProactiveCalendarAction(actionOrSource) {
  const source = typeof actionOrSource === "string"
    ? actionOrSource
    : String(actionOrSource?.source || "");
  return PROACTIVE_PLAN_ACTION_SOURCES.has(source)
    || !!(actionOrSource && typeof actionOrSource === "object" && actionOrSource.payload?.proactiveTrigger);
}

export function filterActionableProactivePlans(plans = [], actionOrSource, now = new Date()) {
  const safePlans = Array.isArray(plans) ? plans.filter(Boolean) : [];
  if (!isProactiveCalendarAction(actionOrSource)) return safePlans;
  const today = localDateKey(now);
  return safePlans.filter(plan => String(plan?.date || "") > today);
}

export function getProactiveActionKind(actionOrSource) {
  if (typeof actionOrSource === "string") {
    return PROACTIVE_PLAN_ACTION_SOURCES.has(actionOrSource) ? actionOrSource : "";
  }
  const payloadKind = String(actionOrSource?.payload?.proactiveTrigger?.kind || "");
  if (PROACTIVE_PLAN_ACTION_SOURCES.has(payloadKind)) return payloadKind;
  const source = String(actionOrSource?.source || "");
  return PROACTIVE_PLAN_ACTION_SOURCES.has(source) ? source : "";
}

export function shouldAutoTriggerPlanDeviation(summary) {
  if (!summary?.affectedCount) return false;
  const missedCount = Number(summary.missedCount || 0);
  const partialCount = Number(summary.partialCount || 0);
  const affectedCount = Number(summary.affectedCount || 0);
  const affectedItems = Array.isArray(summary.items) ? summary.items : [];
  const hasKeySessionMiss = affectedItems.some(item => item?.keySession === true);
  return missedCount >= 2
    || (missedCount >= 1 && partialCount >= 1)
    || affectedCount >= 3
    || hasKeySessionMiss;
}

export function shouldAutoTriggerRecoveryGuard(summary) {
  if (!summary?.signalCount) return false;
  const severity = String(summary.severity || "");
  const score = Number(summary.score || 0);
  const hardFuturePlanCount = Number(summary.hardFuturePlanCount || 0);
  const hasCriticalSignal = Array.isArray(summary.signals)
    && summary.signals.some(signal => Number(signal?.level || 0) >= 3);
  return severity === "danger"
    || severity === "high"
    || score >= 3
    || (score >= 2 && hardFuturePlanCount > 0)
    || hasCriticalSignal;
}

export function shouldAutoQuietProactiveAction(actions = [], kind = "", now = new Date(), opts = {}) {
  const targetKind = String(kind || "");
  if (!targetKind) return false;
  const windowDays = Number(opts.windowDays || 14);
  const threshold = Number(opts.rejectedThreshold || 2);
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(nowMs)) return false;
  const cutoff = nowMs - windowDays * 24 * 60 * 60 * 1000;
  const relatedKinds = new Set(PROACTIVE_KIND_ALIASES[targetKind] || [targetKind]);
  const rejectedCount = (Array.isArray(actions) ? actions : []).filter(action => {
    const actionKind = getProactiveActionKind(action);
    if (!relatedKinds.has(actionKind)) return false;
    const status = String(action?.status || "").toLowerCase();
    if (status !== "rejected" && status !== "cancelled") return false;
    const at = new Date(action.decidedAt || action.updatedAt || action.createdAt || "").getTime();
    return Number.isFinite(at) && at >= cutoff && at <= nowMs;
  }).length;
  return rejectedCount >= threshold;
}
