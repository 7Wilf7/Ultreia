// AI Coach prompt assembly helpers — extracted from AICoachTab so they can
// be called from the lifted sendChat/importToCalendar in AppShell. None of
// these touch React; they're pure data → string transforms.

import { SPARTAN_SUBTYPES, RUN_GROUP_TYPES, DAILY_TAGS } from "../constants";
import { formatDuration, formatPlanDuration, formatPaceFromSec, formatSpeedKmh, formatSwimPace } from "./format";
import { formatWorkoutNoteForDisplay } from "./importReviewNotes";
import { computeTrainingLoad, formatTrainingLoadLine } from "./trainingLoad";
import { evaluatePlanOutcome } from "./planMatch";
import { getAgentActionQualitySignal } from "./agentActions";

const DAY_MS = 24 * 60 * 60 * 1000;
const COACH_META_RE = /<!--\s*ultreia-meta:(.*?)\s*-->/s;
let preciseTokenCounterPromise = null;

function estimateTextTokensFallback(text) {
  const cjk = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  const asciiLike = text.replace(/[\u3400-\u9fff\uf900-\ufaff]/g, "");
  return Math.max(0, Math.ceil(cjk + asciiLike.length / 4));
}

export function parseCoachMessageMeta(content = "") {
  const raw = String(content || "");
  const match = raw.match(COACH_META_RE);
  if (!match) return { text: raw, meta: null };
  try {
    return { text: raw.replace(COACH_META_RE, "").trim(), meta: JSON.parse(match[1]) };
  } catch {
    return { text: raw.replace(COACH_META_RE, "").trim(), meta: null };
  }
}

export function messageContentForCoach(content = "") {
  return parseCoachMessageMeta(content).text;
}

export function appendCoachMessageMeta(content, meta) {
  if (!meta) return content;
  try {
    return `${String(content || "").trim()}\n\n<!-- ultreia-meta:${JSON.stringify(meta)} -->`;
  } catch {
    return content;
  }
}

export function normalizeTokenUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  const input = Number(usage.input_tokens ?? usage.prompt_tokens ?? usage.inputTokens ?? usage.promptTokens ?? 0);
  const output = Number(usage.output_tokens ?? usage.completion_tokens ?? usage.outputTokens ?? usage.completionTokens ?? 0);
  const deepseekCacheHit = Number(usage.prompt_cache_hit_tokens ?? 0);
  const deepseekCacheMiss = Number(usage.prompt_cache_miss_tokens ?? 0);
  const anthropicCacheRead = Number(usage.cache_read_input_tokens ?? 0);
  const anthropicCacheWrite = Number(usage.cache_creation_input_tokens ?? 0);
  const inputCacheHit = Number.isFinite(deepseekCacheHit) && deepseekCacheHit > 0 ? deepseekCacheHit
    : Number.isFinite(anthropicCacheRead) ? anthropicCacheRead
    : 0;
  const inputCacheMiss = Number.isFinite(deepseekCacheMiss) ? deepseekCacheMiss : 0;
  const inputCacheWrite = Number.isFinite(anthropicCacheWrite) ? anthropicCacheWrite : 0;
  const hasDeepseekBreakdown = Number.isFinite(deepseekCacheHit) && deepseekCacheHit > 0
    || Number.isFinite(deepseekCacheMiss) && deepseekCacheMiss > 0;
  const totalInput = hasDeepseekBreakdown
    ? Math.max(input, inputCacheHit + inputCacheMiss)
    : input + inputCacheHit + inputCacheWrite;
  const total = Number(usage.total_tokens ?? usage.totalTokens ?? totalInput + output);
  if (![input, output, total].every(Number.isFinite)) return null;
  if (input <= 0 && output <= 0 && total <= 0) return null;
  return {
    inputTokens: Math.max(0, Math.round(input)),
    outputTokens: Math.max(0, Math.round(output)),
    totalTokens: Math.max(0, Math.round(total || totalInput + output)),
    inputCacheHitTokens: Math.max(0, Math.round(inputCacheHit)),
    inputCacheMissTokens: Math.max(0, Math.round(inputCacheMiss)),
    inputCacheWriteTokens: Math.max(0, Math.round(inputCacheWrite)),
  };
}

export function estimateTextTokens(value = "") {
  const text = String(value || "");
  if (!text) return 0;
  return estimateTextTokensFallback(text);
}

export function loadPreciseTextTokenCounter() {
  if (!preciseTokenCounterPromise) {
    preciseTokenCounterPromise = Promise.all([
      import("js-tiktoken/lite"),
      import("js-tiktoken/ranks/o200k_base"),
    ]).then(([{ Tiktoken }, rankModule]) => {
      const encoder = new Tiktoken(rankModule.default);
      return (value = "") => {
        const text = String(value || "");
        if (!text) return 0;
        try {
          return encoder.encode(text).length;
        } catch {
          return estimateTextTokensFallback(text);
        }
      };
    }).catch((err) => {
      preciseTokenCounterPromise = null;
      throw err;
    });
  }
  return preciseTokenCounterPromise;
}

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
    trainingLoad: "[Training Load — smoothed session-RPE ACWR; acute=7d EWMA, chronic=4w EWMA, sweet spot 0.8–1.3, >1.5 = spike/injury risk]",
    readiness: "[Morning Readiness — runner self-rated, 1=poor 2=ok 3=good]",
    recent: "[Recent Activities (last 10) — RPE=1–10 effort; note=runner's comment; weather=at training time]",
    dayNotes: "[Day Notes — recovery/context flags]",
    adherence: "[Plan Adherence — last 14d, planned vs done/partial/missed]",
    upcoming: "[Planned Sessions — today/future only; planned means scheduled, NOT completed; forecast attached when within 7d]",
    memoryFacts: "[Memory Facts — reviewed durable facts; active facts only; archived facts excluded]",
    agentActions: "[Recent Agent Actions — coach proposals and runner decisions; use as feedback, do not repeat rejected patterns blindly]",
    focus: "[Coaching Focus This Message — conditions that fired right now; weight these in your reply]",
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
    trainingLoad: "[训练负荷 —— 平滑 sRPE ACWR；急性=7天 EWMA，慢性=4周 EWMA，安全区 0.8–1.3，>1.5 为骤增/伤病风险]",
    readiness: "[晨间状态 —— 跑者自评，1=差 2=一般 3=好]",
    recent: "[近期活动（最近 10 条）—— RPE=1–10 自觉用力；note=跑者备注；weather=训练当时天气]",
    dayNotes: "[当日标记 —— 恢复/状态标记]",
    adherence: "[计划依从 —— 近 14 天，计划 vs 完成/部分完成/漏掉]",
    upcoming: "[计划训练 —— 仅今天/未来；planned 表示已安排，不代表已完成；7 天内附当天预报]",
    memoryFacts: "[记忆事实 —— 已审核的长期事实；仅当前事实；已归档事实不进入]",
    agentActions: "[近期教练建议 —— 已整理的日历 / 记忆建议与跑者决策；作为反馈参考，不要机械重复被跳过的方向]",
    focus: "[本次教练重点 —— 当前触发的条件，回复时重点权衡这些]",
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

// Plan adherence — reconcile PAST planned sessions (last 14 days) against what
// was actually completed. Durable: reads structured plan rows + their status,
// NOT the conversation, so it survives a chat clear. Each plan is matched to the
// SAME-TYPE completed workouts on its date and the planned target compared to
// what was done (see evaluatePlanOutcome). A plan counts as:
//   • done     — marked done, OR a same-type session met ≥80% of the target
//   • partial  — a same-type session happened but fell short of the target
//   • missed   — past, no same-type completed workout that day
// Returns null when the runner doesn't plan (nothing to reconcile).
function buildPlanAdherence(logs, now) {
  const startToday = new Date(now); startToday.setHours(0, 0, 0, 0);
  const todayMs = startToday.getTime();
  const planned = logs
    .filter(l => l.isPlanned && l.date)
    .filter(l => {
      const ms = new Date(`${l.date}T00:00:00`).getTime();
      return ms < todayMs && ms >= todayMs - 14 * DAY_MS;
    })
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  if (!planned.length) return null;

  let done = 0, partial = 0, missed = 0;
  const lines = planned.map(p => {
    const dayLogs = logs.filter(l => l.date === p.date);
    const { outcome } = evaluatePlanOutcome(p, dayLogs, { isPast: true });
    if (outcome === "done") done++;
    else if (outcome === "partial") partial++;
    else missed++;
    const metric = p.distance > 0 ? ` ${p.distance}km`
      : p.ascent > 0 ? ` +${p.ascent}m`
      : p.duration > 0 ? ` ${formatPlanDuration(p.duration)}`
      : "";
    const desc = `${p.type}${p.subTypes?.length ? "(" + p.subTypes.join(",") + ")" : ""}${metric}`;
    return `${p.date} planned ${desc} → ${outcome}`;
  });
  const denom = done + partial + missed;
  const extras = [partial ? `${partial} partial` : ""].filter(Boolean).join(", ");
  const ratio = `completed ${done}/${denom}${extras ? ` (+${extras})` : ""}`;
  return { body: `${ratio}\n${lines.join("\n")}`, missed };
}

// Recent morning readiness check-ins (last ~6 days), oldest→newest. "" when none.
function buildReadinessBlock(dailyNotes, now) {
  if (!Array.isArray(dailyNotes) || !dailyNotes.length) return "";
  const todayMs = now.getTime();
  const lvl = (v) => (v == null ? null : v === 1 ? "poor" : v === 2 ? "ok" : "good");
  return dailyNotes
    .filter(n => n && n.readiness && n.date)
    .filter(n => {
      const ms = new Date(`${n.date}T00:00:00`).getTime();
      return ms >= todayMs - 6 * DAY_MS && ms <= todayMs + 12 * 60 * 60 * 1000;
    })
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
    .map(n => {
      const r = n.readiness;
      const parts = [];
      if (lvl(r.sleep)) parts.push(`sleep ${lvl(r.sleep)}`);
      if (lvl(r.legs)) parts.push(`legs ${lvl(r.legs)}`);
      if (lvl(r.energy)) parts.push(`energy ${lvl(r.energy)}`);
      return parts.length ? `${n.date}: ${parts.join(", ")}` : null;
    })
    .filter(Boolean)
    .join("\n");
}

// Nearest FUTURE target race (for periodization phase). null if none upcoming.
function nearestTargetRace(races, now) {
  const startToday = new Date(now); startToday.setHours(0, 0, 0, 0);
  const future = (races || [])
    .filter(r => r.isTarget && r.date)
    .map(r => ({ r, ms: new Date(`${r.date}T00:00:00`).getTime() }))
    .filter(x => Number.isFinite(x.ms) && x.ms >= startToday.getTime())
    .sort((a, b) => a.ms - b.ms);
  return future[0] || null;
}

// "[Coaching Focus]" — the conditional-directive layer. Base coaching
// instructions stay fixed; THIS appends only the guidance whose trigger fired
// this message (periodization phase, heat prep, load spike, missed sessions),
// so the coach weights what's actually relevant right now. "" when nothing fires.
function buildFocusDirectives({ races, now, load, raceDayWeather, missedCount }) {
  const lines = [];
  const near = nearestTargetRace(races, now);
  let weeksToRace = null;
  if (near) {
    weeksToRace = Math.max(0, Math.ceil((near.ms - now.getTime()) / (7 * DAY_MS)));
    let phase, intent;
    if (weeksToRace >= 9) { phase = "Base"; intent = "build aerobic volume, mostly easy"; }
    else if (weeksToRace >= 5) { phase = "Build"; intent = "add race-specific quality, volume near peak"; }
    else if (weeksToRace >= 3) { phase = "Peak"; intent = "volume should plateau then begin easing"; }
    else if (weeksToRace >= 1) { phase = "Taper"; intent = "cut volume ~40–60%, keep a little intensity, protect freshness"; }
    else { phase = "Race week"; intent = "rest and sharpen, dial in pacing and logistics"; }
    lines.push(`Periodization: ${weeksToRace} week(s) to ${near.r.name || "target race"} — ${phase} phase. ${intent}.`);
  }
  if (near && weeksToRace != null && weeksToRace <= 8 && raceDayWeather) {
    const hot = (Number.isFinite(raceDayWeather.apparentAvgC) && raceDayWeather.apparentAvgC >= 28)
      || (Number.isFinite(raceDayWeather.tempMaxC) && raceDayWeather.tempMaxC >= 30);
    const rh = Number.isFinite(raceDayWeather.humidity)
      ? (raceDayWeather.humidity > 1 ? raceDayWeather.humidity : raceDayWeather.humidity * 100) : 0;
    if (hot || rh >= 70) {
      lines.push("Race-day looks hot/humid — work in heat-acclimation guidance over the next couple of weeks (gradual heat exposure, hydration + electrolytes, realistic pace adjustment for the heat).");
    }
  }
  if (load && (load.ramp === "high" || load.ramp === "danger")) {
    lines.push(`Smoothed training load is ramping ${load.ramp === "danger" ? "sharply" : "fast"} (EWMA ACWR ${load.acwr}). Call out the spike and prefer holding or easing volume over piling more on.`);
  }
  if (missedCount > 0) {
    lines.push(`The runner missed ${missedCount} planned session(s) in the last 2 weeks — ask what happened (fatigue, time, a niggle) before prescribing more; don't just re-stack the plan.`);
  }
  return lines.join("\n");
}

function formatAgentActionLine(action) {
  if (!action?.type || !action?.status) return "";
  const created = String(action.createdAt || action.updatedAt || "").slice(0, 10) || "unknown date";
  const type = String(action.type).replace(/_/g, " ");
  const status = String(action.status).replace(/_/g, " ");
  const parts = [`${created} ${type}`, `status=${status}`];
  const quality = getAgentActionQualitySignal(action);
  if (quality?.label) parts.push(`quality_signal=${quality.label}`);
  if (Number.isFinite(Number(quality?.score))) parts.push(`quality_score=${Number(quality.score)}`);
  if (quality?.coachHint) parts.push(`coach_hint=${quality.coachHint}`);
  const plans = Array.isArray(action.payload?.plans) ? action.payload.plans : [];
  if (plans.length) {
    const dates = [...new Set(plans.map(p => p?.date).filter(Boolean))].slice(0, 5);
    parts.push(`dates=${dates.join(",") || "unknown"}`);
    parts.push(`items=${plans.length}`);
  }
  if (action.result && typeof action.result === "object") {
    const count = action.result.createdWorkoutCount;
    if (Number.isFinite(count)) parts.push(`created=${count}`);
    if (Array.isArray(action.result.plannedRestDates) && action.result.plannedRestDates.length) {
      parts.push(`rest=${action.result.plannedRestDates.slice(0, 5).join(",")}`);
    }
    if (Number.isFinite(Number(action.result.savedFactCount)) && Number(action.result.savedFactCount) > 0) {
      parts.push(`saved_facts=${Number(action.result.savedFactCount)}`);
    } else if (Array.isArray(action.result.savedLanguages) && action.result.savedLanguages.length) {
      parts.push(`saved_memory=${action.result.savedLanguages.join("+")}`);
    }
  }
  if (action.error) parts.push(`error=${String(action.error).replace(/\s+/g, " ").slice(0, 120)}`);
  return `- ${parts.join(" · ")}`;
}

export function buildAgentActionsBlock(agentActions = [], limit = 6) {
  if (!Array.isArray(agentActions) || !agentActions.length) return "";
  return agentActions
    .filter(a => a?.type && a?.status)
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))
    .slice(0, limit)
    .map(formatAgentActionLine)
    .filter(Boolean)
    .join("\n");
}

function formatMemoryFactLine(fact, lang = "en") {
  if (!fact || fact.status !== "active") return "";
  const content = lang === "zh"
    ? (fact.contentZh || fact.contentEn || "")
    : (fact.contentEn || fact.contentZh || "");
  const text = String(content || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const category = String(fact.category || "other").replace(/_/g, " ");
  return `- ${category}: ${text}`;
}

export function buildMemoryFactsBlock(memoryFacts = [], lang = "en", limit = 12) {
  if (!Array.isArray(memoryFacts) || !memoryFacts.length) return "";
  return memoryFacts
    .filter(f => f?.status === "active")
    .sort((a, b) => String(b.updatedAt || b.acceptedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.acceptedAt || a.createdAt || "")))
    .slice(0, limit)
    .map(f => formatMemoryFactLine(f, lang))
    .filter(Boolean)
    .join("\n");
}

// Dynamic data block injected into the system prompt. Only the section titles
// are localized; values (dates, race names, numbers) stay verbatim across
// languages so the model receives consistent data.
// `currentWeather` is the realtime snapshot (or null when unavailable).
// `forecastByDate` is a Map<YYYY-MM-DD, dailyForecast> covering the next 7
// days; used to attach daily weather to planned sessions in that window.
export function buildDataBlock({ logs, races, now, lang = "en", currentWeather = null, forecastByDate = null, planForecastByLocation = null, dailyNotes = [], raceDayWeather = null, agentActions = [], memoryFacts = [] }) {
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
    const displayNote = formatWorkoutNoteForDisplay(l.note, lang);
    return `${l.date} ${l.type}${l.subTypes.length ? "(" + l.subTypes.join(",") + ")" : ""} ${l.distance > 0 ? l.distance + "km" : ""} ${formatDuration(l.duration)}${l.pace ? " " + formatPaceFromSec(l.pace) + "/km" : ""}${speed}${swim}${l.hr ? " HR" + l.hr : ""}${l.maxHR ? "/" + l.maxHR : ""}${l.ascent ? " +" + l.ascent + "m" : ""}${l.cadence ? " cad" + l.cadence : ""}${l.rpe ? " RPE" + l.rpe : ""}${formatHrZones(l.hrZoneSeconds)}${formatWeatherInline(l.weather)}${displayNote ? ` note: ${displayNote.replace(/\s+/g, " ").trim()}` : ""}`;
  }).join("\n");
  // Day-level recovery/context flags from the Calendar, last 21 days plus the
  // upcoming plan window. Retired legacy tags are ignored so old rows do not
  // leak into the coach prompt after the UI stops showing them.
  const dayNotesBlock = (() => {
    if (!Array.isArray(dailyNotes) || !dailyNotes.length) return "";
    const todayMs = now.getTime();
    const pastWindowMs = 21 * 24 * 60 * 60 * 1000;
    const futureWindowMs = 21 * 24 * 60 * 60 * 1000;
    return dailyNotes
      .filter(n => n && n.date && Array.isArray(n.tags) && n.tags.some(tg => DAILY_TAGS.includes(tg)))
      .filter(n => {
        const ms = new Date(`${n.date}T00:00:00`).getTime();
        return ms >= todayMs - pastWindowMs && ms <= todayMs + futureWindowMs;
      })
      .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
      .map(n => {
        const tagStr = n.tags
          .filter(tg => DAILY_TAGS.includes(tg))
          .map(tg => String(tg).replace(/_/g, " "))
          .join(", ");
        return tagStr ? `${n.date}: ${tagStr}` : "";
      })
      .filter(Boolean)
      .join("\n");
  })();

  const targetRaces = races.filter(r => r.isTarget)
    .map(r => formatTargetRace(r, lang)).join("\n") || D.none;
  const historyRaces = selectHistoryForPrompt(races.filter(r => !r.isTarget))
    .map(formatHistoryRace).join("\n") || D.none;

  // Upcoming planned sessions — next ~21 days, INDEPENDENT of weather (so the
  // coach can analyze a plan's feasibility even with weather off / out of the
  // 7-day forecast horizon). Forecast is attached only when available for that
  // date (≤7d out). Decoupling this from forecastByDate fixed the old bug where
  // the whole plan block vanished whenever weather was unavailable.
  const startToday = new Date(now); startToday.setHours(0, 0, 0, 0);
  const todayMs = startToday.getTime();
  const twentyOneDaysMs = 21 * DAY_MS;
  const upcomingPlans = logs.filter(l => l.isPlanned && l.date)
    .filter(l => {
      const planMs = new Date(`${l.date}T00:00:00`).getTime();
      return planMs >= todayMs && planMs <= todayMs + twentyOneDaysMs;
    })
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
    .map(l => {
      const isTodayPlan = l.date === formatLocalDateTime(now).slice(0, 10);
      const tod = l.startedAt ? new Date(l.startedAt).getHours() < 12 ? "AM" : "PM" : "";
      const planLocation = l.planDetail?.location && Number.isFinite(Number(l.planDetail.location.lat)) && Number.isFinite(Number(l.planDetail.location.lng))
        ? {
          id: String(l.planDetail.location.id || `${Number(l.planDetail.location.lat).toFixed(4)},${Number(l.planDetail.location.lng).toFixed(4)}`),
          name: String(l.planDetail.location.name || "").trim(),
          lat: Number(l.planDetail.location.lat),
          lng: Number(l.planDetail.location.lng),
        }
        : null;
      const status = isTodayPlan
        ? (tod === "PM" && now.getHours() < 18
          ? "scheduled later today, NOT completed yet"
          : "scheduled today, NOT completed unless a completed workout also appears in Recent Activities")
        : "future planned, NOT completed";
      const planParts = [`plan_id=${l.id} ${l.date}${tod ? ` ${tod}` : ""} ${l.type}${l.subTypes.length ? "(" + l.subTypes.join(",") + ")" : ""}`, `[${status}]`];
      if (l.distance > 0) planParts.push(`${l.distance}km`);
      if (l.ascent > 0) planParts.push(`+${l.ascent}m`);
      if (l.planDetail?.speed > 0) planParts.push(`${l.planDetail.speed}km/h`);
      if (l.planDetail?.keySession === true) planParts.push("key_session=true");
      const partDur = l.planDetail?.subTypeDurations;
      if (partDur && typeof partDur === "object") {
        const segs = Object.entries(partDur).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${v}min`);
        if (segs.length) planParts.push(segs.join("/"));
      } else if (l.duration > 0) {
        planParts.push(formatPlanDuration(l.duration));
      }
      if (planLocation) {
        planParts.push(`location: ${planLocation.name || "saved place"} (${planLocation.lat.toFixed(4)},${planLocation.lng.toFixed(4)})`);
      }
      const planLocationKey = planLocation ? `${l.date}|${planLocation.id}` : "";
      const planSpecificForecast = planLocationKey && planForecastByLocation ? planForecastByLocation.get(planLocationKey) : null;
      const fcStr = planSpecificForecast
        ? formatDailyForecast(planSpecificForecast)
        : (!planLocation && forecastByDate ? formatDailyForecast(forecastByDate.get(l.date)) : "");
      if (fcStr) planParts.push(`forecast${planSpecificForecast ? "@location" : ""}: ${fcStr}`);
      return planParts.join(" ");
    })
    .join("\n");

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
  const load = computeTrainingLoad(logs, now);
  const loadLine = formatTrainingLoadLine(load);
  if (loadLine) sections.push(`${D.trainingLoad}\n${loadLine}`);
  const readinessBlock = buildReadinessBlock(dailyNotes, now);
  if (readinessBlock) sections.push(`${D.readiness}\n${readinessBlock}`);
  sections.push(`${D.recent}\n${recentLogs}`);
  if (dayNotesBlock) sections.push(`${D.dayNotes}\n${dayNotesBlock}`);
  const adherence = buildPlanAdherence(logs, now);
  if (adherence) sections.push(`${D.adherence}\n${adherence.body}`);
  if (upcomingPlans) sections.push(`${D.upcoming}\n${upcomingPlans}`);
  const memoryFactsBlock = buildMemoryFactsBlock(memoryFacts, lang);
  if (memoryFactsBlock) sections.push(`${D.memoryFacts}\n${memoryFactsBlock}`);
  const agentActionsBlock = buildAgentActionsBlock(agentActions);
  if (agentActionsBlock) sections.push(`${D.agentActions}\n${agentActionsBlock}`);
  // Conditional directive layer goes LAST so it's the most salient thing the
  // coach reads before replying.
  const focus = buildFocusDirectives({ races, now, load, raceDayWeather, missedCount: adherence?.missed || 0 });
  if (focus) sections.push(`${D.focus}\n${focus}`);
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
      "【你的资料】姓名 / 训练经验 / 伤病史",
      "【教练设置】你选择的风格 / 输出长度 / 干预程度",
      "【长期记忆】教练长期记住的关于你的要点",
      "",
      "—— 以下是每次发消息实时带上的你的数据（仅列结构，不展示具体内容）——",
      "【当前时间】",
      "【当前天气 + 未来 7 天预报】",
      "【目标赛事 + 最近一场的比赛日天气】",
      "【比赛历史】（按类别精选）",
      "【最近 8 周周训练量】",
      "【训练负荷】平滑 sRPE ACWR（7天 EWMA / 4周 EWMA）+ 骤增风险",
      "【晨间状态】最近几天的自评",
      "【最近 10 条训练】含 RPE / 备注 / 当时天气",
      "【最近当日标记】计划休息 / 按摩 / 拉伸 / 生病",
      "【计划依从】近 14 天计划 vs 完成 / 部分完成 / 漏掉",
      "【未来约 21 天计划训练】（含当天预报，若有）",
      "【记忆事实】已审核的长期事实卡片（已归档不进入）",
      "【近期教练建议】日历 / 记忆建议、你的确认 / 跳过 / 失败反馈",
      "【本次教练重点】按当前情况触发的周期 / 热适应 / 负荷 / 漏练提醒",
    ].join("\n");
  }
  return [
    "[Coach instructions] — this product's core prompt (proprietary, hidden in preview)",
    "",
    "[Your Profile] name / training experience / injuries",
    "[Coach Settings] your chosen style / output length / intervention level",
    "[Long-term Memory] durable facts the coach remembers about you",
    "",
    "— Below: your data, attached live on every message (structure only, values hidden) —",
    "[Current Date]",
    "[Current Weather + 7-day forecast]",
    "[Target Races + next race's race-day weather]",
    "[Race History] (curated per category)",
    "[Weekly Trend — last 8 weeks]",
    "[Training Load — smoothed sRPE ACWR spike risk]",
    "[Morning Readiness — recent self-ratings]",
    "[Recent Activities (last 10)] with RPE / notes / weather",
    "[Recent Day Notes] recovery / sick / mobility",
    "[Plan Adherence — last 14d planned vs done/partial/missed]",
    "[Planned Sessions — today/future only; planned means scheduled, not completed]",
    "[Memory Facts] reviewed durable fact cards (archived excluded)",
    "[Recent Agent Actions] proposals + accepted/rejected/failed outcomes",
    "[Coaching Focus — periodization / heat / load / missed-session cues that fired]",
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
    if (Array.isArray(parsed?.items)) return parsed.items;
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
