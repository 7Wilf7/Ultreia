import { ACTIVITY_TYPES } from "../constants";
import { evaluatePlanOutcome } from "./planMatch";

const DAY_MS = 24 * 60 * 60 * 1000;

function localDateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfLocalDay(d = new Date()) {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function dateKeyMs(dateKey) {
  const ms = new Date(`${dateKey}T00:00:00`).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function planMetric(plan) {
  if (Number(plan?.distance) > 0) return `${Number(plan.distance)}km`;
  if (Number(plan?.ascent) > 0) return `+${Math.round(Number(plan.ascent))}m`;
  if (Number(plan?.duration) > 0) return `${Math.round(Number(plan.duration) / 60)}min`;
  if (Number(plan?.planDetail?.speed) > 0) return `${Number(plan.planDetail.speed)}km/h`;
  return "";
}

function planLine(plan) {
  const parts = [
    plan.id ? `plan_id=${plan.id}` : "",
    plan.date,
    plan.type,
    Array.isArray(plan.subTypes) && plan.subTypes.length ? `(${plan.subTypes.join(", ")})` : "",
    planMetric(plan),
  ].filter(Boolean);
  return parts.join(" ");
}

function compactDeviationItem(plan, outcome, ratio) {
  return {
    planId: plan.id || "",
    date: plan.date || "",
    type: plan.type || "",
    subTypes: Array.isArray(plan.subTypes) ? plan.subTypes.filter(Boolean) : [],
    target: planMetric(plan),
    outcome,
    ratio: Number.isFinite(ratio) ? Number(ratio.toFixed(2)) : null,
    line: planLine(plan),
  };
}

export function summarizePlanDeviation(logs = [], now = new Date(), opts = {}) {
  const safeLogs = Array.isArray(logs) ? logs : [];
  const lookbackDays = Number(opts.lookbackDays || 14);
  const futureDays = Number(opts.futureDays || 7);
  const today = startOfLocalDay(now);
  const todayMs = today.getTime();
  const windowStartMs = todayMs - lookbackDays * DAY_MS;
  const futureEndMs = todayMs + futureDays * DAY_MS;

  const planned = safeLogs
    .filter(l => l?.isPlanned && l.date)
    .map(l => ({ plan: l, ms: dateKeyMs(l.date) }))
    .filter(x => x.ms != null);

  const pastPlans = planned
    .filter(x => x.ms < todayMs && x.ms >= windowStartMs)
    .map(x => x.plan)
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  if (!pastPlans.length) return null;

  let doneCount = 0;
  let partialCount = 0;
  let missedCount = 0;
  const items = [];

  for (const plan of pastPlans) {
    const dayLogs = safeLogs.filter(l => l?.date === plan.date);
    const { outcome, ratio } = evaluatePlanOutcome(plan, dayLogs, { isPast: true });
    if (outcome === "done") {
      doneCount += 1;
    } else if (outcome === "partial") {
      partialCount += 1;
      items.push(compactDeviationItem(plan, outcome, ratio));
    } else if (outcome === "missed") {
      missedCount += 1;
      items.push(compactDeviationItem(plan, outcome, ratio));
    }
  }

  const affectedCount = partialCount + missedCount;
  if (affectedCount === 0) return null;

  const futurePlans = planned
    .filter(x => x.ms >= todayMs && x.ms <= futureEndMs)
    .map(x => x.plan)
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
    .map(p => ({
      planId: p.id || "",
      date: p.date || "",
      type: p.type || "",
      subTypes: Array.isArray(p.subTypes) ? p.subTypes.filter(Boolean) : [],
      target: planMetric(p),
      line: planLine(p),
    }));

  const signature = [
    localDateKey(today),
    lookbackDays,
    ...items.map(i => `${i.date}:${i.planId || i.type}:${i.outcome}:${i.ratio ?? ""}`),
  ].join("|");

  return {
    lookbackDays,
    futureDays,
    today: localDateKey(today),
    doneCount,
    partialCount,
    missedCount,
    affectedCount,
    totalPastPlanCount: pastPlans.length,
    items,
    futurePlans,
    signature,
  };
}

export function buildPlanDeviationRescuePrompt({ summary, dataBlock, now = new Date() }) {
  const todayStr = localDateKey(now);
  const dayOfWeek = now.toLocaleDateString("en-US", { weekday: "long" });
  const typeUnion = ACTIVITY_TYPES.map(at => `"${at}"`).join(" | ");
  const deviations = (summary?.items || [])
    .map(i => `- ${i.line} -> ${i.outcome}${i.ratio != null ? ` (actual/target ${i.ratio})` : ""}`)
    .join("\n") || "- none";
  const futurePlans = (summary?.futurePlans || [])
    .map(p => `- ${p.line}`)
    .join("\n") || "- none in the next 7 days";

  return `You are Ultreia's AI Coach action planner. Generate a small, reviewable calendar Action Card to repair recent plan deviation.

Today is ${todayStr} (${dayOfWeek}, GMT+8).

Recent plan deviations (${summary?.lookbackDays || 14}d):
${deviations}

Upcoming plans that may be adjusted:
${futurePlans}

Full training context:
---
${dataBlock || ""}
---

Output a JSON array only. Each item:
{
  "kind": "workout" | "rest" (optional; use "rest" only for an explicit no-workout / planned rest day),
  "action": "create" | "update" (optional; use "update" ONLY when modifying one existing future plan from [Planned Sessions]),
  "targetPlanId": string (required ONLY for action="update"; copy the exact plan_id from [Planned Sessions]),
  "date": "YYYY-MM-DD",
  "type": ${typeUnion} (required for workout items; omit for rest items),
  "distance": number (kilometres, optional),
  "ascent": number (metres of climb, optional),
  "speed": number (km/h, cycling target, optional),
  "duration": number (MINUTES, optional),
  "subTypes": ["Easy Run" | "Aerobic Run" | "Tempo Run" | "Interval Run" | "Race" | "Upper Body" | "Lower Body" | "Core"] (optional, only when relevant),
  "timeOfDay": "am" | "pm" (optional),
  "notes": string (brief Chinese reason; include why this is a rescue adjustment)
}

Rules:
- Keep the proposal small: usually 1-3 items, never more than 5.
- Do NOT simply stack missed volume back on top of the current plan.
- Prefer realistic redistribution, easy aerobic work, rest, or reducing a future session when recent deviation suggests fatigue / time pressure.
- Use action="update" only for a future planned session that has an exact plan_id in [Planned Sessions]. Output the FULL replacement plan, not a patch.
- If no exact future plan should be changed, create a new dated item or a dated rest day instead.
- Date all items between today and the next 7 days unless a target race context clearly justifies a slightly later date.
- Each TYPE has its OWN fields — emit only these, omit the rest:
  - Road Run: "distance"; put run intensity in "subTypes" as exactly one of "Easy Run"/"Aerobic Run"/"Tempo Run"/"Interval Run" when needed. Do NOT emit "duration" for Road Run.
  - Trail Run / Hiking: "distance" and "ascent" (metres). Do NOT emit "duration".
  - Floor Climbing: "ascent" only.
  - Cycling: "distance" and "speed" (km/h) when given.
  - Swimming: "duration" only.
  - Strength: "subTypes" = area(s) ("Upper Body"/"Lower Body"/"Core").
  - HIIT: emit ONLY "timeOfDay" and notes; no distance/duration.
- A rest day item must be exactly { "kind": "rest", "date": "YYYY-MM-DD", "notes": "..." } with no type.
- If a safe, concrete rescue action is not justified, output [].
- Output the JSON array ONLY. No prose, no markdown fences, no comments.`;
}
