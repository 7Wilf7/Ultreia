import { useEffect, useMemo, useRef, useState } from "react";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { RACE_CATEGORIES, RUN_GROUP_TYPES, SPARTAN_SUBTYPES } from "../constants";
import { useT, useLanguage } from "../i18n/LanguageContext";
import { workouts as workoutsDb } from "../lib/db";
import { formatDurationShort, formatPaceFromSec, formatSpeedKmh, formatSwimPace } from "../utils/format";
import { s } from "../styles";
import { ModalRoot } from "./ModalRoot";
import iconOnlyUrl from "../../resources/icon-only-poster.png";

const POSTER_W = 1080;
const POSTER_H = 1350;
const TEMPLATES = ["classic", "bib"];
const POSTER_MODES = ["single", "week", "month", "year", "pr"];
const RANGE_MODES = new Set(["week", "month", "year"]);
const PR_RANGES = ["all", "this_year", "last_year", "last_12m"];
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
  const dist = Number(log.distance) > 0 ? ` - ${fmtNum(log.distance, 1)} km` : "";
  return `${dateLabel} - ${typeLabel}${dist}`;
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
    heatmap: buildActivityHeatmap(periodLogs, range),
    metrics: [
      { label: t("poster.sessions"), value: fmtNum(periodLogs.length) },
      { label: t("poster.time"), value: formatDurationShort(totalSec) },
      { label: t("poster.longest"), value: `${fmtNum(Number(longest?.distance) || 0, 1)} km` },
      { label: t("poster.ascent"), value: `+${fmtNum(totalAscent)} m` },
    ],
  };
}

function buildActivityHeatmap(logs, range) {
  const byDate = new Map();
  logs.forEach(log => {
    const key = log.date;
    if (!key) return;
    byDate.set(key, (byDate.get(key) || 0) + (Number(log.distance) || 0));
  });

  const days = [];
  for (const d = new Date(range.start); d < range.end; d.setDate(d.getDate() + 1)) {
    const key = dateKey(d);
    days.push({
      key,
      day: d.getDate(),
      dow: (d.getDay() + 6) % 7,
      km: byDate.get(key) || 0,
    });
  }

  const maxKm = Math.max(...days.map(day => day.km), 0);
  return {
    days,
    maxKm,
    startDow: days[0]?.dow || 0,
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

function signature({ y = 1188, ink = "#141413", urlInk = ink, opacity = 0.72 }) {
  return (
    <g>
      <text
        x="540"
        y={y}
        textAnchor="middle"
        fill={ink}
        opacity={opacity}
        fontFamily="Brush Script MT, Segoe Script, Georgia, serif"
        fontSize="54"
        fontStyle="italic"
      >
        Training Studio
      </text>
      <text x="540" y={y + 38} textAnchor="middle" fill={urlInk} opacity="0.62" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="18" fontWeight="700" letterSpacing="2">
        www.aitrainstudio.com
      </text>
    </g>
  );
}

function heatOpacity(km, maxKm, min = 0.12) {
  if (!(km > 0) || !(maxKm > 0)) return min;
  return min + Math.sqrt(km / maxKm) * (1 - min);
}

function heatColor(km, maxKm, colors) {
  if (!(km > 0)) return colors.empty;
  const ratio = maxKm > 0 ? km / maxKm : 0;
  if (ratio > 0.74) return colors.hot;
  if (ratio > 0.42) return colors.mid;
  return colors.low;
}

function calendarCells(heatmap) {
  if (!heatmap?.days?.length) return [];
  return heatmap.days.map((day, i) => {
    const slot = heatmap.startDow + i;
    return {
      ...day,
      col: Math.floor(slot / 7),
      row: slot % 7,
    };
  });
}

function HeatmapField({ heatmap, x, y, cell = 42, gap = 12, maxWidth = 860, colors, opacity = 1, showLabels = false }) {
  const cells = calendarCells(heatmap);
  if (cells.length === 0) return null;
  const cols = Math.max(...cells.map(day => day.col), 0) + 1;
  const width = cols * cell + (cols - 1) * gap;
  const height = 7 * cell + 6 * gap;
  const scale = Math.min(1, maxWidth / width);

  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} opacity={opacity}>
      {showLabels && ["M", "T", "W", "T", "F", "S", "S"].map((label, i) => (
        <text key={`${label}-${i}`} x="-24" y={i * (cell + gap) + cell * 0.66} textAnchor="end" fill={colors.label} fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="15" fontWeight="800">
          {label}
        </text>
      ))}
      <rect x="-18" y="-18" width={width + 36} height={height + 36} fill={colors.backdrop} opacity={colors.backdropOpacity || 0} />
      {cells.map(day => {
        const px = day.col * (cell + gap);
        const py = day.row * (cell + gap);
        return (
          <g key={day.key}>
            <rect
              x={px}
              y={py}
              width={cell}
              height={cell}
              rx="6"
              fill={heatColor(day.km, heatmap.maxKm, colors)}
              opacity={heatOpacity(day.km, heatmap.maxKm, colors.emptyOpacity || 0.16)}
            />
            {day.km > 0 && cell >= 32 && (
              <text x={px + cell / 2} y={py + cell * 0.62} textAnchor="middle" fill={colors.text} opacity="0.74" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize={cell > 40 ? 13 : 10} fontWeight="900">
                {day.day}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

function DataMist({ color = "#111", opacity = 0.08 }) {
  return (
    <g opacity={opacity}>
      {Array.from({ length: 18 }, (_, i) => (
        <path
          key={i}
          d={`M${-80 + i * 8} ${260 + i * 54} C ${160 + i * 13} ${162 + i * 38}, ${340 - i * 5} ${392 + i * 16}, ${570 + i * 4} ${288 + i * 39} S ${842 + i * 9} ${118 + i * 50}, ${1210} ${286 + i * 47}`}
          fill="none"
          stroke={color}
          strokeWidth="1.1"
        />
      ))}
    </g>
  );
}

function AlpinePosterScene({ tint = "#e9452d", glow = "#c9ff64" }) {
  return (
    <g>
      <path d="M-40 1046 L142 842 L262 934 L418 696 L570 862 L692 654 L902 948 L1130 726 L1130 1350 L-40 1350 Z" fill={tint} opacity="0.2" />
      <path d="M-40 1132 L128 940 L248 1004 L408 784 L560 916 L704 744 L898 1038 L1130 822 L1130 1350 L-40 1350 Z" fill={glow} opacity="0.12" />
      <path d="M-40 1046 L142 842 L262 934 L418 696 L570 862 L692 654 L902 948 L1130 726" fill="none" stroke={tint} strokeWidth="7" opacity="0.78" />
      <path d="M-40 1132 L128 940 L248 1004 L408 784 L560 916 L704 744 L898 1038 L1130 822" fill="none" stroke={glow} strokeWidth="3" opacity="0.58" />
    </g>
  );
}

function metricCards(stats, palette, x = 110, y = 790, cardW = 388, cardH = 122, colGap = 430, rowGap = 152) {
  const compact = cardH < 100;
  const labelY = compact ? 30 : 40;
  const valueY = compact ? 70 : 94;
  const labelSize = compact ? 17 : 21;
  const valueSize = compact ? 31 : 42;
  return (
    <g transform={`translate(${x} ${y})`}>
      {stats.metrics.map((item, i) => (
        <g key={`${item.label}-${i}`} transform={`translate(${(i % 2) * colGap} ${Math.floor(i / 2) * rowGap})`}>
          <rect x="0" y="0" width={cardW} height={cardH} fill={palette.card} stroke={palette.rule} strokeWidth="1.4" />
          <text x="26" y={labelY} fill={palette.muted} fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize={labelSize} fontWeight="700" letterSpacing="2">
            {item.label}
          </text>
          <text x="26" y={valueY} fill={palette.ink} fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize={valueSize} fontWeight="800">
            {item.value}
          </text>
        </g>
      ))}
    </g>
  );
}

function periodLine(stats, palette, y = 1120) {
  return (
    <g>
      <rect x="110" y={y - 58} width="860" height="1.5" fill={palette.ruleStrong} opacity="0.78" />
      {stats.activeDays == null ? (
        <text x="110" y={y} fill={palette.ink} fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="30" fontWeight="800">
          {stats.periodLabel}
        </text>
      ) : (
        <text x="110" y={y} fill={palette.ink} fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="30" fontWeight="800">
          {stats.activeDaysLabel} {fmtNum(stats.activeDays)}
        </text>
      )}
    </g>
  );
}

function RoutePanel({ stats, palette, x = 110, y = 620, w = 860, h = 310 }) {
  const path = gpsPath(stats.gpsTrack, x, y, w, h);
  const hasRoute = Boolean(path);
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill={palette.card} stroke={palette.rule} strokeWidth="1.4" />
      <g fill="none" stroke={palette.ruleStrong} strokeWidth="1" opacity="0.13">
        {Array.from({ length: 6 }, (_, i) => (
          <path key={i} d={`M${x + 28} ${y + 58 + i * 38} C ${x + 220} ${y + 12 + i * 28}, ${x + 410} ${y + 98 + i * 20}, ${x + 620} ${y + 56 + i * 34} S ${x + 780} ${y + 16 + i * 30}, ${x + w - 28} ${y + 72 + i * 26}`} />
        ))}
      </g>
      <text x={x + 30} y={y + 46} fill={palette.muted} fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="21" fontWeight="800" letterSpacing="3">
        {stats.routeLabel}
      </text>
      {hasRoute ? (
        <>
          <path d={path} fill="none" stroke={palette.ruleStrong} strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" opacity="0.12" />
          <path d={path} fill="none" stroke={palette.ink} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <text x={x + w / 2} y={y + h / 2 + 16} textAnchor="middle" fill={palette.muted} fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="28" fontWeight="700">
          {stats.note}
        </text>
      )}
    </g>
  );
}

function ClassicPoster({ stats, svgRef, logoSrc }) {
  const palette = {
    ink: "#10120e",
    muted: "#606756",
    rule: "#cfd8bd",
    ruleStrong: "#264125",
    card: "#eff4df",
  };
  const heatColors = {
    empty: "#dfe7ce",
    low: "#9bb16c",
    mid: "#496c3b",
    hot: "#102f1a",
    text: "#f7f4e8",
    label: "#6d735f",
    backdrop: "#f4f6e9",
    backdropOpacity: 0.72,
    emptyOpacity: 0.48,
  };

  return (
    <svg viewBox={`0 0 ${POSTER_W} ${POSTER_H}`} width={POSTER_W} height={POSTER_H} xmlns="http://www.w3.org/2000/svg" ref={svgRef}
      role="img" aria-label={stats.title} style={{ width: "100%", height: "auto", display: "block", background: "#e9efdc" }}>
      <defs>
        <radialGradient id="classic-heat-glow" cx="22%" cy="18%" r="82%">
          <stop offset="0%" stopColor="#f9f6d8" />
          <stop offset="44%" stopColor="#e8f0d8" />
          <stop offset="100%" stopColor="#cbd9b6" />
        </radialGradient>
        <linearGradient id="classic-panel" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#f8f7ea" />
          <stop offset="100%" stopColor="#dfe9cf" />
        </linearGradient>
      </defs>
      <rect width={POSTER_W} height={POSTER_H} fill="url(#classic-heat-glow)" />
      <DataMist color="#243721" opacity="0.075" />
      <HeatmapField heatmap={stats.heatmap} x={114} y={642} cell={52} gap={14} colors={heatColors} opacity={0.98} showLabels />
      <rect x="56" y="52" width="968" height="1246" fill="none" stroke="#314528" strokeWidth="1.4" opacity="0.54" />
      <rect x="90" y="86" width="900" height="1178" fill="none" stroke="#f9f7e8" strokeWidth="1" opacity="0.66" />
      <path d="M90 330 H990" stroke="#314528" strokeWidth="2.4" opacity="0.72" />
      <path d="M90 1076 H990" stroke="#314528" strokeWidth="1.3" opacity="0.34" />

      <rect x="84" y="84" width="360" height="214" fill="url(#classic-panel)" stroke="#f7f4e5" strokeWidth="1.2" opacity="0.94" />
      <text x="114" y="144" fill="#334128" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="24" fontWeight="900" letterSpacing="3">
        {stats.title}
      </text>
      <text x="114" y="194" fill="#6a725c" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="26" fontWeight="700" letterSpacing="1.5">
        {stats.periodLabel}
      </text>
      <text x="114" y="250" fill="#334128" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="19" fontWeight="800" letterSpacing="2">
        ACTIVITY HEAT FIELD
      </text>

      {brandMark({ logoSrc, x: 842, y: 108, size: 140 })}
      <text x="114" y="522" fill="#10120e" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="212" fontWeight="900">
        {stats.primaryValue}
      </text>
      <text x="790" y="494" fill="#264125" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="58" fontWeight="900">
        {stats.primaryUnit}
      </text>
      <text x="118" y="586" fill="#4f5d43" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="29" fontWeight="900">
        {stats.primaryLabel}
      </text>

      {stats.mode === "single" ? (
        <>
          <RoutePanel stats={stats} palette={palette} y={668} h={250} />
          {metricCards(stats, palette, 110, 956, 388, 106, 430, 128)}
          {periodLine(stats, palette, 1210)}
        </>
      ) : (
        <>
          <rect x="96" y="934" width="888" height="156" fill="#f4f6e9" opacity="0.9" />
          {metricCards(stats, palette, 110, 948, 388, 62, 430, 78)}
          {periodLine(stats, palette, 1136)}
        </>
      )}
      {signature({ y: 1194, ink: "#1f2e1d", urlInk: "#526045", opacity: 0.72 })}
    </svg>
  );
}

function BibPoster({ stats, svgRef, logoSrc }) {
  const palette = {
    ink: "#f6f0df",
    muted: "#b5aa8f",
    rule: "#362b21",
    ruleStrong: "#ff4f2e",
    card: "#18130f",
  };
  const heatColors = {
    empty: "#272018",
    low: "#704632",
    mid: "#ba4a2d",
    hot: "#ff5b30",
    text: "#1a100c",
    label: "#9f947c",
    backdrop: "#120f0c",
    backdropOpacity: 0,
    emptyOpacity: 0.42,
  };

  return (
    <svg viewBox={`0 0 ${POSTER_W} ${POSTER_H}`} width={POSTER_W} height={POSTER_H} xmlns="http://www.w3.org/2000/svg" ref={svgRef}
      role="img" aria-label={stats.title} style={{ width: "100%", height: "auto", display: "block", background: "#120f0c" }}>
      <defs>
        <radialGradient id="bib-flare" cx="70%" cy="28%" r="78%">
          <stop offset="0%" stopColor="#4a1c14" />
          <stop offset="44%" stopColor="#17110d" />
          <stop offset="100%" stopColor="#090807" />
        </radialGradient>
        <linearGradient id="bib-sash" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#ff4f2e" />
          <stop offset="100%" stopColor="#d9ff5d" />
        </linearGradient>
      </defs>
      <rect width={POSTER_W} height={POSTER_H} fill="url(#bib-flare)" />
      <AlpinePosterScene tint="#ff4f2e" glow="#d9ff5d" />
      <DataMist color="#f4d88e" opacity="0.08" />
      <HeatmapField heatmap={stats.heatmap} x={606} y={382} cell={44} gap={10} colors={heatColors} opacity={0.78} />
      <rect x="48" y="48" width="984" height="1254" fill="none" stroke="#e9d8a8" strokeWidth="1.2" opacity="0.4" />
      <rect x="88" y="88" width="904" height="1174" fill="none" stroke="#ff4f2e" strokeWidth="1.1" opacity="0.5" />
      <path d="M88 318 H992" stroke="url(#bib-sash)" strokeWidth="7" opacity="0.9" />
      <path d="M88 1014 H992" stroke="#f6f0df" strokeWidth="1.2" opacity="0.22" />

      {brandMark({ logoSrc, x: 828, y: 106, size: 150, opacity: 0.96 })}
      <text x="118" y="164" fill="#d9ff5d" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="24" fontWeight="900" letterSpacing="7">
        TRAINING DOSSIER
      </text>
      <text x="118" y="214" fill="#c1b69a" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="28" fontWeight="700" letterSpacing="2">
        {stats.periodLabel}
      </text>

      <text x="118" y="424" fill="#ff4f2e" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="32" fontWeight="900" letterSpacing="8">
        {stats.primaryLabel}
      </text>
      <text x="112" y="690" fill="#f6f0df" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="244" fontWeight="900">
        {stats.primaryValue}
      </text>
      <text x="770" y="650" fill="#d9ff5d" fontFamily="Outfit, Microsoft YaHei, sans-serif" fontSize="54" fontWeight="900" letterSpacing="9">
        {stats.primaryUnit}
      </text>

      {stats.mode === "single" ? (
        <>
          <RoutePanel stats={stats} palette={palette} x={118} y={822} w={844} h={222} />
          {metricCards(stats, palette, 118, 1084, 382, 106, 462, 128)}
        </>
      ) : (
        <>
          {metricCards(stats, palette, 118, 846, 382, 112, 462, 136)}
        </>
      )}
      {signature({ y: 1192, ink: "#f6f0df", urlInk: "#d9ff5d", opacity: 0.74 })}
    </svg>
  );
}

function PosterSvg({ template, stats, svgRef, logoSrc }) {
  if (template === "bib") return <BibPoster stats={stats} svgRef={svgRef} logoSrc={logoSrc} />;
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
      const fileName = `training-studio-${stats.fileLabel}-${template}.png`;
      if (isNativeApp()) {
        const dataUrl = canvas.toDataURL("image/png");
        await PosterSaver.savePng({ fileName, data: dataUrl });
        setMsg(t("poster.downloaded"));
        return;
      }
      const file = new File([pngBlob], fileName, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] }) && navigator.share) {
        await navigator.share({ files: [file], title: "Training Studio" });
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

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6, marginBottom: 12 }}>
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
