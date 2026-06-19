export const AGENT_ACTION_TYPES = {
  CREATE_PLANS: "create_plans",
};

export function buildCreatePlansAction(plans, opts = {}) {
  const safePlans = Array.isArray(plans) ? plans.filter(Boolean) : [];
  return {
    id: opts.id || `create-plans-${opts.sourceMessageId || Date.now()}`,
    type: AGENT_ACTION_TYPES.CREATE_PLANS,
    title: "Create calendar plans",
    reason: "The coach found dated training suggestions that can be reviewed and added to Calendar.",
    payload: { plans: safePlans },
    risk: "medium",
    requiresConfirmation: true,
    source: opts.source || "ai_coach_reply",
    sourceMessageId: opts.sourceMessageId || null,
    status: "proposed",
    createdAt: opts.createdAt || new Date().toISOString(),
  };
}

export function isCreatePlansAction(action) {
  return action?.type === AGENT_ACTION_TYPES.CREATE_PLANS;
}

export function getCreatePlans(action) {
  if (!isCreatePlansAction(action)) return [];
  return Array.isArray(action.payload?.plans) ? action.payload.plans : [];
}
