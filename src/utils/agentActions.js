export const AGENT_ACTION_TYPES = {
  CREATE_PLANS: "create_plans",
  MEMORY_UPDATE: "memory_update",
};

export const AGENT_ACTION_STATUS = {
  PROPOSED: "proposed",
  ACCEPTED: "accepted",
  EXECUTING: "executing",
  EXECUTED: "executed",
  REJECTED: "rejected",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

export function isRestPlanItem(plan) {
  const kind = String(plan?.kind || "").toLowerCase();
  const type = String(plan?.type || "").toLowerCase();
  return kind === "rest" || type === "rest" || type === "planned rest";
}

function inferCreatePlansRisk(plans, opts = {}) {
  if (opts.risk) return opts.risk;
  if (Number(opts.replacesExistingPlanCount || 0) > 0) return "medium";
  if (plans.length > 1) return "medium";
  return "low";
}

export function buildCreatePlansAction(plans, opts = {}) {
  const safePlans = Array.isArray(plans) ? plans.filter(Boolean) : [];
  const affectedDates = [...new Set(safePlans.map(p => p?.date).filter(Boolean))].sort();
  return {
    id: opts.id || `create-plans-${opts.sourceMessageId || Date.now()}`,
    type: AGENT_ACTION_TYPES.CREATE_PLANS,
    title: "Create calendar plans",
    reason: "The coach found dated training suggestions that can be reviewed and added to Calendar.",
    payload: {
      plans: safePlans,
      affectedDates,
      replacesExistingPlans: opts.replacesExistingPlans !== false,
    },
    risk: inferCreatePlansRisk(safePlans, opts),
    requiresConfirmation: true,
    source: opts.source || "ai_coach_reply",
    sourceMessageId: opts.sourceMessageId || null,
    status: opts.status || AGENT_ACTION_STATUS.PROPOSED,
    createdAt: opts.createdAt || new Date().toISOString(),
    decidedAt: opts.decidedAt || null,
  };
}

export function buildMemoryUpdateAction(memory, opts = {}) {
  return {
    id: opts.id || `memory-update-${Date.now()}`,
    type: AGENT_ACTION_TYPES.MEMORY_UPDATE,
    title: "Update long-term memory",
    reason: "The coach found durable facts in this chat that can be reviewed and saved to Memory.",
    payload: {
      memory: memory && typeof memory === "object" ? memory : { en: "", zh: "" },
      sourceMessageCount: Number(opts.sourceMessageCount || 0),
    },
    risk: opts.risk || "low",
    requiresConfirmation: true,
    source: opts.source || "ai_coach_memory",
    sourceMessageId: opts.sourceMessageId || null,
    status: opts.status || AGENT_ACTION_STATUS.PROPOSED,
    createdAt: opts.createdAt || new Date().toISOString(),
    decidedAt: opts.decidedAt || null,
  };
}

export function markAgentActionStatus(action, status, now = new Date()) {
  if (!action || !status) return action;
  const timestamp = now instanceof Date ? now.toISOString() : String(now);
  return {
    ...action,
    status,
    decidedAt: status === AGENT_ACTION_STATUS.PROPOSED
      ? null
      : (action.decidedAt || timestamp),
    executedAt: status === AGENT_ACTION_STATUS.EXECUTED
      ? timestamp
      : (action.executedAt || null),
  };
}

export function completeAgentAction(action, result = {}, now = new Date()) {
  return {
    ...markAgentActionStatus(action, AGENT_ACTION_STATUS.EXECUTED, now),
    result: result && typeof result === "object" ? result : {},
    error: "",
  };
}

export function failAgentAction(action, error, now = new Date()) {
  const message = error?.message || String(error || "Action failed");
  return {
    ...markAgentActionStatus(action, AGENT_ACTION_STATUS.FAILED, now),
    error: message,
  };
}

export function isCreatePlansAction(action) {
  return action?.type === AGENT_ACTION_TYPES.CREATE_PLANS;
}

export function isMemoryUpdateAction(action) {
  return action?.type === AGENT_ACTION_TYPES.MEMORY_UPDATE;
}

export function getCreatePlans(action) {
  if (!isCreatePlansAction(action)) return [];
  return Array.isArray(action.payload?.plans) ? action.payload.plans : [];
}

export function getMemoryUpdate(action) {
  if (!isMemoryUpdateAction(action)) return { en: "", zh: "" };
  return action.payload?.memory && typeof action.payload.memory === "object"
    ? action.payload.memory
    : { en: "", zh: "" };
}

export function describeCreatePlansImpact(action, existingPlans = []) {
  const plans = getCreatePlans(action);
  const affectedDates = [...new Set(plans.map(p => p?.date).filter(Boolean))].sort();
  const restDates = [...new Set(plans.filter(isRestPlanItem).map(p => p?.date).filter(Boolean))].sort();
  const workoutPlans = plans.filter(p => !isRestPlanItem(p));
  const existingByDate = new Map();
  for (const p of existingPlans || []) {
    if (!p?.date || !p.isPlanned) continue;
    existingByDate.set(p.date, (existingByDate.get(p.date) || 0) + 1);
  }
  const overwrittenDates = affectedDates
    .map(date => ({ date, count: existingByDate.get(date) || 0 }))
    .filter(x => x.count > 0);

  return {
    itemCount: plans.length,
    createCount: workoutPlans.length,
    restCount: restDates.length,
    affectedDates,
    restDates,
    overwrittenDates,
    replacesExistingPlans: action?.payload?.replacesExistingPlans !== false,
  };
}
