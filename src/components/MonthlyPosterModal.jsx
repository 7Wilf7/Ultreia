import { useEffect, useMemo, useRef, useState } from "react";
import { RACE_CATEGORIES, RUN_GROUP_TYPES, SPARTAN_SUBTYPES } from "../constants";
import { useT, useLanguage } from "../i18n/LanguageContext";
import { workouts as workoutsDb } from "../lib/db";
import { formatDurationShort, formatPaceFromSec, formatSpeedKmh, formatSwimPace } from "../utils/format";
import { s } from "../styles";
import { ModalRoot } from "./ModalRoot";
import iconOnlyUrl from "../../resources/icon-only-poster.png";

const POSTER_W = 1080;
const POSTER_H = 1920;
const TEMPLATES = ["classic", "bib", "topo"];
const POSTER_MODES = ["single", "week", "month", "year", "pr"];
const RANGE_MODES = new Set(["week", "month", "year"]);
const PR_RANGES = ["all", "this_year", "last_year", "last_12m"];

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

function paceValue(log) {
  const distance = Number(log?.distance) || 0;
  const duration = Number(log?.duration) || 0;
  if (log?.type === "Cycling") return `${formatSpeedKmh(distance, duration)} km/h`;
  if (log?.type === "Swimming") return `${formatSwimPace(distance, duration)} /100m`;
  if (Number(log?.pace) > 0) return `${formatPaceFromSec(log.pace)} /km`;
  if (distance > 0 && duration > 0) return `${formatPaceFromSec(Math.round(duration / distance))} /km`;
  return "-";
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

function gpsPath(track, x, y, w, h) {
  const pts = normalizeGpsTrack(track);
  if (pts.length < 2) return "";
  const lats = pts.map(p => p[0]);
  const lngs = pts.map(p => p[1]);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latSpan = maxLat - minLat || 1;
  const lngSpan = maxLng - minLng || 1;
  const pad = 44;
  const scale = Math.min((w - pad * 2) / lngSpan, (h - pad * 2) / latSpan);
  const routeW = lngSpan * scale;
  const routeH = latSpan * scale;
  const ox = x + (w - routeW) / 2;
  const oy = y + (h - routeH) / 2;
  return pts.map(([lat, lng], i) => {
    const px = ox + (lng - minLng) * scale;
    const py = oy + (maxLat - lat) * scale;
    return `${i === 0 ? "M" : "L"} ${px.toFixed(1)} ${py.toFixed(1)}`;
  }).join(" ");
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
    return {
      start: new Date(year, 0, 1),
      end: new Date(year + 1, 0, 1),
    };
  }
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return {
    start,
    end: new Date(start.getFullYear(), start.getMonth() + 1, 1),
  };
}

function buildSingleStats(log, gpsTrack, t) {
  const route = normalizeGpsTrack(gpsTrack);
  const distance = Number(log?.distance) || 0;
  const duration = Number(log?.duration) || 0;
  const typeLabel = log?.type || "Workout";
  return {
    mode: "single",
    title: t("poster.single_title"),
    periodLabel: startedLabel(log),
    fileLabel: `single-${log?.date || "workout"}`,
    primaryValue: fmtNum(distance, distance >= 100 ? 0 : 1),
    primaryUnit: distance > 0 ? "km" : "",
    primaryLabel: typeLabel.toUpperCase(),
    note: route.length >= 2 ? t("poster.single_route_note") : t("poster.single_no_route"),
    routeLabel: route.length >= 2 ? t("poster.route_map") : t("poster.single_no_route"),
    activeDaysLabel: t("poster.route_points"),
    activeDays: route.length >= 2 ? route.length : null,
    gpsTrack: route,
    metrics: [
      { label: t("poster.time"), value: formatDurationShort(duration) },
      { label: t("poster.pace"), value: paceValue(log) },
      { label: t("poster.ascent"), value: `+${fmtNum(Number(log?.ascent) || 0)} m` },
      { label: t("poster.avg_hr"), value: Number(log?.hr) > 0 ? fmtNum(log.hr) : "-" },
    ],
  };
}

function rangeLabel(mode, range, lang) {
  if (mode === "year") return String(range.start.getFullYear());
  if (mode === "month") {
    if (lang === "zh") return `${range.start.getFullYear()}.${String(range.start.getMonth() + 1).padStart(2, "0")}`;
    return range.start.toLocaleDateString("en-US", { month: "long", year: "numeric" }).toUpperCase();
  }
  const endDisplay = new Date(range.end);
  endDisplay.setDate(endDisplay.getDate() - 1);
  return `${labelDate(range.start)} - ${labelDate(endDisplay)}`;
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
  return {
    start: new Date(year, 0, 1),
    end: new Date(year + 1, 0, 1),
  };
}

function prRangeLabel(id, t) {
  return t(`poster.pr_range_${id}`);
}

function buildPeriodStats(logs, mode, offset, lang, t) {
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
  const activeDays = new Set(periodLogs.map(l => l.date)).size;
  const label = rangeLabel(mode, range, lang);

  return {
    mode,
    title: t(`poster.${mode}_title`),
    periodLabel: label,
    fileLabel: `${mode}-${dateKey(range.start)}`,
    primaryValue: fmtNum(totalKm, 1),
    primaryUnit: "km",
    primaryLabel: t(`poster.${mode}_subtitle`),
    note: t("poster.monthly_note"),
    activeDaysLabel: t("poster.active_days"),
    activeDays,
    metrics: [
      { label: t("poster.sessions"), value: fmtNum(periodLogs.length) },
      { label: t("poster.time"), value: formatDurationShort(totalSec) },
      { label: t("poster.longest"), value: `${fmtNum(Number(longest?.distance) || 0, 1)} km` },
      { label: t("poster.ascent"), value: `+${fmtNum(totalAscent)} m` },
    ],
  };
}

function buildPRRecords(races) {
  const history = (races || []).filter(r => !r.isTarget);
  const byCategory = {};
  for (const r of history) {
    const cat = r.category || "Other";
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(r);
  }

  const spartanRank = SPARTAN_SUBTYPES.reduce((acc, name, i) => {
    acc[name] = i + 1;
    return acc;
  }, {});

  const out = [];
  for (const cat of RACE_CATEGORIES) {
    const group = byCategory[cat];
    if (!group || group.length === 0) continue;

    let best;
    let metric = "time";
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
        metric,
        race: best,
        value: metric === "distance"
          ? `${fmtNum(best.distance, 1)} km`
          : metric === "difficulty"
            ? best.subtype
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
    title: t("poster.pr_title"),
    periodLabel: prRangeLabel(rangeId, t),
    fileLabel: `pr-${rangeId}`,
    primaryValue: fmtNum(records.length),
    primaryUnit: "PR",
    primaryLabel: t("poster.pr_subtitle"),
    note: t("poster.pr_note"),
    activeDaysLabel: t("poster.active_days"),
    activeDays: null,
    metrics: (records.length ? records : [{ category: "-", value: "-" }]).slice(0, 4).map(rec => ({
      label: rec.category,
      value: rec.value,
    })),
  };
}

function brandMark({ logoSrc, x = 874, y = 118, size = 96, opacity = 1 }) {
  return (
    <image href={logoSrc} x={x} y={y} width={size} height={size} opacity={opacity} preserveAspectRatio="xMidYMid meet" />
  );
}

function signature({ y = 1664, ink = "#141413", urlInk = ink, opacity = 0.78 }) {
  return (
    <g>
      <text
        x="540"
        y={y}
        textAnchor="middle"
        fill={ink}
        opacity={opacity}
        fontFamily="Brush Script MT, Segoe Script, Georgia, serif"
        fontSize="68"
        fontStyle="italic"
      >
        Training Studio
      </text>
      <text x="540" y={y + 48} textAnchor="middle" fill={urlInk} opacity="0.72" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="22" fontWeight="700" letterSpacing="2">
        www.aitrainstudio.com
      </text>
    </g>
  );
}

function metricCards(stats, palette, x = 110, y = 790) {
  return (
    <g transform={`translate(${x} ${y})`}>
      {stats.metrics.map((item, i) => (
        <g key={`${item.label}-${i}`} transform={`translate(${(i % 2) * 430} ${Math.floor(i / 2) * 170})`}>
          <rect x="0" y="0" width="388" height="130" fill={palette.card} stroke={palette.rule} strokeWidth="2" />
          <text x="28" y="43" fill={palette.muted} fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="24" fontWeight="700" letterSpacing="2">
            {item.label}
          </text>
          <text x="28" y="100" fill={palette.ink} fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="44" fontWeight="800">
            {item.value}
          </text>
        </g>
      ))}
    </g>
  );
}

function periodLine(stats, palette, y = 1288) {
  return (
    <g>
      <rect x="110" y={y - 74} width="860" height="2" fill={palette.ruleStrong} />
      {stats.activeDays == null ? (
        <text x="110" y={y} fill={palette.ink} fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="34" fontWeight="800">
          {stats.periodLabel}
        </text>
      ) : (
        <text x="110" y={y} fill={palette.ink} fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="34" fontWeight="800">
          {stats.activeDaysLabel} {fmtNum(stats.activeDays)}
        </text>
      )}
      <text x="970" y={y} textAnchor="end" fill={palette.muted} fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="28">
        {stats.note}
      </text>
    </g>
  );
}

function RoutePanel({ stats, palette, x = 110, y = 720, w = 860, h = 470 }) {
  const path = gpsPath(stats.gpsTrack, x, y, w, h);
  const hasRoute = Boolean(path);
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill={palette.card} stroke={palette.rule} strokeWidth="2" />
      <g fill="none" stroke={palette.ruleStrong} strokeWidth="1" opacity="0.13">
        {Array.from({ length: 8 }, (_, i) => (
          <path key={i} d={`M${x + 28} ${y + 60 + i * 45} C ${x + 220} ${y + 5 + i * 40}, ${x + 410} ${y + 105 + i * 24}, ${x + 620} ${y + 58 + i * 46} S ${x + 780} ${y + 10 + i * 42}, ${x + w - 28} ${y + 76 + i * 34}`} />
        ))}
      </g>
      <text x={x + 34} y={y + 56} fill={palette.muted} fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="26" fontWeight="800" letterSpacing="3">
        {stats.routeLabel}
      </text>
      {hasRoute ? (
        <>
          <path d={path} fill="none" stroke={palette.ruleStrong} strokeWidth="16" strokeLinecap="round" strokeLinejoin="round" opacity="0.12" />
          <path d={path} fill="none" stroke={palette.ink} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <text x={x + w / 2} y={y + h / 2 + 20} textAnchor="middle" fill={palette.muted} fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="34" fontWeight="700">
          {stats.note}
        </text>
      )}
    </g>
  );
}

function ClassicPoster({ stats, svgRef, logoSrc }) {
  const palette = {
    ink: "#141413",
    muted: "#74736b",
    rule: "#d1cfc6",
    ruleStrong: "#141413",
    card: "#fafaf7",
  };

  return (
    <svg viewBox={`0 0 ${POSTER_W} ${POSTER_H}`} width={POSTER_W} height={POSTER_H} xmlns="http://www.w3.org/2000/svg" ref={svgRef}
      role="img" aria-label={stats.title} style={{ width: "100%", height: "auto", display: "block", background: "#f2f1ec" }}>
      <rect width={POSTER_W} height={POSTER_H} fill="#f2f1ec" />
      <circle cx="160" cy="180" r="360" fill="#4a5e3a" opacity="0.055" />
      <circle cx="1040" cy="120" r="420" fill="#141413" opacity="0.035" />
      <g fill="none" stroke="#141413" strokeWidth="1.2" opacity="0.06">
        <path d="M-80 420 C 160 300, 320 520, 540 390 S 900 250, 1180 380" />
        <path d="M-80 500 C 190 370, 360 600, 600 455 S 930 340, 1180 455" />
        <path d="M-80 1260 C 220 1110, 390 1360, 650 1190 S 900 1110, 1180 1260" />
        <path d="M-80 1350 C 240 1190, 420 1450, 700 1270 S 960 1210, 1180 1350" />
      </g>
      <rect x="58" y="58" width="964" height="1804" fill="none" stroke="#141413" strokeWidth="3" />
      <rect x="82" y="82" width="916" height="1756" fill="none" stroke="#d1cfc6" strokeWidth="2" />

      {brandMark({ logoSrc })}
      <text x="110" y="178" fill="#57564f" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="34" fontWeight="700" letterSpacing="4">
        {stats.title}
      </text>
      <text x="110" y="234" fill="#9b9991" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="28" letterSpacing="2">
        {stats.periodLabel}
      </text>

      <line x1="110" y1="318" x2="970" y2="318" stroke="#141413" strokeWidth="3" />
      <text x="110" y="590" fill="#141413" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="245" fontWeight="800">
        {stats.primaryValue}
      </text>
      <text x="824" y="570" fill="#57564f" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="62" fontWeight="800">
        {stats.primaryUnit}
      </text>
      <text x="112" y="666" fill="#57564f" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="32" fontWeight="700">
        {stats.primaryLabel}
      </text>

      {stats.mode === "single" ? (
        <>
          <RoutePanel stats={stats} palette={palette} y={720} />
          {metricCards(stats, palette, 110, 1240)}
          {periodLine(stats, palette, 1600)}
        </>
      ) : (
        <>
          {metricCards(stats, palette)}
          {periodLine(stats, palette)}
        </>
      )}
      {signature({ y: 1718 })}
    </svg>
  );
}

function BibPoster({ stats, svgRef, logoSrc }) {
  const palette = {
    ink: "#f4ead0",
    muted: "#b8aa86",
    rule: "#76684a",
    ruleStrong: "#d2bc78",
    card: "#151515",
  };

  return (
    <svg viewBox={`0 0 ${POSTER_W} ${POSTER_H}`} width={POSTER_W} height={POSTER_H} xmlns="http://www.w3.org/2000/svg" ref={svgRef}
      role="img" aria-label={stats.title} style={{ width: "100%", height: "auto", display: "block", background: "#0e0e0d" }}>
      <rect width={POSTER_W} height={POSTER_H} fill="#0e0e0d" />
      <rect x="64" y="64" width="952" height="1792" fill="#111110" stroke="#d2bc78" strokeWidth="2" />
      <rect x="92" y="92" width="896" height="1736" fill="none" stroke="#3a3425" strokeWidth="2" />
      <rect x="124" y="124" width="832" height="1672" fill="none" stroke="#76684a" strokeWidth="1.5" strokeDasharray="2 10" opacity="0.7" />
      <g fill="none" stroke="#d2bc78" strokeWidth="1.4" opacity="0.28">
        <path d="M96 512 H984" />
        <path d="M96 1328 H984" />
        <path d="M184 92 V1828" />
        <path d="M896 92 V1828" />
      </g>
      <g fill="#d2bc78" opacity="0.78">
        <rect x="124" y="124" width="56" height="5" />
        <rect x="124" y="124" width="5" height="56" />
        <rect x="900" y="124" width="56" height="5" />
        <rect x="951" y="124" width="5" height="56" />
        <rect x="124" y="1791" width="56" height="5" />
        <rect x="124" y="1740" width="5" height="56" />
        <rect x="900" y="1791" width="56" height="5" />
        <rect x="951" y="1740" width="5" height="56" />
      </g>

      {brandMark({ logoSrc, x: 856, y: 146, size: 92 })}
      <text x="150" y="190" fill="#d2bc78" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="30" fontWeight="900" letterSpacing="7">
        CERTIFIED FIELD REPORT
      </text>
      <text x="150" y="246" fill="#b8aa86" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="28" fontWeight="700" letterSpacing="3">
        {stats.periodLabel}
      </text>

      <text x="540" y="442" textAnchor="middle" fill="#76684a" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="34" fontWeight="900" letterSpacing="10">
        {stats.primaryLabel}
      </text>
      <text x="540" y="800" textAnchor="middle" fill="#f4ead0" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="292" fontWeight="900">
        {stats.primaryValue}
      </text>
      <text x="540" y="904" textAnchor="middle" fill="#d2bc78" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="70" fontWeight="900" letterSpacing="11">
        {stats.primaryUnit}
      </text>

      {stats.mode === "single" ? (
        <>
          <RoutePanel stats={stats} palette={palette} x={150} y={950} w={780} h={330} />
          {metricCards(stats, palette, 150, 1330)}
        </>
      ) : (
        <>
          {metricCards(stats, palette, 150, 1010)}
          {periodLine(stats, palette, 1478)}
        </>
      )}
      {signature({ y: 1698, ink: "#f4ead0", urlInk: "#d2bc78", opacity: 0.78 })}
    </svg>
  );
}

function TopoPoster({ stats, svgRef, logoSrc }) {
  const palette = {
    ink: "#f7f0dc",
    muted: "#b9c0a2",
    rule: "#5d6b45",
    ruleStrong: "#dce8a8",
    card: "#253119",
  };

  return (
    <svg viewBox={`0 0 ${POSTER_W} ${POSTER_H}`} width={POSTER_W} height={POSTER_H} xmlns="http://www.w3.org/2000/svg" ref={svgRef}
      role="img" aria-label={stats.title} style={{ width: "100%", height: "auto", display: "block", background: "#172014" }}>
      <rect width={POSTER_W} height={POSTER_H} fill="#172014" />
      <g fill="none" stroke="#dce8a8" strokeWidth="1.5" opacity="0.14">
        {Array.from({ length: 18 }, (_, i) => (
          <path key={i} d={`M-120 ${250 + i * 84} C 110 ${145 + i * 48}, 290 ${360 + i * 68}, 520 ${250 + i * 58} S 840 ${90 + i * 72}, 1200 ${250 + i * 52}`} />
        ))}
      </g>
      <rect x="58" y="58" width="964" height="1804" fill="none" stroke="#dce8a8" strokeWidth="2" opacity="0.75" />
      <rect x="94" y="94" width="892" height="1732" fill="none" stroke="#5d6b45" strokeWidth="2" />

      {brandMark({ logoSrc, x: 874, y: 126, size: 96, opacity: 0.94 })}
      <text x="112" y="192" fill="#dce8a8" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="34" fontWeight="800" letterSpacing="5">
        {stats.title}
      </text>
      <text x="112" y="250" fill="#b9c0a2" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="28" fontWeight="700" letterSpacing="3">
        {stats.periodLabel}
      </text>

      <text x="112" y="620" fill="#f7f0dc" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="238" fontWeight="900">
        {stats.primaryValue}
      </text>
      <text x="824" y="602" fill="#dce8a8" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="58" fontWeight="900">
        {stats.primaryUnit}
      </text>
      <text x="116" y="700" fill="#b9c0a2" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="33" fontWeight="700">
        {stats.primaryLabel}
      </text>

      {stats.mode === "single" ? (
        <>
          <RoutePanel stats={stats} palette={palette} x={112} y={780} w={856} h={510} />
          {metricCards(stats, palette, 112, 1360)}
        </>
      ) : (
        <>
          {metricCards(stats, palette, 112, 840)}
          {periodLine(stats, palette, 1320)}
        </>
      )}
      {signature({ y: 1730, ink: "#f7f0dc", urlInk: "#dce8a8", opacity: 0.8 })}
    </svg>
  );
}

function PosterSvg({ template, stats, svgRef, logoSrc }) {
  if (template === "bib") return <BibPoster stats={stats} svgRef={svgRef} logoSrc={logoSrc} />;
  if (template === "topo") return <TopoPoster stats={stats} svgRef={svgRef} logoSrc={logoSrc} />;
  return <ClassicPoster stats={stats} svgRef={svgRef} logoSrc={logoSrc} />;
}

export function MonthlyPosterModal({ logs, races = [], onClose }) {
  const t = useT();
  const { lang } = useLanguage();
  const svgRef = useRef(null);
  const [mode, setMode] = useState("month");
  const [rangeOffset, setRangeOffset] = useState(0);
  const [prRange, setPrRange] = useState("all");
  const singleOptions = useMemo(() => (logs || [])
    .filter(l => !l.isPlanned && (Number(l.distance) > 0 || Number(l.duration) > 0))
    .slice()
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .slice(0, 80), [logs]);
  const [selectedWorkoutId, setSelectedWorkoutId] = useState("");
  const [singleGpsTrack, setSingleGpsTrack] = useState(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [template, setTemplate] = useState("classic");
  const [logoSrc, setLogoSrc] = useState(iconOnlyUrl);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const selectedWorkout = useMemo(() => (
    singleOptions.find(l => l.id === selectedWorkoutId) || singleOptions[0] || null
  ), [singleOptions, selectedWorkoutId]);
  const stats = useMemo(() => (
    mode === "single"
      ? buildSingleStats(selectedWorkout, singleGpsTrack, t)
      : mode === "pr"
      ? buildPRStats(races, prRange, t)
      : buildPeriodStats(logs || [], mode, rangeOffset, lang, t)
  ), [logs, races, selectedWorkout, singleGpsTrack, mode, rangeOffset, prRange, lang, t]);

  useEffect(() => {
    let alive = true;
    fetch(iconOnlyUrl)
      .then(res => res.blob())
      .then(blob => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      }))
      .then(dataUrl => {
        if (alive && typeof dataUrl === "string") setLogoSrc(dataUrl);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    async function loadTrack() {
      if (mode !== "single" || !selectedWorkout?.id) {
        setSingleGpsTrack(null);
        return;
      }
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
    return () => {
      alive = false;
    };
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
      if (document.fonts?.ready) await document.fonts.ready;
      const svgText = new XMLSerializer().serializeToString(svgRef.current);
      const svgBlob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
      const svgUrl = URL.createObjectURL(svgBlob);
      const img = new Image();
      const loaded = new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });
      img.src = svgUrl;
      await loaded;
      const canvas = document.createElement("canvas");
      canvas.width = POSTER_W;
      canvas.height = POSTER_H;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas unavailable");
      ctx.drawImage(img, 0, 0, POSTER_W, POSTER_H);
      URL.revokeObjectURL(svgUrl);

      const pngBlob = await new Promise((resolve, reject) => {
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("PNG export failed")), "image/png");
      });
      const pngUrl = URL.createObjectURL(pngBlob);
      const a = document.createElement("a");
      a.href = pngUrl;
      a.download = `training-studio-${stats.fileLabel}-${template}.png`;
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

  return (
    <ModalRoot onClose={onClose}>
      <div onClick={onClose} style={s.modalOverlay(true, { float: true })}>
        <div onClick={e => e.stopPropagation()}
          style={s.modalCard(true, { maxWidth: 520, bg: "var(--bg)", float: true })}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{t("poster.preview_title")}</h2>
              <div style={{ ...s.muted, marginTop: 3 }}>{stats.periodLabel}</div>
            </div>
            <button onClick={onClose} style={s.modalCloseBtn} aria-label="Close">x</button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 6, marginBottom: 8 }}>
            {POSTER_MODES.map(id => (
              <button key={id} onClick={() => switchMode(id)}
                style={{ ...s.chip(mode === id), minHeight: 34, minWidth: 0, padding: "0 6px", fontSize: 12 }}>
                {t(`poster.mode_${id}`)}
              </button>
            ))}
          </div>

          {mode === "single" && (
            <div style={{ display: "grid", gap: 6, marginBottom: 12 }}>
              <select
                value={selectedWorkout?.id || ""}
                onChange={e => {
                  setSelectedWorkoutId(e.target.value);
                  setMsg("");
                }}
                style={{
                  ...s.input,
                  minHeight: 38,
                  fontSize: 12,
                  padding: "0 10px",
                }}
              >
                {singleOptions.length ? singleOptions.map(l => (
                  <option key={l.id} value={l.id}>{workoutLabel(l)}</option>
                )) : (
                  <option value="">{t("poster.no_single_workout")}</option>
                )}
              </select>
              <div style={{ ...s.muted, fontSize: 12 }}>
                {routeLoading ? t("poster.route_loading") : stats.note}
              </div>
            </div>
          )}

          {RANGE_MODES.has(mode) && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <button onClick={() => setRangeOffset(v => v - 1)} style={{ ...s.btnGhost, minHeight: 34, padding: "0 10px" }}>
                {t("poster.prev_range")}
              </button>
              <div style={{ ...s.muted, flex: 1, textAlign: "center", fontSize: 12 }}>{stats.periodLabel}</div>
              <button onClick={() => setRangeOffset(v => Math.min(v + 1, 0))} disabled={rangeOffset >= 0}
                style={{ ...s.btnGhost, minHeight: 34, padding: "0 10px", opacity: rangeOffset >= 0 ? 0.45 : 1 }}>
                {t("poster.next_range")}
              </button>
            </div>
          )}

          {mode === "pr" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 6, marginBottom: 12 }}>
              {PR_RANGES.map(id => (
                <button key={id} onClick={() => {
                  setPrRange(id);
                  setMsg("");
                }}
                  style={{ ...s.chip(prRange === id), minHeight: 34, minWidth: 0, padding: "0 6px", fontSize: 12 }}>
                  {t(`poster.pr_range_${id}`)}
                </button>
              ))}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6, marginBottom: 12 }}>
            {TEMPLATES.map(id => {
              const active = template === id;
              return (
                <button key={id} onClick={() => setTemplate(id)}
                  style={{
                    ...s.chip(active),
                    minHeight: 36,
                    minWidth: 0,
                    padding: "0 8px",
                    fontSize: 12,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}>
                  {t(`poster.template_${id}`)}
                </button>
              );
            })}
          </div>

          <div style={{
            width: "100%",
            maxWidth: 360,
            margin: "0 auto 14px",
            border: "1px solid var(--rule)",
            background: "var(--bg-elevated)",
          }}>
            <PosterSvg template={template} svgRef={svgRef} stats={stats} logoSrc={logoSrc} />
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
