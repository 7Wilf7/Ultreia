import { ACTIVITY_TYPES } from "../constants";
import { computeTrainingLoad } from "./trainingLoad";

const DAY_MS = 24 * 60 * 60 * 1000;
const PAIN_FATIGUE_RE = /(pain|ache|injur|niggle|tight|sore|fatigue|tired|exhaust|\bill\b|sick|疼|痛|不适|伤|疲|累|酸|紧|生病|感冒|发烧|跟腱|膝|小腿|胫骨|髂胫束)/i;

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

function isKeySession(plan) {
  return plan?.planDetail?.keySession === true;
}

function planLine(plan) {
  const parts = [
    plan.id ? `plan_id=${plan.id}` : "",
    plan.date,
    plan.type,
    Array.isArray(plan.subTypes) && plan.subTypes.length ? `(${plan.subTypes.join(", ")})` : "",
    planMetric(plan),
    isKeySession(plan) ? "key_session=true" : "",
  ].filter(Boolean);
  return parts.join(" ");
}

function compactPlan(plan) {
  return {
    planId: plan.id || "",
    date: plan.date || "",
    type: plan.type || "",
    subTypes: Array.isArray(plan.subTypes) ? plan.subTypes.filter(Boolean) : [],
    target: planMetric(plan),
    keySession: isKeySession(plan),
    line: planLine(plan),
  };
}

function isHardFuturePlan(plan) {
  const subTypes = Array.isArray(plan?.subTypes) ? plan.subTypes.map(String) : [];
  if (subTypes.some(st => /Tempo|Interval|Race/i.test(st))) return true;
  if (plan?.type === "Trail Run" && (Number(plan.distance) >= 15 || Number(plan.ascent) >= 500)) return true;
  if (plan?.type === "Road Run" && Number(plan.distance) >= 14) return true;
  if (plan?.type === "Floor Climbing" && Number(plan.ascent) >= 600) return true;
  if (plan?.type === "Strength" && subTypes.includes("Lower Body")) return true;
  return false;
}

function readinessScore(readiness) {
  if (!readiness || typeof readiness !== "object") return null;
  const vals = ["sleep", "legs", "energy"]
    .map(key => Number(readiness[key]))
    .filter(v => Number.isFinite(v) && v > 0);
  if (!vals.length) return null;
  const poorCount = vals.filter(v => v === 1).length;
  const avg = vals.reduce((sum, v) => sum + v, 0) / vals.length;
  return { avg, poorCount, count: vals.length };
}

function signalLine(signal) {
  return `- ${signal.label}${signal.detail ? `: ${signal.detail}` : ""}`;
}

function completedLine(log) {
  const parts = [
    log.date || "",
    log.type || "",
    Array.isArray(log.subTypes) && log.subTypes.length ? `(${log.subTypes.join(", ")})` : "",
    planMetric(log),
    Number(log.rpe) > 0 ? `RPE ${Number(log.rpe)}` : "",
    log.note ? `note="${String(log.note).slice(0, 140)}"` : "",
  ].filter(Boolean);
  return parts.join(" ");
}

export function summarizeRecoveryGuard(logs = [], dailyNotes = [], now = new Date(), opts = {}) {
  const safeLogs = Array.isArray(logs) ? logs : [];
  const safeNotes = Array.isArray(dailyNotes) ? dailyNotes : [];
  const lookbackDays = Number(opts.lookbackDays || 7);
  const futureDays = Number(opts.futureDays || 7);
  const today = startOfLocalDay(now);
  const todayMs = today.getTime();
  const lookbackStartMs = todayMs - lookbackDays * DAY_MS;
  const futureEndMs = todayMs + futureDays * DAY_MS;

  const futurePlanRows = safeLogs
    .filter(l => l?.isPlanned && l.date)
    .map(l => ({ plan: l, ms: dateKeyMs(l.date) }))
    .filter(x => x.ms != null && x.ms > todayMs && x.ms <= futureEndMs)
    .sort((a, b) => (a.plan.date || "").localeCompare(b.plan.date || ""));
  const futurePlans = futurePlanRows.map(x => compactPlan(x.plan));

  if (!futurePlans.length) return null;

  const recentCompleted = safeLogs
    .filter(l => l && !l.isPlanned && l.date)
    .map(l => ({ log: l, ms: dateKeyMs(l.date) }))
    .filter(x => x.ms != null && x.ms >= lookbackStartMs && x.ms <= todayMs)
    .sort((a, b) => (a.log.date || "").localeCompare(b.log.date || ""))
    .map(x => x.log);

  const signals = [];
  const load = computeTrainingLoad(safeLogs, now);
  if (load && !load.building && (load.ramp === "high" || load.ramp === "danger")) {
    signals.push({
      id: `load_${load.ramp}`,
      level: load.ramp === "danger" ? 3 : 2,
      label: "Training load spike",
      detail: `EWMA ACWR ${load.acwr} (${load.ramp}); acute ${load.acute}, chronic ${load.chronicWeekly}`,
    });
  }

  const highRpe = recentCompleted.filter(l => Number(l.rpe) >= 8);
  if (highRpe.length) {
    signals.push({
      id: "high_rpe",
      level: highRpe.length >= 2 ? 2 : 1,
      label: "High recent RPE",
      detail: highRpe.slice(-3).map(l => `${l.date} RPE ${Number(l.rpe)}`).join(", "),
    });
  }

  const noteFlags = recentCompleted.filter(l => PAIN_FATIGUE_RE.test(String(l.note || "")));
  if (noteFlags.length) {
    signals.push({
      id: "pain_fatigue_note",
      level: noteFlags.length >= 2 ? 2 : 1,
      label: "Pain/fatigue note",
      detail: noteFlags.slice(-3).map(l => `${l.date} ${String(l.note || "").slice(0, 60)}`).join("; "),
    });
  }

  const recentNotes = safeNotes
    .filter(n => n?.date)
    .map(n => ({ note: n, ms: dateKeyMs(n.date) }))
    .filter(x => x.ms != null && x.ms >= lookbackStartMs && x.ms <= todayMs)
    .sort((a, b) => (a.note.date || "").localeCompare(b.note.date || ""))
    .map(x => x.note);

  const poorReadiness = recentNotes
    .map(n => ({ note: n, score: readinessScore(n.readiness) }))
    .filter(x => x.score && (x.score.poorCount >= 2 || x.score.avg <= 1.67));
  if (poorReadiness.length) {
    const latest = poorReadiness[poorReadiness.length - 1];
    signals.push({
      id: "poor_readiness",
      level: poorReadiness.length >= 2 ? 2 : 1,
      label: "Poor morning readiness",
      detail: `${latest.note.date} avg ${latest.score.avg.toFixed(1)} (${latest.score.poorCount} poor field(s))`,
    });
  }

  const sickDays = recentNotes.filter(n => Array.isArray(n.tags) && n.tags.includes("sick"));
  if (sickDays.length) {
    signals.push({
      id: "sick_day",
      level: 2,
      label: "Sick day tag",
      detail: sickDays.map(n => n.date).join(", "),
    });
  }

  if (!signals.length) return null;

  const score = signals.reduce((sum, s) => sum + Number(s.level || 1), 0);
  const hasLoadSignal = signals.some(s => String(s.id || "").startsWith("load_"));
  const hardFuturePlans = futurePlanRows
    .filter(x => isHardFuturePlan(x.plan))
    .map(x => compactPlan(x.plan));
  const shouldTrigger = hasLoadSignal || score >= 2;
  if (!shouldTrigger) return null;

  const severity = signals.some(s => s.level >= 3)
    ? "danger"
    : (score >= 3 || (hardFuturePlans.length > 0 && score >= 2) ? "high" : "watch");
  const signature = [
    localDateKey(today),
    lookbackDays,
    futureDays,
    ...signals.map(s => `${s.id}:${s.detail}`),
    ...futurePlans.slice(0, 6).map(p => `${p.date}:${p.planId || p.type}:${p.target}`),
  ].join("|");

  return {
    today: localDateKey(today),
    lookbackDays,
    futureDays,
    severity,
    score,
    signalCount: signals.length,
    futurePlanCount: futurePlans.length,
    hardFuturePlanCount: hardFuturePlans.length,
    signals,
    trainingLoad: load,
    recentSessions: recentCompleted.slice(-6).map(l => ({
      date: l.date || "",
      type: l.type || "",
      rpe: Number(l.rpe) || null,
      note: l.note || "",
      line: completedLine(l),
    })),
    futurePlans,
    hardFuturePlans,
    signature,
  };
}

export function buildRecoveryGuardPrompt({ summary, dataBlock, coachPreferenceBlock = "", now = new Date() }) {
  const todayStr = localDateKey(now);
  const dayOfWeek = now.toLocaleDateString("en-US", { weekday: "long" });
  const typeUnion = ACTIVITY_TYPES.map(at => `"${at}"`).join(" | ");
  const signals = (summary?.signals || []).map(signalLine).join("\n") || "- none";
  const recentSessions = (summary?.recentSessions || []).map(s => `- ${s.line}`).join("\n") || "- none";
  const futurePlans = (summary?.futurePlans || []).map(p => `- ${p.line}`).join("\n") || "- none";

  return `You are Ultreia's AI Coach action planner. Generate a small, reviewable calendar Action Card to protect recovery and reduce load risk.

Today is ${todayStr} (${dayOfWeek}, GMT+8).

Recovery / load signals (${summary?.lookbackDays || 7}d, severity=${summary?.severity || "watch"}):
${signals}

Recent completed sessions:
${recentSessions}

Upcoming plans that may be adjusted:
${futurePlans}

Coach preference context:
---
${coachPreferenceBlock || "(not set)"}
---

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
  "notes": string (brief Chinese reason; explain this as recovery/load protection)
}

Rules:
- Keep the proposal small: usually 1-3 items, never more than 4.
- Do NOT diagnose injury or illness. Only adjust training stress and recovery.
- Do NOT add intensity, volume, or race-pace work. This card is for backing off, reshaping, or protecting recovery.
- Plans marked key_session=true are protected anchor workouts. Prefer adjusting surrounding non-key easy/recovery/support sessions first.
- Do NOT update, replace, or rest out a key_session=true plan unless there is a clear reason such as injury/illness signs, severe recovery/load risk, severe weather, or target-race conflict. If you change one, notes must explicitly explain why the key session is being changed.
- Prefer modifying an existing risky future plan to easier/shorter work, or replacing it with a planned rest day when justified.
- Use action="update" only for a future planned session from tomorrow onward that has an exact plan_id in [Planned Sessions]. Output the FULL replacement plan, not a patch.
- If no exact future plan should be changed, create a new dated easy/recovery item or a dated rest day instead.
- Date all items after today and within the next ${summary?.futureDays || 7} days.
- Each TYPE has its OWN fields — emit only these, omit the rest:
  - Road Run: "distance"; put run intensity in "subTypes" as exactly one of "Easy Run"/"Aerobic Run"/"Tempo Run"/"Interval Run" when needed. Do NOT emit "duration" for Road Run.
  - Trail Run / Hiking: "distance" and "ascent" (metres). Do NOT emit "duration".
  - Floor Climbing: "ascent" only.
  - Cycling: "distance" and "speed" (km/h) when given.
  - Swimming: "duration" only.
  - Strength: "subTypes" = area(s) ("Upper Body"/"Lower Body"/"Core").
  - HIIT: emit ONLY "timeOfDay" and notes; no distance/duration.
- A rest day item must be exactly { "kind": "rest", "date": "YYYY-MM-DD", "notes": "..." } with no type.
- If a safe, concrete recovery/load protection action is not justified, output [].
- Output the JSON array ONLY. No prose, no markdown fences, no comments.`;
}
