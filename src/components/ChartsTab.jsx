import { useState, useMemo } from "react";
import { s } from "../styles";
import { RUN_SUBTYPES, RUN_GROUP_TYPES } from "../constants";
import { useT } from "../i18n/LanguageContext";
import { formatDateShort } from "../utils/format";
import { getPeriodLabel } from "../utils/period";

export function ChartsTab({ filteredAllLogs }) {
  const t = useT();
  const [chartPeriod, setChartPeriod] = useState({ type: "week", count: 8 });

  const chartData = useMemo(() => {
    const nowD = new Date();
    const buckets = [];

    if (chartPeriod.type === "week") {
      for (let i = chartPeriod.count - 1; i >= 0; i--) {
        const dayOfWeek = (nowD.getDay() + 6) % 7;
        const start = new Date(nowD);
        start.setDate(nowD.getDate() - dayOfWeek - i * 7);
        start.setHours(0, 0, 0, 0);
        const end = new Date(start); end.setDate(start.getDate() + 7);
        const km = filteredAllLogs.filter(l => {
          const d = new Date(l.date);
          return d >= start && d < end && RUN_GROUP_TYPES.includes(l.type);
        }).reduce((sum, l) => sum + l.distance, 0);
        const endDisplay = new Date(end); endDisplay.setDate(endDisplay.getDate() - 1);
        buckets.push({
          label: formatDateShort(start.toISOString().slice(0, 10)),
          rangeText: `${formatDateShort(start.toISOString().slice(0, 10))} → ${formatDateShort(endDisplay.toISOString().slice(0, 10))}`,
          km: +km.toFixed(1),
        });
      }
    } else if (chartPeriod.type === "month") {
      for (let i = chartPeriod.count - 1; i >= 0; i--) {
        const start = new Date(nowD.getFullYear(), nowD.getMonth() - i, 1);
        const end = new Date(nowD.getFullYear(), nowD.getMonth() - i + 1, 1);
        const km = filteredAllLogs.filter(l => {
          const d = new Date(l.date);
          return d >= start && d < end && RUN_GROUP_TYPES.includes(l.type);
        }).reduce((sum, l) => sum + l.distance, 0);
        buckets.push({
          label: `${start.getFullYear()}-${start.getMonth() + 1}`,
          rangeText: getPeriodLabel({ type: "month", year: start.getFullYear(), month: start.getMonth() }, t),
          km: +km.toFixed(1),
        });
      }
    } else if (chartPeriod.type === "year") {
      for (let i = chartPeriod.count - 1; i >= 0; i--) {
        const yy = nowD.getFullYear() - i;
        const start = new Date(yy, 0, 1);
        const end = new Date(yy + 1, 0, 1);
        const km = filteredAllLogs.filter(l => {
          const d = new Date(l.date);
          return d >= start && d < end && RUN_GROUP_TYPES.includes(l.type);
        }).reduce((sum, l) => sum + l.distance, 0);
        buckets.push({ label: String(yy), rangeText: String(yy), km: +km.toFixed(1) });
      }
    }
    return buckets;
  }, [filteredAllLogs, chartPeriod, t]);

  const chartRangeLogs = useMemo(() => {
    const nowD = new Date();
    let from;
    if (chartPeriod.type === "week") {
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

  const runTypeDist = useMemo(() => {
    const counts = {};
    RUN_SUBTYPES.forEach(sub => counts[sub] = 0);
    chartRangeLogs.filter(l => l.type === "Road Run" && l.subTypes.length > 0).forEach(l => {
      counts[l.subTypes[0]] = (counts[l.subTypes[0]] || 0) + 1;
    });
    return Object.entries(counts);
  }, [chartRangeLogs]);

  function chartPeriodLabel() {
    if (chartPeriod.type === "week")  return t("charts.last_weeks",  { n: chartPeriod.count });
    if (chartPeriod.type === "month") return t("charts.last_months", { n: chartPeriod.count });
    if (chartPeriod.type === "year")  return t("charts.last_years",  { n: chartPeriod.count });
    return "";
  }

  const chartMax = Math.max(...chartData.map(w => w.km), 1);
  const totalRunsForPie = runTypeDist.reduce((sum, [, c]) => sum + c, 0);

  const presets = [
    { type: "week",  count: 4,  label: t("charts.weeks",  { n: 4 }) },
    { type: "week",  count: 8,  label: t("charts.weeks",  { n: 8 }) },
    { type: "month", count: 6,  label: t("charts.months", { n: 6 }) },
    { type: "month", count: 12, label: t("charts.months", { n: 12 }) },
    { type: "year",  count: 5,  label: t("charts.years",  { n: 5 }) },
  ];

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ ...s.muted }}>{t("charts.show")}</span>
        {presets.map(opt => {
          const active = chartPeriod.type === opt.type && chartPeriod.count === opt.count;
          return (
            <button key={`${opt.type}-${opt.count}`} onClick={() => setChartPeriod({ type: opt.type, count: opt.count })}
              style={s.chip(active)}>{opt.label}</button>
          );
        })}
      </div>

      <div style={s.section}>
        {t("charts.distance_trend")}
        {chartPeriod.type === "week" && (
          <span style={{ ...s.muted, fontWeight: 400, marginLeft: 8 }}>{t("charts.week_note")}</span>
        )}
      </div>
      <div style={{ ...s.card, marginBottom: 22 }}>
        <svg viewBox="0 0 700 240" style={{ width: "100%", height: "auto", display: "block", fontFamily: "var(--font-mono)" }}>
          {[0, 0.25, 0.5, 0.75, 1].map((p, i) => {
            const y = 190 - p * 160;
            const val = (chartMax * p).toFixed(0);
            return (
              <g key={i}>
                <line x1="40" y1={y} x2="690" y2={y} stroke="var(--rule-soft)" strokeWidth="0.5" strokeDasharray={p === 0 ? "none" : "2 4"} />
                <text x="34" y={y + 3.5} fontSize="9" fill="var(--ink-3)" textAnchor="end" letterSpacing="0.04em">{val}</text>
              </g>
            );
          })}
          <text x="20" y="14" fontSize="9" fill="var(--ink-3)" textTransform="uppercase" letterSpacing="0.1em">{t("charts.km_axis")}</text>
          {(() => {
            const xStep = chartData.length > 1 ? 640 / (chartData.length - 1) : 0;
            const points = chartData.map((w, i) => ({
              x: 50 + i * xStep,
              y: 190 - (w.km / chartMax) * 160,
              w,
            }));
            if (points.length === 0) return null;
            const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
            return (
              <>
                {/* Filled area beneath the line = elevation-profile feel */}
                <path d={`${path} L ${points[points.length - 1].x} 190 L ${points[0].x} 190 Z`} fill="var(--moss)" opacity="0.08" />
                <path d={path} fill="none" stroke="var(--moss-deep)" strokeWidth="1.25" />
                {points.map((p, i) => (
                  <g key={i}>
                    <rect x={p.x - 2} y={p.y - 2} width="4" height="4" fill="var(--ink-1)">
                      <title>{p.w.rangeText}: {p.w.km} km</title>
                    </rect>
                    {p.w.km > 0 && <text x={p.x} y={p.y - 9} fontSize="9" fill="var(--ink-1)" textAnchor="middle" letterSpacing="0.02em">{p.w.km}</text>}
                    <text x={p.x} y="208" fontSize="8.5" fill="var(--ink-3)" textAnchor="middle" letterSpacing="0.04em">{p.w.label}</text>
                  </g>
                ))}
              </>
            );
          })()}
        </svg>
      </div>

      <div style={s.section}>{t("charts.run_type_title", { label: chartPeriodLabel() })}</div>
      <div style={s.card}>
        {totalRunsForPie === 0 ? (
          <div style={{ color: "var(--ink-3)", textAlign: "center", padding: 20, fontSize: 13 }}>{t("charts.no_classified")}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {runTypeDist.map(([name, count], i) => {
              const pct = totalRunsForPie ? (count / totalRunsForPie) * 100 : 0;
              // Bar shade ramp from ink → moss tints, intensity-keyed
              const shade = ["var(--ink-1)", "var(--ink-2)", "var(--moss-deep)", "var(--moss)", "var(--moss-light)"][i] || "var(--ink-2)";
              return (
                <div key={name}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 5, alignItems: "baseline" }}>
                    <span style={{ color: "var(--ink-1)" }}>{t(`enum.subtype.${name}`)}</span>
                    <span style={{ color: "var(--ink-3)", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>{count} · {pct.toFixed(0)}%</span>
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
    </div>
  );
}
