// AI Coach prompt assembly helpers — extracted from AICoachTab so they can
// be called from the lifted sendChat/importToCalendar in AppShell. None of
// these touch React; they're pure data → string transforms.

import { SPARTAN_SUBTYPES, RUN_GROUP_TYPES } from "../constants";
import { formatDuration, formatPaceFromSec, formatSpeedKmh, formatSwimPace } from "./format";

// Locale-aware headers for the dynamic data block (current date / target races /
// race history / recent activities). Numbers + race names stay as-is — only the
// section titles + the priority label change. The "en" version is canonical
// (LLM-facing); "zh" is for the in-app preview only.
export const DATA_LABELS = {
  en: {
    currentDate: "[Current Date]",
    currentWeather: "[Current Weather]",
    weeklyForecast: "[7-Day Forecast]",
    raceWeather: "[Next Race Weather — forecast=real ≤2wk; typical=climate normal]",
    targets: "[Target Races]",
    history: "[Race History — recent + PR per type]",
    weeklyTrend: "[Weekly Load — last 8 wks: run distance + ascent + count; watch week-over-week spikes]",
    recent: "[Recent Activities (last 10) — RPE=1–10 effort; note=runner's comment; weather=at training time]",
    dayNotes: "[Day Notes — recovery/context flags]",
    upcoming: "[Upcoming Planned Sessions — next 7 days + forecast]",
    none: "None",
    priorityTag: (p) => `[Priority ${p}]`,
  },
  zh: {
    currentDate: "[当前时间]",
    currentWeather: "[当前天气]",
    weeklyForecast: "[未来 7 天预报]",
    raceWeather: "[下一场比赛日天气 —— forecast=两周内真实预报；typical=多年气候常态]",
    targets: "[目标比赛]",
    history: "[比赛历史 —— 每类最近一场 + PR]",
    weeklyTrend: "[周训练量 —— 最近 8 周：跑步距离 + 爬升 + 次数；关注周环比突增]",
    recent: "[近期活动（最近 10 条）—— RPE=1–10 自觉用力；note=跑者备注；weather=训练当时天气]",
    dayNotes: "[当日标记 —— 恢复/状态标记]",
    upcoming: "[未来计划训练 —— 接下来 7 天 + 预报]",
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
  let out = parts.length ? ` weather: ${parts.join(", ")}` : "";
  // Long-session weather series — how conditions evolved across the activity
  // (e.g. a 10h ultra that started at 15°C and hit 32°C by midday). Only the
  // start is on the line above; this appends the trajectory for the coach.
  if (Array.isArray(w.series) && w.series.length > 1) {
    const pts = w.series.map(p => {
      const a = Number.isFinite(p.apparentC) ? p.apparentC : p.tempC;
      return `+${p.atHours}h ${Math.round(p.tempC)}°C(feels ${Math.round(a)})`;
    }).join(" / ");
    out += ` [during: ${pts}]`;
  }
  return out;
}

// Time-in-HR-zone (FIT imports only) → compact "Z1-5 40/30/15/10/5%" so the
// coach can judge whether an "easy" run was actually easy. Empty when absent.
function formatHrZones(z) {
  if (!Array.isArray(z) || z.length < 5) return "";
  const total = z.reduce((a, b) => a + (Number(b) || 0), 0);
  if (total <= 0) return "";
  const pct = z.map((s) => Math.round((Number(s) || 0) / total * 100));
  return ` HRzones Z1-5 ${pct.join("/")}%`;
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

// Pick a tight subset of history races for the prompt: per category, the MOST
// RECENT race (current form) + the PR / best race (peak ability). Keeps the
// prompt focused — two anchor points per event type instead of a long list.
// "Best" per category:
//   • 10K / HM / Marathon / Hyrox / Other / Uncategorized → fastest finish time
//   • Trail   → highest ITRA score, else longest distance
//   • Spartan → toughest tier (Sprint < Super < Beast < Ultra)
export function selectHistoryForPrompt(historyRaces) {
  const groups = {};
  for (const r of historyRaces) {
    const cat = r.category || "Uncategorized";
    (groups[cat] = groups[cat] || []).push(r);
  }
  const picked = new Set();
  for (const [cat, group] of Object.entries(groups)) {
    // Most recent by date.
    const latest = [...group].sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0];
    if (latest) picked.add(latest.id);
    // PR / best for the category.
    let best;
    if (cat === "Trail") {
      best = [...group].filter(r => r.itraScore > 0).sort((a, b) => b.itraScore - a.itraScore)[0]
          || [...group].filter(r => r.distance > 0).sort((a, b) => b.distance - a.distance)[0];
    } else if (cat === "Spartan") {
      best = [...group].filter(r => SPARTAN_RANK[r.subtype])
        .sort((a, b) => SPARTAN_RANK[b.subtype] - SPARTAN_RANK[a.subtype])[0];
    } else {
      best = [...group].filter(r => r.resultSeconds > 0)
        .sort((a, b) => a.resultSeconds - b.resultSeconds)[0];
    }
    if (best) picked.add(best.id);
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
export function buildDataBlock({ logs, races, now, lang = "en", currentWeather = null, forecastByDate = null, dailyNotes = [], raceDayWeather = null }) {
  const D = DATA_LABELS[lang] || DATA_LABELS.en;
  // Strip future-planned entries — the LLM should only see what actually
  // happened. Planned rows would otherwise be misread as "recent activity"
  // (e.g. "your last run was 10km" when the user hasn't run it yet).
  // Each line ends with the weather snapshot when one was captured at
  // training time. Skip the suffix entirely when missing — never write
  // "weather: null", that confuses the LLM more than it helps.
  const recentLogs = logs.filter(l => !l.isPlanned).slice(0, 10).map(l => {
    // Cycling reports speed (km/h), Swimming pace per 100m — pace (min/km) is
    // for runs only, so those two carry their own derived metric instead.
    const speed = (l.type === "Cycling" && l.distance > 0 && l.duration > 0) ? " " + formatSpeedKmh(l.distance, l.duration) + "km/h" : "";
    const swim = (l.type === "Swimming" && l.distance > 0 && l.duration > 0) ? " " + formatSwimPace(l.distance, l.duration) + "/100m" : "";
    return `${l.date} ${l.type}${l.subTypes.length ? "(" + l.subTypes.join(",") + ")" : ""} ${l.distance > 0 ? l.distance + "km" : ""} ${formatDuration(l.duration)}${l.pace ? " " + formatPaceFromSec(l.pace) + "/km" : ""}${speed}${swim}${l.hr ? " HR" + l.hr : ""}${l.maxHR ? "/" + l.maxHR : ""}${l.ascent ? " +" + l.ascent + "m" : ""}${l.cadence ? " cad" + l.cadence : ""}${l.rpe ? " RPE" + l.rpe : ""}${formatHrZones(l.hrZoneSeconds)}${formatWeatherInline(l.weather)}${l.note ? ` note: ${String(l.note).replace(/\s+/g, " ").trim()}` : ""}`;
  }).join("\n");
  // Day-level recovery/context flags (sick / travel / poor sleep / massage /
  // stretching) from the Calendar, last 21 days only, oldest→newest. Tag slugs
  // are de-underscored ("poor_sleep" → "poor sleep") for the LLM. Skipped when
  // the runner hasn't tagged any recent day.
  const dayNotesBlock = (() => {
    if (!Array.isArray(dailyNotes) || !dailyNotes.length) return "";
    const todayMs = now.getTime();
    const windowMs = 21 * 24 * 60 * 60 * 1000;
    return dailyNotes
      .filter(n => n && n.date && Array.isArray(n.tags) && n.tags.length)
      .filter(n => {
        const ms = new Date(`${n.date}T00:00:00`).getTime();
        return ms >= todayMs - windowMs && ms <= todayMs + 12 * 60 * 60 * 1000;
      })
      .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
      .map(n => {
        const tagStr = n.tags.map(tg => String(tg).replace(/_/g, " ")).join(", ");
        // Travel destination → so the coach can suggest local running and
        // factor the trip in (different climate, jet lag, terrain).
        const dest = (n.tags.includes("travel") && n.travelDest) ? ` (travel to ${n.travelDest})` : "";
        return `${n.date}: ${tagStr}${dest}`;
      })
      .join("\n");
  })();

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
  if (raceDayWeather) {
    const kind = raceDayWeather.kind === "forecast" ? "forecast" : "typical";
    const wStr = formatDailyForecast(raceDayWeather);
    if (wStr) {
      const when = raceDayWeather.date ? ` on ${raceDayWeather.date}` : "";
      sections.push(`${D.raceWeather}\n${raceDayWeather.name}${when} (${kind}): ${wStr}`);
    }
  }
  sections.push(`${D.history}\n${historyRaces}`);
  const weeklyTrend = buildWeeklyTrend(logs, now, 8);
  if (weeklyTrend) sections.push(`${D.weeklyTrend}\n${weeklyTrend}`);
  sections.push(`${D.recent}\n${recentLogs}`);
  if (dayNotesBlock) sections.push(`${D.dayNotes}\n${dayNotesBlock}`);
  if (upcomingPlans) sections.push(`${D.upcoming}\n${upcomingPlans}`);
  return sections.join("\n\n");
}

// Redacted, read-only skeleton for the in-app "Preview assembled prompt".
// The real prompt (the proprietary coaching instructions + the user's actual
// data) is NOT exposed — the preview only shows the ARCHITECTURE: which fixed
// instructions exist (hidden) and which categories of the user's data get
// attached on every message (as placeholders, no real values). This protects
// the prompt as product IP while still letting the user understand what's sent.
// `sendChat` still sends the full, unredacted prompt.
export function buildPromptSkeleton(lang = "en") {
  if (lang === "zh") {
    return [
      "【教练指令】—— 本产品的核心提示词（专有，预览中隐藏）",
      "",
      "【你的资料】姓名 / 训练经验 / 伤病史 / 默认位置",
      "【教练设置】你选择的风格 / 输出长度 / 干预程度",
      "【长期记忆】教练长期记住的关于你的要点",
      "",
      "—— 以下是每次发消息实时带上的你的数据（仅列结构，不展示具体内容）——",
      "【当前时间】",
      "【当前天气 + 未来 7 天预报】",
      "【目标赛事 + 最近一场的比赛日天气】",
      "【比赛历史】（按类别精选）",
      "【最近 8 周周训练量】",
      "【最近 10 条训练】含 RPE / 备注 / 当时天气",
      "【最近当日标记】恢复 / 生病 / 出差 / 旅行等",
      "【未来 7 天计划训练 + 当天预报】",
    ].join("\n");
  }
  return [
    "[Coach instructions] — this product's core prompt (proprietary, hidden in preview)",
    "",
    "[Your Profile] name / training experience / injuries / default location",
    "[Coach Settings] your chosen style / output length / intervention level",
    "[Long-term Memory] durable facts the coach remembers about you",
    "",
    "— Below: your data, attached live on every message (structure only, values hidden) —",
    "[Current Date]",
    "[Current Weather + 7-day forecast]",
    "[Target Races + next race's race-day weather]",
    "[Race History] (curated per category)",
    "[Weekly Training Load — last 8 weeks]",
    "[Recent Activities (last 10)] with RPE / notes / weather",
    "[Recent Day Notes] recovery / sick / travel",
    "[Upcoming Planned Sessions — next 7 days + forecast]",
  ].join("\n");
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
