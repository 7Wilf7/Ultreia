import { ACTIVITY_TYPES } from "../constants";

function localDateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function lineList(items = [], pick = x => x?.line) {
  const lines = (Array.isArray(items) ? items : [])
    .map(pick)
    .filter(Boolean);
  return lines.length ? lines.map(line => `- ${line}`).join("\n") : "- none";
}

export function planAdjustmentSignature(summary) {
  if (!summary?.affectedCount) return "";
  const items = (Array.isArray(summary.items) ? summary.items : [])
    .map(i => `${i.date || ""}:${i.planId || i.type || ""}:${i.outcome || ""}:${i.ratio ?? ""}`);
  return ["plan", summary.lookbackDays || 14, ...items].join("|");
}

export function recoveryAdjustmentSignature(summary) {
  if (!summary?.signalCount) return "";
  const signals = (Array.isArray(summary.signals) ? summary.signals : [])
    .map(s => `${s.id || s.label || ""}:${s.detail || ""}`);
  const futurePlans = (Array.isArray(summary.futurePlans) ? summary.futurePlans : [])
    .slice(0, 6)
    .map(p => `${p.date || ""}:${p.planId || p.type || ""}:${p.target || ""}`);
  return ["recovery", summary.lookbackDays || 7, summary.futureDays || 7, ...signals, ...futurePlans].join("|");
}

export function trainingAdjustmentSignature(planSummary, recoverySummary) {
  const planSig = planAdjustmentSignature(planSummary);
  const recoverySig = recoveryAdjustmentSignature(recoverySummary);
  if (planSig && recoverySig) return `combined|${planSig}::${recoverySig}`;
  return planSig || recoverySig || "";
}

export function buildCombinedTrainingAdjustmentPrompt({ planSummary, recoverySummary, dataBlock, now = new Date() }) {
  const todayStr = localDateKey(now);
  const dayOfWeek = now.toLocaleDateString("en-US", { weekday: "long" });
  const typeUnion = ACTIVITY_TYPES.map(at => `"${at}"`).join(" | ");
  const deviations = lineList(planSummary?.items, i => (
    `${i.line} -> ${i.outcome}${i.ratio != null ? ` (actual/target ${i.ratio})` : ""}`
  ));
  const recoverySignals = lineList(recoverySummary?.signals, s => (
    `${s.label}${s.detail ? `: ${s.detail}` : ""}`
  ));
  const recentSessions = lineList(recoverySummary?.recentSessions);
  const futurePlans = lineList(
    recoverySummary?.futurePlans?.length ? recoverySummary.futurePlans : planSummary?.futurePlans,
  );

  return `You are Ultreia's AI Coach action planner. Generate ONE combined, reviewable calendar Action Card when recent plan deviation and recovery/load risk are both active.

Today is ${todayStr} (${dayOfWeek}, GMT+8).

Recent plan deviations (${planSummary?.lookbackDays || 14}d):
${deviations}

Recovery / load signals (${recoverySummary?.lookbackDays || 7}d, severity=${recoverySummary?.severity || "watch"}):
${recoverySignals}

Recent completed sessions:
${recentSessions}

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
  "notes": string (brief Chinese reason; explain how this balances missed-plan recovery with load protection)
}

Rules:
- Resolve both issues in ONE proposal. Do not generate separate conflicting rescue and recovery plans.
- Recovery and load protection outrank making up missed volume.
- Do NOT stack missed mileage on top of current training. Prefer lowering stress, moving work, or adding rest.
- Keep the proposal small: usually 1-3 items, never more than 5.
- Do NOT diagnose injury or illness. Only adjust training stress and recovery.
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
- If a safe, concrete combined adjustment is not justified, output [].
- Output the JSON array ONLY. No prose, no markdown fences, no comments.`;
}
