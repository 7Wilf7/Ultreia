import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { RACE_CATEGORIES, RUN_GROUP_TYPES, SPARTAN_SUBTYPES } from "../constants";
import { useT, useLanguage } from "../i18n/LanguageContext";
import { workouts as workoutsDb } from "../lib/db";
import { formatDurationShort, formatPlanDuration, formatPaceFromSec, formatSpeedKmh, formatSwimPace } from "../utils/format";
import { s } from "../styles";
import { ModalRoot } from "./ModalRoot";
import { Dropdown } from "./Dropdown";
import { POSTER_FONT_CSS } from "../data/posterFonts";
import { productLogoUrl } from "../assets/logo";
import markDayUrl from "../../resources/poster-mark-day.webp";
import markNightUrl from "../../resources/poster-mark-night.webp";

// url → Promise<dataUrl>, module-scoped so the fetch + base64 encode happens
// once per session even across modal remounts. SVG <image> hrefs MUST be data
// URLs before export: an SVG rasterized through an <img> element cannot fetch
// external resources, so a plain asset URL would silently drop the logo /
// background from the saved PNG. Failed conversions are evicted so a transient
// network error can retry on the next call.
const assetDataUrlCache = new Map();
function fetchAsDataUrl(url) {
  if (!assetDataUrlCache.has(url)) {
    const p = fetch(url)
      .then(res => res.blob())
      .then(blob => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      }))
      .then(dataUrl => {
        if (typeof dataUrl !== "string") throw new Error("asset encode failed");
        return dataUrl;
      });
    p.catch(() => assetDataUrlCache.delete(url));
    assetDataUrlCache.set(url, p);
  }
  return assetDataUrlCache.get(url);
}

// ── Canvas options ──────────────────────────────────────────────────────────
// One poster design, three crop ratios. The composition is anchored to fractions
// of H so it adapts across ratios; type sizes stay roughly constant for legibility.
const RATIOS = {
  portrait: { key: "portrait", w: 1080, h: 1350 },
  square: { key: "square", w: 1080, h: 1080 },
  story: { key: "story", w: 1080, h: 1920 },
};
const RATIO_KEYS = ["portrait", "square", "story"];

// Day / Night finishes. Restraint: paper/ink base + ONE muted moss accent.
// The background is the brand mark — the twin-peak mountain (bold strokes), the
// two dots, and the green tick — redrawn as vector at `markOpacity` so it themes
// per finish (dark mark on the cream day paper, cream mark on the night ground)
// while the green tick stays green.
const THEMES = {
  day: {
    bg: "#f1ede1",
    ink: "#151610",
    sub: "#5f6250",
    hair: "#d2cbb7",
    accent: "#586340",
    markOpacity: 0.18,
    vignetteA: 0.05,
    vignetteB: 0.15,
  },
  night: {
    bg: "#090b08",
    ink: "#f3f0e2",
    sub: "#aaa98c",
    hair: "#303426",
    accent: "#77825b",
    markOpacity: 0.22,
    vignetteA: 0.16,
    vignetteB: 0.52,
  },
};
const THEME_KEYS = ["day", "night"];

const POSTER_MODES = ["single", "week", "month", "year", "all", "pr"];
const RANGE_MODES = new Set(["week", "month", "year"]);
// Single-session metric fields the user can toggle on/off for the poster.
const SINGLE_FIELDS = ["time", "pace", "elev", "hr", "weather"];
const SINGLE_FIELD_LABELS = {
  zh: { time: "时间", pace: "配速", elev: "爬升", hr: "心率", weather: "天气" },
  en: { time: "Time", pace: "Pace", elev: "Elev", hr: "HR", weather: "Weather" },
};
const PR_RANGES = ["all", "this_year", "last_year", "last_12m"];

// Latin condensed grotesque for numbers/labels; handwriting for the signature.
// CJK (e.g. a location string) falls back to the system stack — the embedded
// woff2 is Latin-only on purpose (CJK webfonts are megabytes).
const FF = "TSCond, 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif";
// TSSign = Alex Brush (single 400 weight) — the product's signature mark.
const FF_SIGN = "TSSign, 'Segoe Script', cursive";

const PosterSaver = registerPlugin("PosterSaver");
const isNativeApp = () => Capacitor.isNativePlatform?.() === true;

function fmtNum(n, digits = 0) {
  return Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function resultSeconds(r) {
  const h = parseInt(r?.resultH, 10) || 0;
  const m = parseInt(r?.resultM, 10) || 0;
  const sec = parseInt(r?.resultS, 10) || 0;
  const total = h * 3600 + m * 60 + sec;
  return total > 0 ? total : Infinity;
}

function formatHMS(sec) {
  if (!isFinite(sec)) return "-";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s2 = Math.round(sec % 60);
  return `${String(h).padStart(1, "0")}:${String(m).padStart(2, "0")}:${String(s2).padStart(2, "0")}`;
}

function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function labelDate(d) {
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

function workoutLabel(log) {
  if (!log) return "";
  const typeLabel = log.type || "Workout";
  const dateLabel = log.date || "";
  const dist = Number(log.distance) > 0 ? ` · ${fmtNum(log.distance, 1)} km` : "";
  return `${dateLabel} · ${typeLabel}${dist}`;
}

function startedLabel(log) {
  if (log?.startedAt) {
    const d = new Date(log.startedAt);
    if (!Number.isNaN(d.getTime())) return labelDate(d);
  }
  if (log?.date) {
    const d = new Date(log.date);
    if (!Number.isNaN(d.getTime())) return labelDate(d);
  }
  return "";
}

// Wall-clock start time "HH:MM" (local) — the single-session poster shows the
// time to the minute, not just a part-of-day word.
function clockTime(log) {
  if (!log?.startedAt) return "";
  const d = new Date(log.startedAt);
  if (Number.isNaN(d.getTime())) return "";
  const p = n => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function roundedRange(values, unit = "") {
  const nums = values.map(Number).filter(Number.isFinite).map(v => Math.round(v));
  if (!nums.length) return null;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  return min === max ? `${min}${unit}` : `${min}-${max}${unit}`;
}

function humidityPercent(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n > 1 ? n : n * 100;
}

// Detailed weather line from a workout's stored snapshot — temperature, feels-
// like, and humidity. Long workouts can carry a `series` of snapshots; show a
// range when that data exists, e.g. "18-23°C  ·  FEELS 19-25°C  ·  RH 58-70%".
// null when the snapshot has nothing usable, so the weather field can hide.
function weatherDetail(w) {
  if (!w || typeof w !== "object") return null;
  const series = Array.isArray(w.series) ? w.series : [];
  const temps = series.length > 1
    ? series.map(pt => pt?.tempC ?? pt?.tempAvgC ?? pt?.temp)
    : [w.tempC ?? w.tempAvgC ?? w.temp];
  const feels = series.length > 1
    ? series.map(pt => pt?.apparentC ?? pt?.apparentAvgC)
    : [w.apparentC ?? w.apparentAvgC];
  const humidities = series.length > 1
    ? series.map(pt => humidityPercent(pt?.humidity))
    : [humidityPercent(w.humidity)];
  const parts = [];
  const tempLabel = roundedRange(temps, "°C");
  const feelsLabel = roundedRange(feels, "°C");
  const rhLabel = roundedRange(humidities, "%");
  if (tempLabel) parts.push(tempLabel);
  if (feelsLabel) parts.push(`FEELS ${feelsLabel}`);
  if (rhLabel) parts.push(`RH ${rhLabel}`);
  return parts.length ? parts.join("  ·  ") : null;
}

function paceValue(log) {
  const distance = Number(log?.distance) || 0;
  const duration = Number(log?.duration) || 0;
  if (log?.type === "Cycling") return `${formatSpeedKmh(distance, duration)} km/h`;
  if (log?.type === "Swimming") return `${formatSwimPace(distance, duration)} /100m`;
  if (Number(log?.pace) > 0) return `${formatPaceFromSec(log.pace)} /km`;
  if (distance > 0 && duration > 0) return `${formatPaceFromSec(Math.round(duration / distance))} /km`;
  return "—";
}

function normalizeGpsTrack(track) {
  if (!Array.isArray(track)) return [];
  return track
    .map(pt => {
      if (Array.isArray(pt)) return [Number(pt[0]), Number(pt[1])];
      if (pt && typeof pt === "object") return [Number(pt.lat ?? pt.latitude), Number(pt.lng ?? pt.lon ?? pt.longitude)];
      return [NaN, NaN];
    })
    .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
}

// Fit a GPS track into a box, preserving aspect. Returns the path + endpoints
// so the hero route can carry start/finish markers.
function routeGeometry(points, x, y, w, h) {
  const pts = points || [];
  if (pts.length < 2) return null;
  const lats = pts.map(p => p[0]);
  const lngs = pts.map(p => p[1]);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const latSpan = maxLat - minLat || 1;
  const lngSpan = maxLng - minLng || 1;
  const pad = 8;
  const scale = Math.min((w - pad * 2) / lngSpan, (h - pad * 2) / latSpan);
  const rw = lngSpan * scale, rh = latSpan * scale;
  const ox = x + (w - rw) / 2, oy = y + (h - rh) / 2;
  const screen = pts.map(([lat, lng]) => [ox + (lng - minLng) * scale, oy + (maxLat - lat) * scale]);
  const d = screen.map(([px, py], i) => `${i === 0 ? "M" : "L"} ${px.toFixed(1)} ${py.toFixed(1)}`).join(" ");
  return { d, start: screen[0], end: screen[screen.length - 1] };
}

function getRange(mode, offset) {
  const now = new Date();
  if (mode === "week") {
    const start = new Date(now);
    const dayOfWeek = (now.getDay() + 6) % 7;
    start.setDate(now.getDate() - dayOfWeek + offset * 7);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 7);
    return { start, end };
  }
  if (mode === "year") {
    const year = now.getFullYear() + offset;
    return { start: new Date(year, 0, 1), end: new Date(year + 1, 0, 1) };
  }
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return { start, end: new Date(start.getFullYear(), start.getMonth() + 1, 1) };
}

function rangeLabel(mode, range, lang) {
  if (mode === "year") return String(range.start.getFullYear());
  if (mode === "month") {
    if (lang === "zh") return `${range.start.getFullYear()}.${String(range.start.getMonth() + 1).padStart(2, "0")}`;
    return range.start.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }
  const endDisplay = new Date(range.end);
  endDisplay.setDate(endDisplay.getDate() - 1);
  return `${labelDate(range.start)} – ${labelDate(endDisplay)}`;
}

function getPRRange(id) {
  if (id === "all") return null;
  const now = new Date();
  if (id === "last_12m") {
    const start = new Date(now);
    start.setFullYear(start.getFullYear() - 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setDate(end.getDate() + 1);
    end.setHours(0, 0, 0, 0);
    return { start, end };
  }
  const year = now.getFullYear() + (id === "last_year" ? -1 : 0);
  return { start: new Date(year, 0, 1), end: new Date(year + 1, 0, 1) };
}

// Bucket daily distances into <= maxBars columns so the "volume rhythm" strip
// stays legible (a year becomes ~weekly bars, a month stays daily).
function buildBars(days, maxBars) {
  if (!days?.length) return [];
  const chunk = Math.max(1, Math.ceil(days.length / maxBars));
  const bars = [];
  for (let i = 0; i < days.length; i += chunk) {
    let sum = 0;
    for (let j = i; j < Math.min(i + chunk, days.length); j++) sum += days[j].distance || 0;
    bars.push({ value: sum });
  }
  return bars;
}

function dailyDistances(logs, range) {
  const byDate = new Map();
  for (const log of logs) {
    const key = log.date;
    if (!key) continue;
    byDate.set(key, (byDate.get(key) || 0) + (Number(log.distance) || 0));
  }
  const days = [];
  for (let d = new Date(range.start); d < range.end; d.setDate(d.getDate() + 1)) {
    days.push({ date: dateKey(d), distance: byDate.get(dateKey(d)) || 0 });
  }
  return days;
}

function buildSingleStats(log, gpsTrack, fields) {
  const route = normalizeGpsTrack(gpsTrack);
  const distance = Number(log?.distance) || 0;
  const duration = Number(log?.duration) || 0;
  const hasDist = distance > 0;
  // Title Case heading — use the raw type so acronyms keep their case
  // ("HIIT", "Road Run") instead of being upper- or title-cased wrongly.
  const typeLabel = log?.type || "Workout";
  // Pace / elevation only make sense for distance-based activities — a Strength
  // or HIIT session shouldn't carry running pace.
  const distType = RUN_GROUP_TYPES.includes(log?.type) || hasDist;
  const weatherLine = weatherDetail(log?.weather);
  // Toggleable metric COLUMNS. Weather isn't a column — it prints as a detailed
  // line under the metrics (see weatherLine). Pace/elev drop for non-distance.
  const colDefs = {
    time: { label: "TIME", value: formatPlanDuration(duration) },
    pace: distType ? { label: "PACE", value: paceValue(log) } : null,
    elev: distType ? { label: "ELEV", value: `${fmtNum(Number(log?.ascent) || 0)} m` } : null,
    hr: { label: "AVG HR", value: Number(log?.hr) > 0 ? fmtNum(log.hr) : "—" },
  };
  const metrics = ["time", "pace", "elev", "hr"]
    .filter(k => fields?.[k] && colDefs[k])
    .map(k => colDefs[k]);
  return {
    mode: "single",
    title: typeLabel,                     // real activity type, not a fixed "SINGLE RUN"
    kicker: hasDist ? "DISTANCE" : "DURATION",
    heroValue: hasDist ? fmtNum(distance, distance >= 100 ? 0 : 1) : formatPlanDuration(duration),
    heroUnit: hasDist ? "KM" : "",
    meta: [startedLabel(log), clockTime(log)].filter(Boolean).join(" · "),
    fileLabel: `single-${log?.date || "workout"}`,
    route,
    bigPace: paceValue(log),
    metrics,
    weatherLine: fields?.weather ? weatherLine : null,
    hasWeather: !!weatherLine,
    distType,
  };
}

function buildPeriodStats(logs, mode, offset, lang) {
  const range = getRange(mode, offset);
  const periodLogs = logs.filter(l => {
    if (l.isPlanned || !RUN_GROUP_TYPES.includes(l.type)) return false;
    const d = new Date(l.date);
    return d >= range.start && d < range.end;
  });
  const totalKm = periodLogs.reduce((sum, l) => sum + (Number(l.distance) || 0), 0);
  const totalSec = periodLogs.reduce((sum, l) => sum + (Number(l.duration) || 0), 0);
  const totalAscent = periodLogs.reduce((sum, l) => sum + (Number(l.ascent) || 0), 0);
  const longest = periodLogs.reduce((best, l) => (Number(l.distance) || 0) > (Number(best?.distance) || 0) ? l : best, null);
  const days = dailyDistances(periodLogs, range);
  const title = mode === "week" ? "Weekly Volume" : mode === "year" ? "Yearly Volume" : "Monthly Volume";
  return {
    mode,
    title,
    kicker: "TOTAL DISTANCE",
    heroValue: fmtNum(totalKm, 1),
    heroUnit: "KM",
    meta: rangeLabel(mode, range, lang),
    fileLabel: `${mode}-${dateKey(range.start)}`,
    bars: buildBars(days, mode === "year" ? 53 : days.length || 1),
    metrics: [
      { label: "SESSIONS", value: fmtNum(periodLogs.length) },
      { label: "TIME", value: formatDurationShort(totalSec) },
      { label: "LONGEST", value: `${fmtNum(Number(longest?.distance) || 0, 1)} km` },
      { label: "ELEV", value: `${fmtNum(totalAscent)} m` },
    ],
  };
}

// All-time summary across every completed run-group session, no date window.
function buildAllStats(logs, lang) {
  const all = (logs || []).filter(l => !l.isPlanned && RUN_GROUP_TYPES.includes(l.type));
  const totalKm = all.reduce((sum, l) => sum + (Number(l.distance) || 0), 0);
  const totalSec = all.reduce((sum, l) => sum + (Number(l.duration) || 0), 0);
  const totalAscent = all.reduce((sum, l) => sum + (Number(l.ascent) || 0), 0);
  const longest = all.reduce((best, l) => (Number(l.distance) || 0) > (Number(best?.distance) || 0) ? l : best, null);
  const dated = all.map(l => l.date).filter(Boolean).sort();
  const startD = dated.length ? new Date(dated[0]) : new Date();
  const lastD = dated.length ? new Date(dated[dated.length - 1]) : new Date();
  const end = new Date(lastD); end.setDate(end.getDate() + 1);
  const days = dailyDistances(all, { start: startD, end });
  const activeDays = new Set(dated).size;
  return {
    mode: "all",
    title: "All-Time Volume",
    kicker: "TOTAL DISTANCE",
    heroValue: fmtNum(totalKm, 1),
    heroUnit: "KM",
    meta: dated.length ? `${labelDate(startD)} – ${labelDate(lastD)}` : (lang === "zh" ? "暂无记录" : "NO DATA YET"),
    fileLabel: "all-time",
    bars: buildBars(days, 60),
    metrics: [
      { label: "SESSIONS", value: fmtNum(all.length) },
      { label: "TIME", value: formatDurationShort(totalSec) },
      { label: "LONGEST", value: `${fmtNum(Number(longest?.distance) || 0, 1)} km` },
      { label: "ACTIVE DAYS", value: fmtNum(activeDays) },
      { label: "ELEV", value: `${fmtNum(totalAscent)} m` },
    ],
  };
}

function buildPRRecords(races) {
  const history = (races || []).filter(r => !r.isTarget);
  const byCategory = {};
  for (const r of history) {
    const cat = r.category || "Other";
    (byCategory[cat] = byCategory[cat] || []).push(r);
  }
  const spartanRank = SPARTAN_SUBTYPES.reduce((acc, name, i) => { acc[name] = i + 1; return acc; }, {});
  const out = [];
  for (const cat of RACE_CATEGORIES) {
    const group = byCategory[cat];
    if (!group || group.length === 0) continue;
    let best, metric = "time";
    if (cat === "Trail") {
      metric = "distance";
      best = [...group].sort((a, b) => (Number(b.distance) || 0) - (Number(a.distance) || 0))[0] || null;
      if (!(Number(best?.distance) > 0)) best = null;
    } else if (cat === "Spartan") {
      metric = "difficulty";
      best = [...group].sort((a, b) => (spartanRank[b.subtype] || 0) - (spartanRank[a.subtype] || 0))[0] || null;
      if (!spartanRank[best?.subtype]) best = null;
    } else {
      best = [...group].sort((a, b) => resultSeconds(a) - resultSeconds(b))[0] || null;
      if (!isFinite(resultSeconds(best))) best = null;
    }
    if (best) {
      out.push({
        category: cat,
        value: metric === "distance" ? `${fmtNum(best.distance, 1)} km`
          : metric === "difficulty" ? best.subtype
          : formatHMS(resultSeconds(best)),
      });
    }
  }
  return out;
}

function buildPRStats(races, rangeId, t) {
  const range = getPRRange(rangeId);
  const filtered = range
    ? (races || []).filter(r => {
      const d = new Date(r.date);
      return !Number.isNaN(d.getTime()) && d >= range.start && d < range.end;
    })
    : races;
  const records = buildPRRecords(filtered);
  return {
    mode: "pr",
    title: "Personal Records",
    kicker: "RECORDS SET",
    heroValue: fmtNum(records.length),
    heroUnit: "PR",
    meta: t(`poster.pr_range_${rangeId}`) || "",
    fileLabel: `pr-${rangeId}`,
    records,
  };
}

// ── The poster ──────────────────────────────────────────────────────────────
// The themed line-art mark (the logo's actual mountain + dots + green tick,
// extracted per theme by scripts/make-poster-mark.mjs). It's a square; place it
// centred with its foot near mid-height so it reads as a watermark behind the
// content across crop ratios.
function PosterBackground({ W, H, pal, markSrc }) {
  if (!markSrc) return null;
  const size = W;
  // Centre the (square) mark on the poster's vertical midpoint so it reads as a
  // centred watermark rather than riding high.
  const y = Math.round(H * 0.5 - W * 0.5);
  return (
    <image href={markSrc} x={0} y={y} width={size} height={size}
      opacity={pal.markOpacity} preserveAspectRatio="xMidYMid meet"
      style={{ pointerEvents: "none" }} />
  );
}

function Poster({ stats, theme, ratio, svgRef, logoSrc, markSrc }) {
  const W = ratio.w, H = ratio.h;
  const pal = THEMES[theme];
  const M = 82;
  const inner = W - M * 2;

  // Vertical anchors as fractions of H — keeps the composition coherent across crops.
  const compactSingle = stats.mode === "single" && stats.weatherLine;
  const yTitle = H * (compactSingle ? 0.092 : 0.108);
  const ySub = H * (compactSingle ? 0.127 : 0.143);
  const yHeadRule = H * (compactSingle ? 0.160 : 0.178);
  const yKick = H * (compactSingle ? 0.238 : 0.262);
  const yHero = H * (compactSingle ? 0.420 : 0.452);
  const spineTop = H * (compactSingle ? 0.492 : 0.527);
  const spineBot = H * (compactSingle ? 0.710 : 0.745);
  const yHair = H * (compactSingle ? 0.754 : 0.788);
  const yML = H * (compactSingle ? 0.783 : 0.816);
  const yMV = H * (compactSingle ? 0.820 : 0.853);
  const ySign = H * 0.940;
  const yUrl = H * 0.963;

  const heroStr = String(stats.heroValue);
  const heroSize = Math.min(H * 0.255, inner / (Math.max(heroStr.length, 1) * 0.50 + 0.7));
  const unitSize = heroSize * 0.26;
  const logoSize = Math.round(W * (ratio.key === "story" ? 0.20 : 0.18));
  const logoMargin = 28;
  const logoX = W - logoMargin - logoSize;
  const logoY = logoMargin;
  const headerRuleEnd = Math.max(M + inner * 0.45, logoX - logoMargin);
  const titleSize = Math.min(60, H * 0.046);
  const metaSize = Math.min(34, H * 0.026);
  const kickerSize = Math.min(34, H * 0.026);

  // Spine graphic per mode — the running itself, not a grid of data cards.
  let spine;
  if (stats.mode === "single") {
    const geo = routeGeometry(stats.route, M, spineTop, inner, spineBot - spineTop);
    if (geo) {
      spine = (
        <g>
          <path d={geo.d} fill="none" stroke={pal.accent} strokeWidth="22" strokeLinecap="round" strokeLinejoin="round" opacity="0.16" />
          <path d={geo.d} fill="none" stroke={pal.ink} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={geo.start[0]} cy={geo.start[1]} r="11" fill={pal.accent} />
          <circle cx={geo.end[0]} cy={geo.end[1]} r="10" fill={pal.bg} stroke={pal.ink} strokeWidth="4.5" />
        </g>
      );
    } else if (stats.distType) {
      // No GPS but a distance activity — promote pace to a second hero element
      // rather than leave a hole. (Strength/HIIT have no pace, so skip this.)
      const bandMid = (spineTop + spineBot) / 2;
      spine = (
        <g>
          <text x={M} y={spineTop + H * 0.04} fontFamily={FF} fontWeight="600" fontSize="30" letterSpacing="4" fill={pal.sub}>AVG PACE</text>
          <text x={M} y={bandMid + H * 0.05} fontFamily={FF} fontWeight="800" fontSize={H * 0.13} fill={pal.ink}>{stats.bigPace}</text>
        </g>
      );
    }
  } else if (stats.mode === "pr") {
    const recs = (stats.records || []).slice(0, 6);
    const rowH = Math.min(72, (spineBot - spineTop) / Math.max(recs.length, 1));
    spine = recs.length ? (
      <g>
        {recs.map((r, i) => {
          const ry = spineTop + i * rowH;
          const cy = ry + rowH * 0.66;
          const top = i === 0;
          return (
            <g key={`${r.category}-${i}`}>
              {i > 0 && <line x1={M} x2={W - M} y1={ry} y2={ry} stroke={pal.hair} strokeWidth="1.4" />}
              <text x={M} y={cy} fontFamily={FF} fontWeight="600" fontSize="36" letterSpacing="1" fill={pal.ink}>{r.category}</text>
              <text x={W - M} y={cy} textAnchor="end" fontFamily={FF} fontWeight="800" fontSize="44" fill={top ? pal.accent : pal.ink}>{r.value}</text>
            </g>
          );
        })}
      </g>
    ) : (
      <text x={M} y={(spineTop + spineBot) / 2} fontFamily={FF} fontWeight="600" fontSize="36" fill={pal.sub}>NO RACES LOGGED YET</text>
    );
  } else {
    // Period — running volume as a rhythmic bar strip along a baseline.
    const bars = stats.bars || [];
    const n = Math.max(bars.length, 1);
    const maxV = Math.max(...bars.map(b => b.value), 1);
    const slot = inner / n;
    const barW = Math.max(2, Math.min(slot * 0.56, 24));
    const bandH = spineBot - spineTop;
    spine = (
      <g>
        {bars.map((b, i) => {
          if (!(b.value > 0)) return null;
          const hh = Math.max(6, (b.value / maxV) * bandH);
          const bx = M + i * slot + (slot - barW) / 2;
          const peak = b.value === maxV;
          return <rect key={i} x={bx} y={spineBot - hh} width={barW} height={hh} fill={peak ? pal.accent : pal.ink} opacity={peak ? 1 : 0.82} />;
        })}
        <line x1={M} x2={W - M} y1={spineBot} y2={spineBot} stroke={pal.hair} strokeWidth="2" />
      </g>
    );
  }

  const showMetrics = stats.mode !== "pr" && stats.metrics;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} xmlns="http://www.w3.org/2000/svg" ref={svgRef}
      role="img" aria-label={stats.title} style={{ width: "100%", height: "auto", display: "block", background: pal.bg }}>
      <defs>
        <style>{POSTER_FONT_CSS}</style>
        <radialGradient id={`poster-vignette-${theme}`} cx="50%" cy="42%" r="75%">
          <stop offset="0%" stopColor="#000000" stopOpacity="0" />
          <stop offset="70%" stopColor="#000000" stopOpacity={pal.vignetteA} />
          <stop offset="100%" stopColor="#000000" stopOpacity={pal.vignetteB} />
        </radialGradient>
      </defs>
      <rect width={W} height={H} fill={pal.bg} />
      <PosterBackground W={W} H={H} pal={pal} markSrc={markSrc} />
      <rect width={W} height={H} fill={`url(#poster-vignette-${theme})`} />

      {/* Header */}
      <text x={M} y={yTitle} fontFamily={FF} fontWeight="800" fontSize={titleSize} letterSpacing="1" fill={pal.ink}>{stats.title}</text>
      <text x={M} y={ySub} fontFamily={FF} fontWeight="600" fontSize={metaSize} letterSpacing="1" fill={pal.sub}>{stats.meta}</text>
      {logoSrc && (
        <image href={logoSrc} x={logoX} y={logoY} width={logoSize} height={logoSize} opacity="0.98" preserveAspectRatio="xMidYMid meet" />
      )}
      <line x1={M} x2={headerRuleEnd} y1={yHeadRule} y2={yHeadRule} stroke={pal.hair} strokeWidth="2" />

      {/* Hero */}
      <text x={M} y={yKick} fontFamily={FF} fontWeight="600" fontSize={kickerSize} letterSpacing="4" fill={pal.sub}>{stats.kicker}</text>
      <text x={M} y={yHero} fontFamily={FF} fontWeight="800" fill={pal.ink} style={{ fontVariantNumeric: "tabular-nums" }}>
        <tspan fontSize={heroSize}>{stats.heroValue}</tspan>
        {stats.heroUnit ? <tspan dx={20} fontSize={unitSize} fontWeight="800" fill={pal.accent}>{stats.heroUnit}</tspan> : null}
      </text>
      {/* Spine */}
      {spine}

      {/* Metrics */}
      {showMetrics && stats.metrics.length > 0 && (
        <g>
          <line x1={M} x2={W - M} y1={yHair} y2={yHair} stroke={pal.hair} strokeWidth="2" />
          {(() => {
            const n = stats.metrics.length;
            const colW = inner / n;
            const mvSize = n >= 5 ? 40 : n === 1 ? 60 : 52;
            // Centre each metric in its column → fewer columns sit evenly spaced
            // and centred (2 metrics land at 1/4 + 3/4, not bunched at the left).
            return stats.metrics.map((m, i) => {
              const cx = M + (i + 0.5) * colW;
              return (
                <g key={`${m.label}-${i}`}>
                  <text x={cx} y={yML} textAnchor="middle" fontFamily={FF} fontWeight="600" fontSize="25" letterSpacing="1.5" fill={pal.sub}>{m.label}</text>
                  <text x={cx} y={yMV} textAnchor="middle" fontFamily={FF} fontWeight="800" fontSize={mvSize} fill={pal.ink}>{m.value}</text>
                </g>
              );
            });
          })()}
        </g>
      )}

      {/* Weather detail line — temp / feels-like / humidity, under the metrics. */}
      {stats.weatherLine && (
        <text x={W / 2} y={H * 0.866} textAnchor="middle" fontFamily={FF} fontWeight="600" fontSize="26" letterSpacing="1" fill={pal.sub}>{stats.weatherLine}</text>
      )}

      {/* Signature */}
      <text x={W / 2} y={ySign} textAnchor="middle" fontFamily={FF_SIGN} fontWeight="400" fontSize={H * 0.062} fill={pal.ink} opacity="0.94">Ultreia</text>
      <text x={W / 2} y={yUrl} textAnchor="middle" fontFamily={FF} fontWeight="600" fontSize="24" letterSpacing="1.5" fill={pal.sub}>www.ultreia.run</text>
    </svg>
  );
}

export function MonthlyPosterModal({ logs, races = [], onClose }) {
  const t = useT();
  const { lang } = useLanguage();
  const svgRef = useRef(null);
  const [mode, setMode] = useState("month");
  const [rangeOffset, setRangeOffset] = useState(0);
  const [prRange, setPrRange] = useState("all");
  const [theme, setTheme] = useState("day");
  const [ratioKey, setRatioKey] = useState("portrait");
  const ratio = RATIOS[ratioKey];

  const singleOptions = useMemo(() => (logs || [])
    .filter(l => !l.isPlanned && (Number(l.distance) > 0 || Number(l.duration) > 0))
    .slice()
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .slice(0, 80), [logs]);
  const [selectedWorkoutId, setSelectedWorkoutId] = useState("");
  const [singleGpsTrack, setSingleGpsTrack] = useState(null);
  const [routeLoading, setRouteLoading] = useState(false);
  // The corner logo starts as the plain asset URL so the preview renders
  // instantly (the in-DOM SVG can fetch it); the effect below swaps in a data
  // URL, which the PNG export path requires (see fetchAsDataUrl). The contour
  // background is pure vector now, so no background image to convert.
  const [logoSrc, setLogoSrc] = useState(productLogoUrl);
  // Themed background marks (logo line-art). Same asset-URL → data-URL dance as
  // the corner logo so the PNG export's serialized SVG carries them inline.
  const [markDaySrc, setMarkDaySrc] = useState(markDayUrl);
  const [markNightSrc, setMarkNightSrc] = useState(markNightUrl);
  const markSrc = theme === "day" ? markDaySrc : markNightSrc;
  // Which single-session metrics to print. Weather defaults off (only some
  // workouts carry a snapshot); the UI disables it when there's none.
  const [singleFields, setSingleFields] = useState({ time: true, pace: true, elev: true, hr: true, weather: false });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const selectedWorkout = useMemo(() => (
    singleOptions.find(l => l.id === selectedWorkoutId) || singleOptions[0] || null
  ), [singleOptions, selectedWorkoutId]);

  const periodOptions = useMemo(() => {
    if (!RANGE_MODES.has(mode)) return [];
    const count = mode === "week" ? 16 : mode === "year" ? 6 : 18;
    const arr = [];
    for (let o = 0; o > -count; o--) arr.push({ value: o, label: rangeLabel(mode, getRange(mode, o), lang) });
    return arr;
  }, [mode, lang]);

  const stats = useMemo(() => (
    mode === "single" ? buildSingleStats(selectedWorkout, singleGpsTrack, singleFields)
      : mode === "pr" ? buildPRStats(races, prRange, t)
      : mode === "all" ? buildAllStats(logs || [], lang)
      : buildPeriodStats(logs || [], mode, rangeOffset, lang)
  ), [logs, races, selectedWorkout, singleGpsTrack, mode, rangeOffset, prRange, lang, t, singleFields]);

  useEffect(() => {
    let alive = true;
    fetchAsDataUrl(productLogoUrl)
      .then(d => { if (alive) setLogoSrc(d); })
      .catch(() => {}); // preview keeps the asset URL; export retries and surfaces the error
    fetchAsDataUrl(markDayUrl).then(d => { if (alive) setMarkDaySrc(d); }).catch(() => {});
    fetchAsDataUrl(markNightUrl).then(d => { if (alive) setMarkNightSrc(d); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    async function loadTrack() {
      if (mode !== "single" || !selectedWorkout?.id) { setSingleGpsTrack(null); return; }
      setRouteLoading(true);
      try {
        const track = await workoutsDb.getWorkoutGpsTrack(selectedWorkout.id);
        if (alive) setSingleGpsTrack(track);
      } catch {
        if (alive) setSingleGpsTrack(null);
      } finally {
        if (alive) setRouteLoading(false);
      }
    }
    loadTrack();
    return () => { alive = false; };
  }, [mode, selectedWorkout?.id]);

  function switchMode(nextMode) {
    setMode(nextMode);
    setMsg("");
    if (!RANGE_MODES.has(nextMode)) setRangeOffset(0);
  }

  async function downloadPoster() {
    if (!svgRef.current || busy || (mode === "single" && !selectedWorkout)) return;
    setBusy(true);
    setMsg("");
    try {
      // Every <image> href (corner logo + the themed background mark) must be a
      // data URL before serialization (an <img>-loaded SVG can't fetch external
      // resources). Await the cached conversions — instant when the mount effect
      // already finished — and flush them into the DOM so the serializer sees
      // them. A failed fetch rejects here and lands in the catch below instead
      // of silently exporting a poster missing its logo / mark.
      const markUrl = theme === "day" ? markDayUrl : markNightUrl;
      const [logoData, markData] = await Promise.all([
        fetchAsDataUrl(productLogoUrl),
        fetchAsDataUrl(markUrl),
      ]);
      flushSync(() => {
        setLogoSrc(logoData);
        if (theme === "day") setMarkDaySrc(markData); else setMarkNightSrc(markData);
      });
      // No document.fonts.ready wait — the fonts are embedded as base64
      // @font-face INSIDE the serialized SVG, so the export img is self-contained
      // and waiting on document-level font loading just stalls (notably on the
      // Android WebView).
      const svgText = new XMLSerializer().serializeToString(svgRef.current);
      const svgBlob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
      const svgUrl = URL.createObjectURL(svgBlob);
      const img = new Image();
      img.decoding = "sync";
      const loaded = new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });
      img.src = svgUrl;
      await loaded;
      const canvas = document.createElement("canvas");
      canvas.width = ratio.w;
      canvas.height = ratio.h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas unavailable");
      ctx.drawImage(img, 0, 0, ratio.w, ratio.h);
      URL.revokeObjectURL(svgUrl);

      const fileName = `ultreia-${stats.fileLabel}-${theme}-${ratioKey}.png`;
      // Native: encode the PNG ONCE (toDataURL) and hand it to the saver — the
      // old path encoded twice (toBlob then toDataURL), doubling the cost.
      if (isNativeApp()) {
        const dataUrl = canvas.toDataURL("image/png");
        await PosterSaver.savePng({ fileName, data: dataUrl });
        setMsg(t("poster.downloaded"));
        return;
      }
      const pngBlob = await new Promise((resolve, reject) => {
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("PNG export failed")), "image/png");
      });
      const file = new File([pngBlob], fileName, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] }) && navigator.share) {
        await navigator.share({ files: [file], title: "Ultreia" });
        setMsg(t("poster.downloaded"));
        return;
      }
      const pngUrl = URL.createObjectURL(pngBlob);
      const a = document.createElement("a");
      a.href = pngUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(pngUrl);
      setMsg(t("poster.downloaded"));
    } catch {
      setMsg(t("poster.download_failed"));
    } finally {
      setBusy(false);
    }
  }

  const previewW = ratioKey === "story" ? 248 : ratioKey === "square" ? 320 : 300;

  return (
    <ModalRoot onClose={onClose}>
      <div onClick={onClose} style={s.modalOverlay(true, { float: true })}>
        <div onClick={e => e.stopPropagation()}
          style={s.modalCard(true, { maxWidth: 480, bg: "var(--bg)", float: true })}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{t("poster.preview_title")}</h2>
            <button onClick={onClose} style={s.modalCloseBtn} aria-label="Close">×</button>
          </div>

          {/* Row 1: poster type */}
          <label style={{ ...s.muted, fontSize: 12, display: "block", marginBottom: 4 }}>{t("poster.field_type")}</label>
          <div style={{ marginBottom: 10 }}>
            <Dropdown
              ariaLabel={t("poster.field_type")}
              options={POSTER_MODES.map(id => ({ value: id, label: t(`poster.mode_${id}`) }))}
              value={mode}
              onChange={switchMode}
            />
          </div>

          {/* Row 2: subject (workout / period / pr range) */}
          {mode === "single" && (
            <div style={{ marginBottom: 10 }}>
              <label style={{ ...s.muted, fontSize: 12, display: "block", marginBottom: 4 }}>{t("poster.field_workout")}</label>
              <Dropdown
                ariaLabel={t("poster.field_workout")}
                placeholder={t("poster.no_single_workout")}
                options={singleOptions.map(l => ({ value: l.id, label: workoutLabel(l) }))}
                value={selectedWorkout?.id || ""}
                onChange={v => { setSelectedWorkoutId(v); setMsg(""); }}
              />
              <div style={{ ...s.muted, fontSize: 12, marginTop: 4 }}>
                {routeLoading ? t("poster.route_loading") : (stats.route?.length >= 2 ? t("poster.route_map") : t("poster.single_no_route"))}
              </div>
              {/* Pick which metrics to print. Weather only when this workout
                  carries a snapshot. `minHeight: 0` keeps these chips small —
                  the global mobile button min-height would otherwise bloat them. */}
              <label style={{ ...s.muted, fontSize: 12, display: "block", margin: "10px 0 4px" }}>{t("poster.field_data")}</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {SINGLE_FIELDS.map(k => {
                  const disabled = (k === "weather" && !stats.hasWeather)
                    || ((k === "pace" || k === "elev") && !stats.distType);
                  const on = !!singleFields[k] && !disabled;
                  return (
                    <button key={k} type="button" disabled={disabled}
                      onClick={() => setSingleFields(prev => ({ ...prev, [k]: !prev[k] }))}
                      style={{
                        minHeight: 0, padding: "5px 11px", fontSize: 12, borderRadius: 2, cursor: disabled ? "default" : "pointer",
                        border: "1px solid " + (on ? "var(--moss)" : "var(--rule)"),
                        background: on ? "var(--moss-bg)" : "var(--bg-elevated)",
                        color: disabled ? "var(--ink-3)" : on ? "var(--ink-1)" : "var(--ink-2)",
                        opacity: disabled ? 0.5 : 1,
                      }}>
                      {SINGLE_FIELD_LABELS[lang === "zh" ? "zh" : "en"][k]}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {RANGE_MODES.has(mode) && (
            <div style={{ marginBottom: 10 }}>
              <label style={{ ...s.muted, fontSize: 12, display: "block", marginBottom: 4 }}>{t("poster.field_period")}</label>
              <Dropdown
                ariaLabel={t("poster.field_period")}
                options={periodOptions}
                value={rangeOffset}
                onChange={v => { setRangeOffset(v); setMsg(""); }}
              />
            </div>
          )}
          {mode === "pr" && (
            <div style={{ marginBottom: 10 }}>
              <label style={{ ...s.muted, fontSize: 12, display: "block", marginBottom: 4 }}>{t("poster.field_period")}</label>
              <Dropdown
                ariaLabel={t("poster.field_period")}
                options={PR_RANGES.map(id => ({ value: id, label: t(`poster.pr_range_${id}`) }))}
                value={prRange}
                onChange={v => { setPrRange(v); setMsg(""); }}
              />
            </div>
          )}

          {/* Row 3: theme + ratio */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
            <div>
              <label style={{ ...s.muted, fontSize: 12, display: "block", marginBottom: 4 }}>{t("poster.field_theme")}</label>
              <Dropdown
                ariaLabel={t("poster.field_theme")}
                options={THEME_KEYS.map(k => ({ value: k, label: t(`poster.theme_${k}`) }))}
                value={theme}
                onChange={setTheme}
              />
            </div>
            <div>
              <label style={{ ...s.muted, fontSize: 12, display: "block", marginBottom: 4 }}>{t("poster.field_ratio")}</label>
              <Dropdown
                ariaLabel={t("poster.field_ratio")}
                options={RATIO_KEYS.map(k => ({ value: k, label: t(`poster.ratio_${k}`) }))}
                value={ratioKey}
                onChange={setRatioKey}
              />
            </div>
          </div>

          {/* Preview */}
          <div style={{
            width: "100%", maxWidth: previewW, margin: "0 auto 14px",
            border: "1px solid var(--rule)", background: "var(--bg-elevated)",
          }}>
            <Poster stats={stats} theme={theme} ratio={ratio} svgRef={svgRef} logoSrc={logoSrc} markSrc={markSrc} />
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
            {msg && <span style={{ ...s.muted, marginRight: "auto" }}>{msg}</span>}
            <button onClick={onClose} style={s.btnGhost}>{t("common.cancel")}</button>
            <button onClick={downloadPoster} disabled={busy || (mode === "single" && !selectedWorkout)}
              style={{ ...s.btn, opacity: busy || (mode === "single" && !selectedWorkout) ? 0.6 : 1 }}>
              {busy ? t("poster.saving") : t("poster.save_png")}
            </button>
          </div>
        </div>
      </div>
    </ModalRoot>
  );
}
