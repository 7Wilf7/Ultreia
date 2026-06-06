import { useState, useMemo, useEffect } from "react";
import { Dropdown } from "./Dropdown";
import { s } from "../styles";
import { RUN_SUBTYPES, RUN_GROUP_TYPES } from "../constants";
import { useT } from "../i18n/LanguageContext";
import { useIsMobile } from "../hooks/useMediaQuery";
import { formatDuration } from "../utils/format";
import { getPeriodLabel } from "../utils/period";
import { MonthlyPosterModal } from "./MonthlyPosterModal";

// Compact week-bucket label like "5-18~24" (same month) or "5-30~6-5" (cross-month).
// Uses LOCAL date components — going through toISOString() would shift the date
// by the timezone offset (e.g. May 18 GMT+8 → May 17 UTC), causing off-by-one days
// for any user east of UTC.
function weekRangeLabel(start, endExclusive) {
  const endDisplay = new Date(endExclusive);
  endDisplay.setDate(endDisplay.getDate() - 1);
  const sm = start.getMonth() + 1, sd = start.getDate();
  const em = endDisplay.getMonth() + 1, ed = endDisplay.getDate();
  if (sm === em) return `${sm}-${sd}~${ed}`;
  return `${sm}-${sd}~${em}-${ed}`;
}

// Decide which charts to render based on the current Global Filter. Each
// activity type cares about different metrics, so we tailor:
//   - what the trend chart measures (distance / ascent / duration)
//   - whether to show Run Type breakdown (Road Run only)
//   - whether to show HR zones (most types; skipped for Hiking)
// "all" and any multi-group selection falls back to the original layout
// (distance + run type + HR).
function getChartConfig(filter) {
  const def = { trend: "distance", showRunType: true };
  if (!filter || filter.all) return def;
  const g = filter.groups;
  if (g.run.enabled && !g.strength.enabled && !g.hiit.enabled) {
    if (g.run.subs.length !== 1) return def;
    const sub = g.run.subs[0];
    if (sub === "Road Run")      return { trend: "distance", showRunType: true };
    if (sub === "Trail Run")     return { trend: "distance", showAscent: true  };
    if (sub === "Hiking")        return { trend: "distance", showAscent: true  };
    if (sub === "Floor Climbing")return { trend: "ascent" };
    return def;
  }
  if ((g.strength.enabled || g.hiit.enabled) && !g.run.enabled) {
    return { trend: "duration" };
  }
  return def;
}

export function ChartsTab({ filteredAllLogs, filter, races }) {
  const t = useT();
  const isMobile = useIsMobile();
  const [showMonthlyPoster, setShowMonthlyPoster] = useState(false);
  const [selectedTrendIndex, setSelectedTrendIndex] = useState(null);
  // Persisted to localStorage so the chosen period survives tab switches (and
  // reloads) instead of snapping back to the 4-week default every time.
  const [chartPeriod, setChartPeriod] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("ts-chart-period"));
      if (saved && saved.type && saved.count) return saved;
    } catch { /* ignore bad/missing value */ }
    return { type: "week", count: 4 };
  });
  useEffect(() => {
    try { localStorage.setItem("ts-chart-period", JSON.stringify(chartPeriod)); } catch { /* ignore */ }
  }, [chartPeriod]);

  const config = useMemo(() => getChartConfig(filter), [filter]);

  // Generic bucketer: for each period bucket, sum a metric across the logs
  // that fall inside. The picker callback returns the per-log number to add
  // (distance / ascent / duration / 0 if not eligible).
  const chartData = useMemo(() => {
    const nowD = new Date();
    const buckets = [];

    // Strength sessions covering multiple body parts get their duration
    // attributed proportionally to the filter's body-part scope. A 30-min
    // "Upper + Lower" log counts as 30 min under "all strength", 15 min
    // under "Upper Body only", and 30 min again under "Upper + Lower".
    const strengthSubsFilter = filter?.groups?.strength?.subs || [];

    const pickValue = (l) => {
      if (config.trend === "distance") {
        return RUN_GROUP_TYPES.includes(l.type) ? (l.distance || 0) : 0;
      }
      if (config.trend === "ascent") {
        return (l.ascent || 0);
      }
      if (config.trend === "duration") {
        let minutes = l.duration ? l.duration / 60 : 0;
        if (l.type === "Strength" && Array.isArray(l.subTypes) && l.subTypes.length > 1) {
          const matched = strengthSubsFilter.length > 0
            ? l.subTypes.filter(st => strengthSubsFilter.includes(st)).length
            : l.subTypes.length;
          minutes = minutes * (matched / l.subTypes.length);
        }
        return minutes;
      }
      return 0;
    };

    const finishBucket = (rangeLabel, label, sum) => {
      let val;
      if (config.trend === "distance")      val = +sum.toFixed(1);
      else if (config.trend === "ascent")   val = Math.round(sum);
      else /* duration */                   val = Math.round(sum);
      return { label, rangeText: rangeLabel, value: val };
    };

    if (chartPeriod.type === "day") {
      for (let i = chartPeriod.count - 1; i >= 0; i--) {
        const start = new Date(nowD);
        start.setDate(nowD.getDate() - i);
        start.setHours(0, 0, 0, 0);
        const end = new Date(start); end.setDate(start.getDate() + 1);
        const sum = filteredAllLogs.filter(l => {
          const d = new Date(l.date);
          return d >= start && d < end;
        }).reduce((acc, l) => acc + pickValue(l), 0);
        const lbl = `${start.getMonth() + 1}-${start.getDate()}`;
        buckets.push(finishBucket(lbl, lbl, sum));
      }
    } else if (chartPeriod.type === "week") {
      for (let i = chartPeriod.count - 1; i >= 0; i--) {
        const dayOfWeek = (nowD.getDay() + 6) % 7;
        const start = new Date(nowD);
        start.setDate(nowD.getDate() - dayOfWeek - i * 7);
        start.setHours(0, 0, 0, 0);
        const end = new Date(start); end.setDate(start.getDate() + 7);
        const sum = filteredAllLogs.filter(l => {
          const d = new Date(l.date);
          return d >= start && d < end;
        }).reduce((acc, l) => acc + pickValue(l), 0);
        const rangeLabel = weekRangeLabel(start, end);
        buckets.push(finishBucket(rangeLabel, rangeLabel, sum));
      }
    } else if (chartPeriod.type === "month") {
      for (let i = chartPeriod.count - 1; i >= 0; i--) {
        const start = new Date(nowD.getFullYear(), nowD.getMonth() - i, 1);
        const end = new Date(nowD.getFullYear(), nowD.getMonth() - i + 1, 1);
        const sum = filteredAllLogs.filter(l => {
          const d = new Date(l.date);
          return d >= start && d < end;
        }).reduce((acc, l) => acc + pickValue(l), 0);
        buckets.push(finishBucket(
          getPeriodLabel({ type: "month", year: start.getFullYear(), month: start.getMonth() }, t),
          `${start.getFullYear()}-${start.getMonth() + 1}`,
          sum,
        ));
      }
    } else if (chartPeriod.type === "year") {
      for (let i = chartPeriod.count - 1; i >= 0; i--) {
        const yy = nowD.getFullYear() - i;
        const start = new Date(yy, 0, 1);
        const end = new Date(yy + 1, 0, 1);
        const sum = filteredAllLogs.filter(l => {
          const d = new Date(l.date);
          return d >= start && d < end;
        }).reduce((acc, l) => acc + pickValue(l), 0);
        buckets.push(finishBucket(String(yy), String(yy), sum));
      }
    }
    return buckets;
  }, [filteredAllLogs, chartPeriod, config.trend, filter?.groups?.strength?.subs, t]);

  const chartRangeLogs = useMemo(() => {
    const nowD = new Date();
    let from;
    if (chartPeriod.type === "day") {
      from = new Date(nowD);
      from.setDate(nowD.getDate() - (chartPeriod.count - 1));
      from.setHours(0, 0, 0, 0);
    } else if (chartPeriod.type === "week") {
      const dayOfWeek = (nowD.getDay() + 6) % 7;
      from = new Date(nowD);
      from.setDate(nowD.getDate() - dayOfWeek - (chartPeriod.count - 1) * 7);
      from.setHours(0, 0, 0, 0);
    } else if (chartPeriod.type === "month") {
      from = new Date(nowD.getFullYear(), nowD.getMonth() - (chartPeriod.count - 1), 1);
    } else if (chartPeriod.type === "year") {
      from = new Date(nowD.getFullYear() - (chartPeriod.count - 1), 0, 1);
    } else {
      from = new Date(2000, 0, 1);
    }
    return filteredAllLogs.filter(l => new Date(l.date) >= from);
  }, [filteredAllLogs, chartPeriod]);

  // Run-type distribution by DURATION (seconds), not session count. A 90-min
  // tempo run weighs more than three 20-min easy runs, which better reflects
  // training load allocation than raw frequency.
  const runTypeDist = useMemo(() => {
    const durations = {};
    RUN_SUBTYPES.forEach(sub => durations[sub] = 0);
    chartRangeLogs.filter(l => l.type === "Road Run" && l.subTypes.length > 0).forEach(l => {
      durations[l.subTypes[0]] = (durations[l.subTypes[0]] || 0) + (l.duration || 0);
    });
    return Object.entries(durations);
  }, [chartRangeLogs]);

  // HR-zone time distribution — sums each run's per-zone seconds (FIT imports
  // only; CSV/manual rows have no per-zone data). Shown only when the period
  // actually has zone data, so it appears once the user imports FIT files.
  const hrZoneDist = useMemo(() => {
    const z = [0, 0, 0, 0, 0];
    for (const l of chartRangeLogs) {
      if (Array.isArray(l.hrZoneSeconds) && l.hrZoneSeconds.length >= 5) {
        for (let i = 0; i < 5; i++) z[i] += Number(l.hrZoneSeconds[i]) || 0;
      }
    }
    return { z, total: z.reduce((a, b) => a + b, 0) };
  }, [chartRangeLogs]);

  // Optional secondary trend — ascent buckets, mirrors `chartData` shape but
  // sums `ascent` per period. Only computed (and rendered) when config.showAscent.
  const ascentData = useMemo(() => {
    if (!config.showAscent) return null;
    const nowD = new Date();
    const buckets = [];
    const sumIn = (from, to) =>
      filteredAllLogs.filter(l => {
        const d = new Date(l.date);
        return d >= from && d < to;
      }).reduce((acc, l) => acc + (l.ascent || 0), 0);

    if (chartPeriod.type === "day") {
      for (let i = chartPeriod.count - 1; i >= 0; i--) {
        const start = new Date(nowD);
        start.setDate(nowD.getDate() - i);
        start.setHours(0, 0, 0, 0);
        const end = new Date(start); end.setDate(start.getDate() + 1);
        const lbl = `${start.getMonth() + 1}-${start.getDate()}`;
        buckets.push({ label: lbl, rangeText: lbl, value: Math.round(sumIn(start, end)) });
      }
    } else if (chartPeriod.type === "week") {
      for (let i = chartPeriod.count - 1; i >= 0; i--) {
        const dayOfWeek = (nowD.getDay() + 6) % 7;
        const start = new Date(nowD);
        start.setDate(nowD.getDate() - dayOfWeek - i * 7);
        start.setHours(0, 0, 0, 0);
        const end = new Date(start); end.setDate(start.getDate() + 7);
        const rangeLabel = weekRangeLabel(start, end);
        buckets.push({ label: rangeLabel, rangeText: rangeLabel, value: Math.round(sumIn(start, end)) });
      }
    } else if (chartPeriod.type === "month") {
      for (let i = chartPeriod.count - 1; i >= 0; i--) {
        const start = new Date(nowD.getFullYear(), nowD.getMonth() - i, 1);
        const end = new Date(nowD.getFullYear(), nowD.getMonth() - i + 1, 1);
        buckets.push({
          label: `${start.getFullYear()}-${start.getMonth() + 1}`,
          rangeText: getPeriodLabel({ type: "month", year: start.getFullYear(), month: start.getMonth() }, t),
          value: Math.round(sumIn(start, end)),
        });
      }
    } else if (chartPeriod.type === "year") {
      for (let i = chartPeriod.count - 1; i >= 0; i--) {
        const yy = nowD.getFullYear() - i;
        const start = new Date(yy, 0, 1);
        const end = new Date(yy + 1, 0, 1);
        buckets.push({ label: String(yy), rangeText: String(yy), value: Math.round(sumIn(start, end)) });
      }
    }
    return buckets;
  }, [filteredAllLogs, chartPeriod, config.showAscent, t]);

  function chartPeriodLabel() {
    if (chartPeriod.type === "day")   return t("charts.last_days",   { n: chartPeriod.count });
    if (chartPeriod.type === "week")  return t("charts.last_weeks",  { n: chartPeriod.count });
    if (chartPeriod.type === "month") return t("charts.last_months", { n: chartPeriod.count });
    if (chartPeriod.type === "year")  return t("charts.last_years",  { n: chartPeriod.count });
    return "";
  }

  // Trend chart axis label + section title depend on which metric is active.
  const trendMeta = (() => {
    if (config.trend === "distance") return { title: t("charts.distance_trend"), axis: t("charts.km_axis") };
    if (config.trend === "ascent")   return { title: t("charts.ascent_trend"),   axis: t("charts.m_axis")  };
    if (config.trend === "duration") return { title: t("charts.duration_trend"), axis: t("charts.min_axis") };
    return { title: "", axis: "" };
  })();

  const chartMax = Math.max(...chartData.map(w => w.value), 1);
  const ascentMax = ascentData ? Math.max(...ascentData.map(w => w.value), 1) : 1;
  // totalRunsForPie now holds total DURATION in seconds (not session count).
  const totalRunsForPie = runTypeDist.reduce((sum, [, c]) => sum + c, 0);

  const presets = [
    { type: "day",   count: 7,  label: t("charts.this_week") },
    { type: "week",  count: 4,  label: t("charts.weeks",  { n: 4 }) },
    { type: "week",  count: 8,  label: t("charts.weeks",  { n: 8 }) },
    { type: "month", count: 6,  label: t("charts.months", { n: 6 }) },
    { type: "month", count: 12, label: t("charts.months", { n: 12 }) },
    { type: "year",  count: 5,  label: t("charts.years",  { n: 5 }) },
  ];

  // Shared SVG trend renderer — used for the primary trend chart (distance /
  // ascent / duration) and for the optional ascent secondary chart on Trail
  // and Hiking. `data` is the bucket list shaped as { label, rangeText, value },
  // `axisLabel` is the unit shown in the top-left corner.
  function renderTrendSvg(data, max, axisLabel, selectedIndex, setSelectedIndex) {
    const width = isMobile ? 360 : 700;
    const height = isMobile ? 220 : 250;
    const plotLeft = isMobile ? 34 : 52;
    const plotRight = isMobile ? 332 : 654;
    const plotBottom = isMobile ? 174 : 206;
    const plotHeight = isMobile ? 118 : 152;
    const ticks = isMobile ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1];
    return (
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto", display: "block", fontFamily: "var(--font-mono)", touchAction: "manipulation" }}>
        {ticks.map((p, i) => {
          const y = plotBottom - p * plotHeight;
          const val = (max * p).toFixed(0);
          return (
            <g key={i}>
              <line x1={plotLeft - 6} y1={y} x2={plotRight + 4} y2={y} stroke="var(--rule-soft)" strokeWidth="0.5" strokeDasharray={p === 0 ? "none" : "2 4"} />
              <text x={plotLeft - 10} y={y + 4} fontSize={isMobile ? 9 : 14} fill="var(--ink-3)" textAnchor="end" letterSpacing="0.02em">{val}</text>
            </g>
          );
        })}
        <text x={isMobile ? 12 : 22} y={isMobile ? 15 : 18} fontSize={isMobile ? 9 : 13} fill="var(--ink-3)" textTransform="uppercase" letterSpacing="0.08em">{axisLabel}</text>
        {(() => {
          const xStep = data.length > 1 ? (plotRight - plotLeft) / (data.length - 1) : 0;
          const points = data.map((w, i) => ({
            x: plotLeft + i * xStep,
            y: plotBottom - (w.value / max) * plotHeight,
            w,
          }));
          if (points.length === 0) return null;
          const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
          return (
            <>
              <path d={`${path} L ${points[points.length - 1].x} ${plotBottom} L ${points[0].x} ${plotBottom} Z`} fill="var(--moss)" opacity="0.08" />
              <path d={path} fill="none" stroke="var(--moss-deep)" strokeWidth={isMobile ? 2 : 1.5} />
              {points.map((p, i) => (
                <g key={i} onClick={() => setSelectedIndex?.(i)} style={{ cursor: "pointer" }}>
                  <rect x={p.x - (isMobile ? 5 : 3)} y={p.y - (isMobile ? 5 : 3)} width={isMobile ? 10 : 6} height={isMobile ? 10 : 6} fill={selectedIndex === i ? "var(--warn)" : "var(--ink-1)"}>
                    <title>{p.w.rangeText}: {p.w.value} {axisLabel}</title>
                  </rect>
                  {p.w.value > 0 && (!isMobile || data.length <= 6 || i === selectedIndex) && (
                    <text x={p.x} y={p.y - 12} fontSize={isMobile ? 10 : 15} fill="var(--ink-1)" textAnchor="middle" letterSpacing="0.02em" fontWeight="500">{p.w.value}</text>
                  )}
                  <text x={p.x} y={isMobile ? 194 : 218} fontSize={isMobile ? 9 : 13} fill="var(--ink-3)" textAnchor="middle" letterSpacing="0.02em">
                    {isMobile && data.length > 6 ? (i % 2 === 0 ? p.w.label : "") : p.w.label}
                  </text>
                </g>
              ))}
            </>
          );
        })()}
      </svg>
    );
  }

  return (
    <div>
      {/* Period selector. Mobile: single native dropdown (less vertical space).
          Desktop: chips for direct toggling. */}
      {isMobile ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <span style={{ ...s.muted, fontSize: 11, flexShrink: 0 }}>{t("charts.show")}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Dropdown
              ariaLabel={t("charts.show")}
              options={presets.map(opt => ({ value: `${opt.type}-${opt.count}`, label: opt.label }))}
              value={`${chartPeriod.type}-${chartPeriod.count}`}
              onChange={(v) => {
                const [type, count] = v.split("-");
                setChartPeriod({ type, count: parseInt(count, 10) });
              }}
            />
          </div>
          <button onClick={() => setShowMonthlyPoster(true)}
            style={{ ...s.btnGhost, padding: "0 10px", minHeight: 36, fontSize: 12, flexShrink: 0 }}>
            {t("poster.share_short")}
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ ...s.muted }}>{t("charts.show")}</span>
          {presets.map(opt => {
            const active = chartPeriod.type === opt.type && chartPeriod.count === opt.count;
            return (
              <button key={`${opt.type}-${opt.count}`} onClick={() => setChartPeriod({ type: opt.type, count: opt.count })}
                style={s.chip(active)}>{opt.label}</button>
            );
          })}
          <button onClick={() => setShowMonthlyPoster(true)}
            style={{ ...s.btnGhost, marginLeft: "auto", padding: "7px 12px", fontSize: 12 }}>
            {t("poster.share_monthly")}
          </button>
        </div>
      )}

      {showMonthlyPoster && (
        <MonthlyPosterModal logs={filteredAllLogs} races={races} onClose={() => setShowMonthlyPoster(false)} />
      )}

      {/* Primary trend chart — metric varies by filter (distance / ascent / duration) */}
      <div style={s.section}>
        {trendMeta.title}
        {chartPeriod.type === "week" && (
          <span style={{ ...s.muted, fontWeight: 400, marginLeft: 8 }}>{t("charts.week_note")}</span>
        )}
      </div>
      <div style={{ ...s.card, marginBottom: 22, padding: isMobile ? "10px 6px 12px" : undefined }}>
        {renderTrendSvg(chartData, chartMax, trendMeta.axis, selectedTrendIndex, setSelectedTrendIndex)}
        {isMobile && chartData.length > 0 && (() => {
          const idx = selectedTrendIndex ?? chartData.length - 1;
          const item = chartData[idx] || chartData[chartData.length - 1];
          return (
            <div style={{
              marginTop: 8,
              display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10,
              borderTop: "1px solid var(--rule-soft)", paddingTop: 9,
              fontFamily: "var(--font-sans)", fontSize: 12, color: "var(--ink-2)",
            }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.rangeText}</span>
              <span style={{ ...s.dataNum, color: "var(--ink-1)", fontSize: 15 }}>{item.value} {trendMeta.axis}</span>
            </div>
          );
        })()}
      </div>

      {/* Secondary ascent trend — only on Trail Run / Hiking filters */}
      {config.showAscent && ascentData && (
        <>
          <div style={s.section}>{t("charts.ascent_trend")}</div>
          <div style={{ ...s.card, marginBottom: 22, padding: isMobile ? "10px 6px 12px" : undefined }}>
            {renderTrendSvg(ascentData, ascentMax, t("charts.m_axis"))}
          </div>
        </>
      )}

      {/* Run type distribution — Road Run / "all runs" / "all" only */}
      {config.showRunType && (
        <>
          <div style={s.section}>{t("charts.run_type_title", { label: chartPeriodLabel() })}</div>
          <div style={s.card}>
            {totalRunsForPie === 0 ? (
              <div style={{ color: "var(--ink-3)", textAlign: "center", padding: 20, fontSize: 13 }}>{t("charts.no_classified")}</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {runTypeDist.map(([name, durSec], i) => {
                  const pct = totalRunsForPie ? (durSec / totalRunsForPie) * 100 : 0;
                  // Bar shade ramp from ink → moss tints, intensity-keyed
                  const shade = ["var(--ink-1)", "var(--ink-2)", "var(--moss-deep)", "var(--moss)", "var(--moss-light)"][i] || "var(--ink-2)";
                  return (
                    <div key={name}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 5, alignItems: "baseline" }}>
                        <span style={{ color: "var(--ink-1)" }}>{t(`enum.subtype.${name}`)}</span>
                        <span style={{ color: "var(--ink-3)", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>
                          {durSec > 0 ? formatDuration(durSec) : "—"} · {pct.toFixed(0)}%
                        </span>
                      </div>
                      <div style={{ background: "var(--bg-sunken)", height: 5, overflow: "hidden" }}>
                        <div style={{ background: shade, height: "100%", width: `${pct}%`, transition: "width 0.3s" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* HR-zone time distribution (FIT imports only) */}
      {hrZoneDist.total > 0 && (
        <>
          <div style={{ ...s.section, marginTop: 22 }}>{t("charts.hr_zone_title", { label: chartPeriodLabel() })}</div>
          <div style={s.card}>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {["Z1", "Z2", "Z3", "Z4", "Z5"].map((zid, i) => {
                const sec = hrZoneDist.z[i];
                const pct = hrZoneDist.total ? (sec / hrZoneDist.total) * 100 : 0;
                const shade = HR_ZONE_COLORS[i];
                return (
                  <div key={zid}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 5, alignItems: "baseline" }}>
                      <span style={{ color: "var(--ink-1)" }}>{zid} <span style={{ ...s.muted }}>{t(`charts.hr_zone.${zid}`)}</span></span>
                      <span style={{ color: "var(--ink-3)", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>
                        {sec > 0 ? formatDuration(sec) : "—"} · {pct.toFixed(0)}%
                      </span>
                    </div>
                    <div style={{ background: "var(--bg-sunken)", height: 5, overflow: "hidden" }}>
                      <div style={{ background: shade, height: "100%", width: `${pct}%`, transition: "width 0.3s" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Z1 (easy) → Z5 (max): cool green ramping to hot red.
const HR_ZONE_COLORS = ["var(--moss-light)", "var(--moss)", "var(--moss-deep)", "var(--warn)", "var(--danger)"];
