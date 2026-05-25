import { useState, useMemo } from "react";
import { s } from "../styles";
import { RUN_SUBTYPES, RUN_GROUP_TYPES, HR_ZONE_METHODS } from "../constants";
import { useT } from "../i18n/LanguageContext";
import { useIsMobile } from "../hooks/useMediaQuery";
import { formatDuration } from "../utils/format";
import { computeHRZones } from "../utils/profile";
import { getPeriodLabel } from "../utils/period";

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

export function ChartsTab({ filteredAllLogs, profile }) {
  const t = useT();
  const isMobile = useIsMobile();
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
        const rangeLabel = weekRangeLabel(start, end);
        buckets.push({
          label: rangeLabel,
          rangeText: rangeLabel,
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

  function chartPeriodLabel() {
    if (chartPeriod.type === "week")  return t("charts.last_weeks",  { n: chartPeriod.count });
    if (chartPeriod.type === "month") return t("charts.last_months", { n: chartPeriod.count });
    if (chartPeriod.type === "year")  return t("charts.last_years",  { n: chartPeriod.count });
    return "";
  }

  const chartMax = Math.max(...chartData.map(w => w.km), 1);
  // totalRunsForPie now holds total DURATION in seconds (not session count).
  const totalRunsForPie = runTypeDist.reduce((sum, [, c]) => sum + c, 0);

  // Heart-rate-zone distribution by duration. Uses the user's Karvonen zones
  // from profile (Resting HR + Max HR + chosen method).
  //
  // APPROXIMATION: we only store avg HR per activity (not time-in-zone), so
  // each activity's full duration is bucketed into the zone its avg HR falls into.
  // For mixed-intensity sessions this under-represents the zone diversity, but
  // it's the right approximation given the data we capture.
  const hrZones = useMemo(() => {
    return computeHRZones(profile?.restingHR, profile?.maxHR, profile?.hrZoneMethod);
  }, [profile?.restingHR, profile?.maxHR, profile?.hrZoneMethod]);

  const hrZoneDist = useMemo(() => {
    if (!hrZones) return null;
    const buckets = {};
    hrZones.forEach(z => buckets[z.id] = 0);
    let belowZ1 = 0;  // avg HR lower than Z1 low (very easy / warm-up only)
    let aboveZ5 = 0;  // avg HR above Z5 high (rare but possible)
    chartRangeLogs.forEach(l => {
      if (!l.hr || l.duration <= 0) return;
      const z = hrZones.find(zz => l.hr >= zz.low && l.hr <= zz.high);
      if (z) buckets[z.id] += l.duration;
      else if (l.hr < hrZones[0].low) belowZ1 += l.duration;
      else aboveZ5 += l.duration;
    });
    const total = hrZones.reduce((sum, z) => sum + buckets[z.id], 0) + belowZ1 + aboveZ5;
    return { buckets, belowZ1, aboveZ5, total };
  }, [chartRangeLogs, hrZones]);

  const hrZoneMethod = profile && HR_ZONE_METHODS.find(m => m.id === profile.hrZoneMethod);

  const presets = [
    { type: "week",  count: 4,  label: t("charts.weeks",  { n: 4 }) },
    { type: "week",  count: 8,  label: t("charts.weeks",  { n: 8 }) },
    { type: "month", count: 6,  label: t("charts.months", { n: 6 }) },
    { type: "month", count: 12, label: t("charts.months", { n: 12 }) },
    { type: "year",  count: 5,  label: t("charts.years",  { n: 5 }) },
  ];

  return (
    <div>
      {/* Period selector. Mobile: single native dropdown (less vertical space).
          Desktop: chips for direct toggling. */}
      {isMobile ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <span style={{ ...s.muted, fontSize: 11, flexShrink: 0 }}>{t("charts.show")}</span>
          <select
            value={`${chartPeriod.type}-${chartPeriod.count}`}
            onChange={e => {
              const [type, count] = e.target.value.split("-");
              setChartPeriod({ type, count: parseInt(count, 10) });
            }}
            style={{ ...s.input, flex: 1, padding: "6px 10px", fontSize: 13 }}>
            {presets.map(opt => (
              <option key={`${opt.type}-${opt.count}`} value={`${opt.type}-${opt.count}`}>
                {opt.label}
              </option>
            ))}
          </select>
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
        </div>
      )}

      <div style={s.section}>
        {t("charts.distance_trend")}
        {chartPeriod.type === "week" && (
          <span style={{ ...s.muted, fontWeight: 400, marginLeft: 8 }}>{t("charts.week_note")}</span>
        )}
      </div>
      <div style={{ ...s.card, marginBottom: 22, padding: isMobile ? "10px 6px 12px" : undefined }}>
        {/* viewBox font sizes bumped substantially — on a 360-wide phone the
            SVG scales down ~0.5×, so fontSize 16 here renders as ~8 device-px
            (legible) where the old 9 rendered as ~4.5 (unreadable). Markers
            and dot offsets bumped to match the larger labels. */}
        <svg viewBox="0 0 700 250" style={{ width: "100%", height: "auto", display: "block", fontFamily: "var(--font-mono)" }}>
          {[0, 0.25, 0.5, 0.75, 1].map((p, i) => {
            const y = 195 - p * 160;
            const val = (chartMax * p).toFixed(0);
            return (
              <g key={i}>
                <line x1="50" y1={y} x2="680" y2={y} stroke="var(--rule-soft)" strokeWidth="0.5" strokeDasharray={p === 0 ? "none" : "2 4"} />
                <text x="44" y={y + 5} fontSize="14" fill="var(--ink-3)" textAnchor="end" letterSpacing="0.02em">{val}</text>
              </g>
            );
          })}
          <text x="22" y="18" fontSize="13" fill="var(--ink-3)" textTransform="uppercase" letterSpacing="0.08em">{t("charts.km_axis")}</text>
          {(() => {
            const xStep = chartData.length > 1 ? 620 / (chartData.length - 1) : 0;
            const points = chartData.map((w, i) => ({
              x: 60 + i * xStep,
              y: 195 - (w.km / chartMax) * 160,
              w,
            }));
            if (points.length === 0) return null;
            const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
            return (
              <>
                <path d={`${path} L ${points[points.length - 1].x} 195 L ${points[0].x} 195 Z`} fill="var(--moss)" opacity="0.08" />
                <path d={path} fill="none" stroke="var(--moss-deep)" strokeWidth="1.5" />
                {points.map((p, i) => (
                  <g key={i}>
                    <rect x={p.x - 3} y={p.y - 3} width="6" height="6" fill="var(--ink-1)">
                      <title>{p.w.rangeText}: {p.w.km} km</title>
                    </rect>
                    {p.w.km > 0 && <text x={p.x} y={p.y - 12} fontSize="15" fill="var(--ink-1)" textAnchor="middle" letterSpacing="0.02em" fontWeight="500">{p.w.km}</text>}
                    <text x={p.x} y="218" fontSize="13" fill="var(--ink-3)" textAnchor="middle" letterSpacing="0.02em">{p.w.label}</text>
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

      {/* HR Zone Distribution — only when Karvonen zones are configured in profile.
          Zone time is approximated by bucketing each activity's full duration
          into the zone that its avg HR falls into. */}
      <div style={{ ...s.section, marginTop: 22 }}>
        {t("charts.hr_zone_title", { label: chartPeriodLabel() })}
        {hrZoneMethod && <span style={{ ...s.muted, fontWeight: 400, marginLeft: 8 }}>· {hrZoneMethod.label}</span>}
      </div>
      <div style={s.card}>
        {!hrZones ? (
          <div style={{ color: "var(--ink-3)", textAlign: "center", padding: 20, fontSize: 13, lineHeight: 1.6 }}>
            {t("charts.hr_zone_need_profile")}
          </div>
        ) : !hrZoneDist || hrZoneDist.total === 0 ? (
          <div style={{ color: "var(--ink-3)", textAlign: "center", padding: 20, fontSize: 13 }}>
            {t("charts.hr_zone_no_data")}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {hrZones.map((z, i) => {
              const dur = hrZoneDist.buckets[z.id] || 0;
              const pct = hrZoneDist.total ? (dur / hrZoneDist.total) * 100 : 0;
              // Bar shade: Z1 lightest moss → Z5 deepest ink (intensity ramp).
              const shade = ["var(--moss-light)", "var(--moss)", "var(--moss-deep)", "var(--ink-2)", "var(--ink-1)"][i] || "var(--ink-2)";
              return (
                <div key={z.id}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 5, alignItems: "baseline" }}>
                    <span style={{ color: "var(--ink-1)" }}>
                      {z.id}
                      <span style={{ ...s.muted, fontFamily: "var(--font-mono)", marginLeft: 8 }}>{z.low}–{z.high} bpm</span>
                    </span>
                    <span style={{ color: "var(--ink-3)", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>
                      {dur > 0 ? formatDuration(dur) : "—"} · {pct.toFixed(0)}%
                    </span>
                  </div>
                  <div style={{ background: "var(--bg-sunken)", height: 5, overflow: "hidden" }}>
                    <div style={{ background: shade, height: "100%", width: `${pct}%`, transition: "width 0.3s" }} />
                  </div>
                </div>
              );
            })}
            {/* Below Z1 / Above Z5 — informational, shown only when non-zero */}
            {(hrZoneDist.belowZ1 > 0 || hrZoneDist.aboveZ5 > 0) && (
              <div style={{ ...s.muted, fontSize: 11, marginTop: 4, paddingTop: 8, borderTop: "1px solid var(--rule-soft)" }}>
                {hrZoneDist.belowZ1 > 0 && <span style={{ marginRight: 14 }}>{t("charts.hr_zone_below")}: <span style={{ fontFamily: "var(--font-mono)" }}>{formatDuration(hrZoneDist.belowZ1)}</span></span>}
                {hrZoneDist.aboveZ5 > 0 && <span>{t("charts.hr_zone_above")}: <span style={{ fontFamily: "var(--font-mono)" }}>{formatDuration(hrZoneDist.aboveZ5)}</span></span>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
