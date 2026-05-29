// AI Coach prompt assembly helpers — extracted from AICoachTab so they can
// be called from the lifted sendChat/importToCalendar in AppShell. None of
// these touch React; they're pure data → string transforms.

import { SPARTAN_SUBTYPES, RUN_GROUP_TYPES } from "../constants";
import { formatDuration, formatPaceFromSec } from "./format";

// Locale-aware headers for the dynamic data block (current date / target races /
// race history / recent activities). Numbers + race names stay as-is — only the
// section titles + the priority label change. The "en" version is canonical
// (LLM-facing); "zh" is for the in-app preview only.
export const DATA_LABELS = {
  en: {
    currentDate: "[Current Date]",
    currentWeather: "[Current Weather]",
    weeklyForecast: "[7-Day Weather Forecast — use this when planning ANY upcoming session]",
    targets: "[Target Races]",
    history: "[Race History]",
    weeklyTrend: "[Weekly Training Load — last 8 weeks of run-group volume (distance + ascent + session count). Watch week-over-week jumps as an injury-risk signal.]",
    recent: "[Recent Activities (last 10) — each line ends with the weather at training time when available]",
    upcoming: "[Upcoming Planned Sessions — next 7 days, with daily forecast]",
    none: "None",
    priorityTag: (p) => `[Priority ${p}]`,
  },
  zh: {
    currentDate: "[当前时间]",
    currentWeather: "[当前天气]",
    weeklyForecast: "[未来 7 天天气预报 —— 排任何未来训练时都参考这里]",
    targets: "[目标比赛]",
    history: "[比赛历史]",
    weeklyTrend: "[周训练量 —— 最近 8 周跑步类训练量（距离 + 爬升 + 次数）。关注周环比突增带来的伤病风险。]",
    recent: "[近期活动（最近 10 条）—— 行尾附该次训练当时的天气（如有）]",
    upcoming: "[未来计划训练 —— 接下来 7 天，附当日天气预报]",
    none: "无",
    priorityTag: (p) => `[${p} 级目标]`,
  },
};

// Render a stored weather snapshot (from workouts.weather) as a compact
// inline suffix for the [Recent Activities] block. Skipped entirely when
// the snapshot is missing — older rows recorded before weather support
// landed shouldn't get a "weather: null" line that confuses the LLM.
function formatWeatherInline(w) {
  if (!w) return "";
  const t = w.tempC ?? w.tempAvgC;
  const apparent = w.apparentC ?? w.apparentAvgC;
  const parts = [];
  if (Number.isFinite(t)) parts.push(`${t}°C`);
  if (Number.isFinite(apparent) && Math.abs(apparent - t) >= 1) {
    parts.push(`feels ${apparent}°C`);
  }
  if (Number.isFinite(w.humidity)) {
    const rh = w.humidity > 1 ? Math.round(w.humidity) : Math.round(w.humidity * 100);
    parts.push(`RH${rh}%`);
  }
  if (w.skycon) parts.push(w.skycon);
  if (Number.isFinite(w.windSpeed) && w.windSpeed >= 1) {
    parts.push(`wind ${w.windSpeed}km/h`);
  }
  if (Number.isFinite(w.aqi) && w.aqi > 0) parts.push(`AQI${w.aqi}`);
  return parts.length ? ` weather: ${parts.join(", ")}` : "";
}

// Realtime — slightly more verbose than the inline form because this is
// the headline "what's it like right now" block.
function formatCurrentWeather(w) {
  if (!w) return "";
  const t = w.tempC;
  const apparent = w.apparentC;
  const parts = [];
  if (Number.isFinite(t)) parts.push(`${t}°C`);
  if (Number.isFinite(apparent) && Math.abs(apparent - t) >= 1) {
    parts.push(`feels ${apparent}°C`);
  }
  if (Number.isFinite(w.humidity)) {
    const rh = w.humidity > 1 ? Math.round(w.humidity) : Math.round(w.humidity * 100);
    parts.push(`humidity ${rh}%`);
  }
  if (w.skycon) parts.push(w.skycon);
  if (Number.isFinite(w.windSpeed)) parts.push(`wind ${w.windSpeed}km/h`);
  if (Number.isFinite(w.aqi)) parts.push(`AQI ${w.aqi}`);
  return parts.join(", ");
}

// Forecast for a future training day.
function formatDailyForecast(f) {
  if (!f) return "";
  const parts = [];
  if (Number.isFinite(f.tempMaxC) && Number.isFinite(f.tempMinC)) {
    parts.push(`${f.tempMinC}–${f.tempMaxC}°C`);
  } else if (Number.isFinite(f.tempAvgC)) {
    parts.push(`avg ${f.tempAvgC}°C`);
  }
  if (Number.isFinite(f.apparentAvgC)) parts.push(`feels ~${f.apparentAvgC}°C`);
  if (Number.isFinite(f.humidity)) {
    const rh = f.humidity > 1 ? Math.round(f.humidity) : Math.round(f.humidity * 100);
    parts.push(`humidity ${rh}%`);
  }
  if (f.skycon) parts.push(f.skycon);
  if (Number.isFinite(f.windSpeed)) parts.push(`wind ${f.windSpeed}km/h`);
  if (Number.isFinite(f.aqi)) parts.push(`AQI ${f.aqi}`);
  return parts.join(", ");
}

// Local time formatter — explicit per-component build, locale-independent.
// `now.toISOString()` returns UTC, which mislabels as GMT+8 in the data
// block; this returns the user's wall-clock time as "YYYY-MM-DD HH:MM".
export function formatLocalDateTime(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Difficulty rank for Spartan subtypes — higher = harder.
const SPARTAN_RANK = SPARTAN_SUBTYPES.reduce((acc, name, i) => {
  acc[name] = i + 1;
  return acc;
}, {});

// Pick a representative subset of history races to send to the coach.
// Per category:
//   • 10K / HM / Marathon / Hyrox / Other / Uncategorized → latest 3 by date
//   • Trail   → latest 3 + longest by distance (if not already in the 3)
//   • Spartan → latest 3 + toughest by subtype rank (if not already in the 3)
// Goal: keep the prompt focused on recent form, while always anchoring trail
// and Spartan signal with the user's peak performance for each.
export function selectHistoryForPrompt(historyRaces) {
  const groups = {};
  for (const r of historyRaces) {
    const cat = r.category || "Uncategorized";
    (groups[cat] = groups[cat] || []).push(r);
  }
  const picked = new Set();
  for (const [cat, group] of Object.entries(groups)) {
    const byDate = [...group].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    byDate.slice(0, 3).forEach(r => picked.add(r.id));
    if (cat === "Trail") {
      const longest = [...group].filter(r => r.distance > 0)
        .sort((a, b) => b.distance - a.distance)[0];
      if (longest) picked.add(longest.id);
    } else if (cat === "Spartan") {
      const toughest = [...group].filter(r => SPARTAN_RANK[r.subtype])
        .sort((a, b) => SPARTAN_RANK[b.subtype] - SPARTAN_RANK[a.subtype])[0];
      if (toughest) picked.add(toughest.id);
    }
  }
  return historyRaces
    .filter(r => picked.has(r.id))
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}

// Format a race finish time as H:MM:SS (h unpadded; m/s padded). Returns ""
// when no time recorded so callers can omit the "→ time" suffix.
export function formatRaceTime(r) {
  if (![r.resultH, r.resultM, r.resultS].some(Boolean)) return "";
  return `${r.resultH || "0"}:${String(r.resultM || "0").padStart(2, "0")}:${String(r.resultS || "0").padStart(2, "0")}`;
}

// Build the category tag for a race entry. Spartan includes its tier
// (Sprint/Super/Beast/Ultra) inline so the LLM doesn't have to guess.
export function categoryTagFor(r, brackets = "[]") {
  if (!r.category) return "";
  const inside = r.category === "Spartan" && r.subtype ? `${r.category} ${r.subtype}` : r.category;
  return `${brackets[0]}${inside}${brackets[1]}`;
}

// Target race line — no more "goal: X" (targets don't capture a finish time).
// Priority is spelled out ("Priority A" / "A 级目标") so the LLM doesn't have
// to infer the meaning of a bare `[A]`. Distance + ascent carry units.
export function formatTargetRace(r, lang) {
  const L_ = DATA_LABELS[lang] || DATA_LABELS.en;
  const priority = r.priority ? L_.priorityTag(r.priority) : "";
  const catTag = categoryTagFor(r, "()");
  const dateStr = r.date ? `on ${r.date}` : "";
  const metrics = [];
  if (r.distance > 0) metrics.push(`${r.distance} km`);
  if (r.ascent && parseInt(r.ascent) > 0) metrics.push(`+${r.ascent} m`);
  const metricStr = metrics.length ? `(${metrics.join(", ")})` : "";
  return [priority, r.name, catTag, dateStr, metricStr].filter(Boolean).join(" ");
}

// History race line — only emit metrics that are meaningful for the category:
//   Trail   → distance + ascent (the defining metrics)
//   Spartan → tier inline with category tag
//   Road / Hyrox / Other → distance is implicit in the category, so just time
// "→ time" appended only when a finish time was recorded.
export function formatHistoryRace(r) {
  const parts = [r.date, r.name, categoryTagFor(r, "[]")].filter(Boolean);
  if (r.category === "Trail") {
    const metrics = [];
    if (r.distance > 0) metrics.push(`${r.distance} km`);
    if (r.ascent && parseInt(r.ascent) > 0) metrics.push(`+${r.ascent} m`);
    if (metrics.length) parts.push(metrics.join(", "));
  }
  let line = parts.join(" ");
  const t = formatRaceTime(r);
  if (t) line += ` → ${t}`;
  if (r.itraScore) line += ` ITRA ${r.itraScore}`;
  return line;
}

// Compact week-range label for the weekly-trend block, e.g. "5/12–18" (same
// month) or "5/30–6/5" (cross-month). Built from LOCAL date components — going
// through toISOString() would shift the day for users east of UTC. `start` is
// the Monday 00:00 of the week; the label spans the 7 days start..start+6.
function weekTrendLabel(start) {
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const sm = start.getMonth() + 1, sd = start.getDate();
  const em = end.getMonth() + 1, ed = end.getDate();
  return sm === em ? `${sm}/${sd}–${ed}` : `${sm}/${sd}–${em}/${ed}`;
}

// Recent weekly training load — the periodization signal the flat last-10 list
// can't convey. For each of the last `weeks` Monday-start weeks (matching the
// week buckets in ChartsTab) we sum run-group distance + ascent and count the
// sessions. Weeks are emitted oldest→newest so the trend reads left-to-right.
// Leading fully-empty weeks are dropped so a runner who only started 3 weeks
// ago doesn't get a wall of "0km" lines. Returns "" when there's no run data
// in the window at all — caller then omits the section entirely.
export function buildWeeklyTrend(logs, now, weeks = 8) {
  const dayOfWeek = (now.getDay() + 6) % 7; // Mon=0 … Sun=6
  const thisWeekStart = new Date(now);
  thisWeekStart.setDate(now.getDate() - dayOfWeek);
  thisWeekStart.setHours(0, 0, 0, 0);

  const rows = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = new Date(thisWeekStart);
    start.setDate(thisWeekStart.getDate() - i * 7);
    const end = new Date(start);
    end.setDate(start.getDate() + 7);
    let dist = 0, ascent = 0, count = 0;
    for (const l of logs) {
      if (l.isPlanned) continue;
      if (!RUN_GROUP_TYPES.includes(l.type)) continue;
      const d = new Date(l.date);
      if (d < start || d >= end) continue;
      dist += l.distance || 0;
      ascent += l.ascent || 0;
      count += 1;
    }
    rows.push({ start, dist, ascent, count });
  }
  while (rows.length && rows[0].count === 0) rows.shift();
  if (!rows.length) return "";

  return rows.map(r => {
    const parts = [`${+r.dist.toFixed(1)}km`];
    if (r.ascent > 0) parts.push(`+${Math.round(r.ascent)}m`);
    parts.push(`${r.count} ${r.count === 1 ? "run" : "runs"}`);
    return `${weekTrendLabel(r.start)}: ${parts.join(", ")}`;
  }).join("\n");
}

// Dynamic data block injected into the system prompt. Only the section titles
// are localized; values (dates, race names, numbers) stay verbatim across
// languages so the model receives consistent data.
// `currentWeather` is the realtime snapshot (or null when unavailable).
// `forecastByDate` is a Map<YYYY-MM-DD, dailyForecast> covering the next 7
// days; used to attach daily weather to planned sessions in that window.
export function buildDataBlock({ logs, races, now, lang = "en", currentWeather = null, forecastByDate = null }) {
  const D = DATA_LABELS[lang] || DATA_LABELS.en;
  // Strip future-planned entries — the LLM should only see what actually
  // happened. Planned rows would otherwise be misread as "recent activity"
  // (e.g. "your last run was 10km" when the user hasn't run it yet).
  // Each line ends with the weather snapshot when one was captured at
  // training time. Skip the suffix entirely when missing — never write
  // "weather: null", that confuses the LLM more than it helps.
  const recentLogs = logs.filter(l => !l.isPlanned).slice(0, 10).map(l =>
    `${l.date} ${l.type}${l.subTypes.length ? "(" + l.subTypes.join(",") + ")" : ""} ${l.distance > 0 ? l.distance + "km" : ""} ${formatDuration(l.duration)}${l.pace ? " " + formatPaceFromSec(l.pace) + "/km" : ""}${l.hr ? " HR" + l.hr : ""}${l.maxHR ? "/" + l.maxHR : ""}${l.ascent ? " +" + l.ascent + "m" : ""}${l.cadence ? " cad" + l.cadence : ""}${l.aerobicTE ? " TE" + l.aerobicTE : ""}${l.gap ? " GAP" + formatPaceFromSec(l.gap) : ""}${formatWeatherInline(l.weather)}`
  ).join("\n");
  const targetRaces = races.filter(r => r.isTarget)
    .map(r => formatTargetRace(r, lang)).join("\n") || D.none;
  const historyRaces = selectHistoryForPrompt(races.filter(r => !r.isTarget))
    .map(formatHistoryRace).join("\n") || D.none;

  // Upcoming planned sessions in the next 7 days, each annotated with the
  // daily forecast for that date. Skipped entirely when no forecast or no
  // planned sessions in range — keeps the prompt clean when neither applies.
  const todayMs = now.getTime();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const upcomingPlans = forecastByDate
    ? logs.filter(l => l.isPlanned && l.date)
        .filter(l => {
          const planMs = new Date(`${l.date}T00:00:00`).getTime();
          return planMs >= todayMs - 12 * 60 * 60 * 1000 && planMs <= todayMs + sevenDaysMs;
        })
        .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
        .map(l => {
          const f = forecastByDate.get(l.date);
          const planParts = [`${l.date} ${l.type}${l.subTypes.length ? "(" + l.subTypes.join(",") + ")" : ""}`];
          if (l.distance > 0) planParts.push(`${l.distance}km`);
          if (l.duration > 0) planParts.push(formatDuration(l.duration));
          const fcStr = formatDailyForecast(f);
          if (fcStr) planParts.push(`forecast: ${fcStr}`);
          return planParts.join(" ");
        })
        .join("\n")
    : "";

  // Full 7-day weather forecast — emitted whenever we have ANY forecast
  // data, regardless of whether the user has planned sessions in those
  // days. The coach reads this when proposing new plans so it can pick
  // the right day for a tempo / long run based on temp / humidity / AQI.
  // Without this block the coach used to only see weather attached to
  // already-planned days, so an unplanned week → blind recommendations.
  let weeklyForecastBlock = "";
  if (forecastByDate && forecastByDate.size > 0) {
    const todayKey = formatLocalDateTime(now).slice(0, 10);
    const sevenDayKeys = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() + i);
      sevenDayKeys.push(formatLocalDateTime(d).slice(0, 10));
    }
    const lines = sevenDayKeys
      .map(k => {
        const f = forecastByDate.get(k);
        if (!f) return null;
        const fcStr = formatDailyForecast(f);
        if (!fcStr) return null;
        const tag = k === todayKey ? " (today)" : "";
        return `${k}${tag}: ${fcStr}`;
      })
      .filter(Boolean);
    if (lines.length) weeklyForecastBlock = lines.join("\n");
  }

  // Build the sections list, skipping any that have no content so we don't
  // leak empty headers ([Current Weather] with no body, etc.) into the prompt.
  const sections = [
    `${D.currentDate} ${formatLocalDateTime(now)} GMT+8`,
  ];
  const cwStr = formatCurrentWeather(currentWeather);
  if (cwStr) sections.push(`${D.currentWeather}\n${cwStr}`);
  if (weeklyForecastBlock) sections.push(`${D.weeklyForecast}\n${weeklyForecastBlock}`);
  sections.push(`${D.targets}\n${targetRaces}`);
  sections.push(`${D.history}\n${historyRaces}`);
  const weeklyTrend = buildWeeklyTrend(logs, now, 8);
  if (weeklyTrend) sections.push(`${D.weeklyTrend}\n${weeklyTrend}`);
  sections.push(`${D.recent}\n${recentLogs}`);
  if (upcomingPlans) sections.push(`${D.upcoming}\n${upcomingPlans}`);
  return sections.join("\n\n");
}

// Tolerant JSON-array extraction from a coach reply. The LLM may wrap its
// output in markdown fences, prefix it with commentary, or even return a
// plain object — we try a few peelings before giving up.
export function parsePlansFromLLM(text) {
  if (!text) return [];
  let cleaned = text.trim();
  // Strip ```json … ``` or ``` … ``` fences if present.
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* fall through */ }
  // Last resort — find the FIRST `[ … ]` substring and try that.
  const m = cleaned.match(/\[[\s\S]*\]/);
  if (m) {
    try {
      const parsed = JSON.parse(m[0]);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* give up */ }
  }
  return [];
}
