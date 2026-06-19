export const AGENT_ACTION_TYPES = {
  CREATE_PLANS: "create_plans",
};

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

export function describeCreatePlansImpact(action, existingPlans = []) {
  const plans = getCreatePlans(action);
  const affectedDates = [...new Set(plans.map(p => p?.date).filter(Boolean))].sort();
  const existingByDate = new Map();
  for (const p of existingPlans || []) {
    if (!p?.date || !p.isPlanned) continue;
    existingByDate.set(p.date, (existingByDate.get(p.date) || 0) + 1);
  }
  const overwrittenDates = affectedDates
    .map(date => ({ date, count: existingByDate.get(date) || 0 }))
    .filter(x => x.count > 0);

  return {
    createCount: plans.length,
    affectedDates,
    overwrittenDates,
    replacesExistingPlans: action?.payload?.replacesExistingPlans !== false,
  };
}
