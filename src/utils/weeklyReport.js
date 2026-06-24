import { formatDuration, formatPaceFromSec } from "./format";
import { buildDataBlock } from "./coachPrompt";

export const KEEP_REPORTS = 8;
const STORAGE_KEY_PREFIX = "ultreia.weeklyReports.v1";

function localDateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(dateKey, days) {
  const d = new Date(`${dateKey}T00:00:00`);
  d.setDate(d.getDate() + days);
  return localDateKey(d);
}

export function weekWindow(now, offsetWeeks = 0) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetWeeks * 7);
  const mondayOffset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - mondayOffset);
  const start = localDateKey(d);
  return {
    start,
    end: addDays(start, 6),
    nextStart: addDays(start, 7),
    nextEnd: addDays(start, 13),
  };
}

function storageKey(scope) {
  return `${STORAGE_KEY_PREFIX}.${scope || "default"}`;
}

export function loadStoredReports(scope) {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(scope)) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveStoredReports(scope, reports) {
  try {
    localStorage.setItem(storageKey(scope), JSON.stringify(reports.slice(0, KEEP_REPORTS)));
  } catch {
    // localStorage may be unavailable in private mode; the in-session state
    // still keeps the report visible until the app reloads.
  }
}

function fmtWorkout(w) {
  const bits = [w.date, w.type];
  if (Array.isArray(w.subTypes) && w.subTypes.length) bits.push(w.subTypes.join("/"));
  if (w.distance > 0) bits.push(`${Number(w.distance).toFixed(1)} km`);
  if (w.ascent > 0) bits.push(`+${Math.round(w.ascent)} m`);
  if (w.duration > 0) bits.push(formatDuration(w.duration));
  if (w.pace > 0) bits.push(`${formatPaceFromSec(w.pace)}/km`);
  if (w.hr > 0) bits.push(`avg HR ${w.hr}`);
  if (w.maxHR > 0) bits.push(`max HR ${w.maxHR}`);
  if (w.rpe > 0) bits.push(`RPE ${w.rpe}`);
  if (w.aerobicTE > 0) bits.push(`TE ${w.aerobicTE}`);
  if (w.note) bits.push(`note: ${String(w.note).replace(/\s+/g, " ").slice(0, 180)}`);
  return `- ${bits.join(" · ")}`;
}

function fmtDailyNote(n) {
  const parts = [n.date];
  if (Array.isArray(n.tags) && n.tags.length) parts.push(`tags: ${n.tags.join(", ")}`);
  if (n.readiness && typeof n.readiness === "object") {
    const r = n.readiness;
    const bits = [];
    for (const key of ["sleep", "soreness", "fatigue", "motivation", "stress", "legs"]) {
      if (r[key] != null && r[key] !== "") bits.push(`${key}:${r[key]}`);
    }
    if (bits.length) parts.push(`readiness: ${bits.join(", ")}`);
  }
  if (n.note) parts.push(`note: ${String(n.note).replace(/\s+/g, " ").slice(0, 160)}`);
  return `- ${parts.join(" · ")}`;
}

export function buildWeeklyReportPrompt({ lang, coachConfig, logs, races, dailyNotes, now, range, agentActions = [], memoryFacts = [] }) {
  const completed = logs
    .filter(w => !w.isPlanned && w.date >= range.start && w.date <= range.end)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const plannedThisWeek = logs
    .filter(w => w.isPlanned && w.date >= range.start && w.date <= range.end)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const plannedNextWeek = logs
    .filter(w => w.isPlanned && w.date >= range.nextStart && w.date <= range.nextEnd)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const notes = dailyNotes
    .filter(n => n.date >= range.start && n.date <= range.end)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const targetRaces = races
    .filter(r => r.isTarget && r.date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .slice(0, 5);
  const totalKm = completed.reduce((sum, w) => sum + (Number(w.distance) || 0), 0);
  const totalAscent = completed.reduce((sum, w) => sum + (Number(w.ascent) || 0), 0);
  const totalSec = completed.reduce((sum, w) => sum + (Number(w.duration) || 0), 0);
  const languageName = lang === "zh" ? "简体中文" : "English";

  const system =
    `You are an expert endurance running coach for trail running and hybrid fitness. ` +
    `Write a detailed weekly training report in ${languageName}. Be professional, concrete, and opinionated. ` +
    `Do not write a short push notification. This is a full report page. ` +
    `This report is not a chat reply: do not stop midway to ask the runner questions. ` +
    `If information is missing, state assumptions and mark what to confirm, then still provide a provisional recommendation.`;

  const profileBlock = buildDataBlock({ logs, races, now, lang: "en", dailyNotes, agentActions, memoryFacts });
  const user =
    `Report range: ${range.start} to ${range.end}. Next plan range: ${range.nextStart} to ${range.nextEnd}.\n\n` +
    `[Runner profile and longer context]\n${profileBlock}\n\n` +
    `[Coach preference]\n${JSON.stringify(coachConfig || {})}\n\n` +
    `[This week completed workouts]\n${completed.length ? completed.map(fmtWorkout).join("\n") : "none"}\n\n` +
    `[This week planned workouts]\n${plannedThisWeek.length ? plannedThisWeek.map(fmtWorkout).join("\n") : "none"}\n\n` +
    `[Next week existing plans]\n${plannedNextWeek.length ? plannedNextWeek.map(fmtWorkout).join("\n") : "none"}\n\n` +
    `[Daily readiness / notes]\n${notes.length ? notes.map(fmtDailyNote).join("\n") : "none"}\n\n` +
    `[Target races]\n${targetRaces.length ? targetRaces.map(r => `- ${r.date} · ${r.name || r.category || "race"} · ${r.category || ""} · ${r.priority || ""}`).join("\n") : "none"}\n\n` +
    `[Weekly totals]\n- workouts: ${completed.length}\n- distance: ${totalKm.toFixed(1)} km\n- ascent: ${Math.round(totalAscent)} m\n- duration: ${formatDuration(totalSec)}\n\n` +
    `[Output requirements]\n` +
    `1. Use clear section headings. Long output is OK; do not compress important points.\n` +
    `2. First give an executive summary: what went well, what is risky, what needs to change.\n` +
    `3. Then review EACH completed workout one by one. For every workout, mention date/type/key metrics, what the session likely achieved, whether intensity was appropriate, and one concrete lesson.\n` +
    `4. Compare completed work against planned work when possible. Point out missed or under-completed key sessions.\n` +
    `5. Interpret fatigue/readiness/RPE/HR in context. Avoid generic motivational text.\n` +
    `6. Give a detailed next 7-day training plan for ${range.nextStart} to ${range.nextEnd}. Include exact dates, workout type, distance/ascent/duration where applicable, intensity target, and purpose. Include rest days explicitly when needed.\n` +
    `7. If a plan should replace existing next-week plans, say why.\n` +
    `8. Do not ask open-ended questions in the middle of the report. Put any missing-context items under a short "待确认 / To confirm" section near the end.\n` +
    `9. End with a short checklist of what the runner should watch next week.\n` +
    `10. Use Markdown headings/lists/tables where helpful, and do not mention tokens, APIs, wallet, database, prompt, or internal implementation.`;

  return { system, user };
}
