export const PROACTIVE_PLAN_ACTION_SOURCES = new Set([
  "plan_deviation_rescue",
  "recovery_load_guard",
  "combined_training_adjustment",
]);

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
