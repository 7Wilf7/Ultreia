import { useMemo, useState } from "react";
import { s, CONTOUR_BG } from "../styles";
import { getPeriodRange } from "../utils/period";
import { RUN_GROUP_TYPES } from "../constants";
import { useT } from "../i18n/LanguageContext";
import { useIsMobile } from "../hooks/useMediaQuery";
import { GlobalFilter, logMatchesFilter } from "./GlobalFilter";
import { PeriodSelector } from "./PeriodSelector";
import { ActivitiesTab } from "./ActivitiesTab";
import { ChartsTab } from "./ChartsTab";

export function TrainingTab({
  logs, addLog, updateLog, bulkAddLogs,
  filter, setFilter, filterDropdown, setFilterDropdown,
  period, setPeriod, periodDropdown, setPeriodDropdown,
  setConfirmDelete, profile,
}) {
  const t = useT();
  const isMobile = useIsMobile();
  const [view, setView] = useState("activities"); // "activities" | "charts"

  // Activities / Charts must NOT include planned workouts (those live on the
  // Calendar tab only). Planned rows would inflate PR / weekly km / averages.
  const actualLogs = useMemo(() => logs.filter(l => !l.isPlanned), [logs]);

  const filteredAllLogs = useMemo(
    () => actualLogs.filter(l => logMatchesFilter(l, filter)),
    [actualLogs, filter]
  );

  const periodLogs = useMemo(() => {
    const [from, to] = getPeriodRange(period);
    return filteredAllLogs.filter(l => {
      const d = new Date(l.date);
      return d >= from && d < to;
    });
  }, [filteredAllLogs, period]);

  const periodSessions = periodLogs.length;
  const periodKm = periodLogs.filter(l => RUN_GROUP_TYPES.includes(l.type))
    .reduce((sum, l) => sum + (l.distance || 0), 0);
  const periodAscent = periodLogs.reduce((sum, l) => sum + (l.ascent || 0), 0);
  const hrLogs = periodLogs.filter(l => l.hr);
  const periodAvgHR = hrLogs.length > 0
    ? Math.round(hrLogs.reduce((sum, l) => sum + l.hr, 0) / hrLogs.length)
    : 0;

  return (
    <div>
      <GlobalFilter
        filter={filter}
        setFilter={setFilter}
        openDropdown={filterDropdown}
        setOpenDropdown={setFilterDropdown}
      />

      <PeriodSelector
        period={period}
        setPeriod={setPeriod}
        periodDropdown={periodDropdown}
        setPeriodDropdown={setPeriodDropdown}
      />

      {/* Sub-view toggle — Activities ↔ Charts (Calendar is a top-level tab now) */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        <button onClick={() => setView("activities")} style={s.chip(view === "activities")}>
          {t("training.view.activities")}
        </button>
        <button onClick={() => setView("charts")} style={s.chip(view === "charts")}>
          {t("training.view.charts")}
        </button>
      </div>

      {view === "activities" && (
        <>
          {/* Instrument-readout stats — four cells in a single row, each like a
              meter on a control panel. Hairline rules between cells, contour
              decoration on the bottom-right, position number in the corner. */}
          <div style={{
            display: "grid",
            // Mobile: force a single 4-col row so all stats fit above the
            // fold; drop the contour decoration + position number to save
            // every available pixel. Desktop keeps the original instrument
            // panel feel.
            gridTemplateColumns: isMobile ? "repeat(4, minmax(0, 1fr))" : "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 0,
            marginBottom: isMobile ? 16 : 28,
            border: "1px solid var(--rule)",
            background: "var(--bg-elevated)",
          }}>
            {[
              { label: t("training.sessions"),       val: String(periodSessions),                                    unit: "" },
              { label: t("training.total_distance"), val: periodKm.toFixed(1),                                       unit: "km" },
              { label: t("training.total_ascent"),   val: periodAscent.toLocaleString(),                             unit: "m" },
              { label: t("training.avg_hr"),         val: periodAvgHR ? String(periodAvgHR) : t("common.no_data"),   unit: periodAvgHR ? "bpm" : "" },
            ].map((c, i) => (
              <div key={c.label} style={{
                position: "relative",
                padding: isMobile ? "8px 6px 10px" : "20px 22px 24px",
                borderRight: i < 3 ? "1px solid var(--rule)" : "none",
                minHeight: isMobile ? undefined : 110,
                ...(isMobile ? {} : CONTOUR_BG),
              }}>
                {/* Corner position number — desktop only (no room on mobile) */}
                {!isMobile && (
                  <div style={{ position: "absolute", top: 10, right: 14, fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-3)" }}>
                    {String(i + 1).padStart(2, "0")} / 04
                  </div>
                )}
                <div style={{
                  fontFamily: "var(--font-sans)",
                  fontSize: isMobile ? 10 : 13,
                  color: "var(--ink-2)",
                  marginBottom: isMobile ? 3 : 10,
                  fontWeight: 500,
                  textTransform: isMobile ? "uppercase" : "none",
                  letterSpacing: isMobile ? "0.04em" : "normal",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}>{c.label}</div>
                <div style={{
                  ...s.metricVal,
                  fontSize: isMobile ? 17 : 32,
                  marginTop: 0,
                  display: "flex", alignItems: "baseline", gap: 3,
                  lineHeight: 1.1,
                }}>
                  <span>{c.val}</span>
                  {c.unit && (
                    <span style={{
                      fontSize: isMobile ? 10 : 13,
                      color: "var(--ink-3)", fontWeight: 400, fontFamily: "var(--font-mono)",
                    }}>
                      {c.unit}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <ActivitiesTab
            logs={logs}
            addLog={addLog}
            updateLog={updateLog}
            bulkAddLogs={bulkAddLogs}
            periodLogs={periodLogs}
            setConfirmDelete={setConfirmDelete}
          />
        </>
      )}

      {view === "charts" && (
        <ChartsTab filteredAllLogs={filteredAllLogs} profile={profile} />
      )}
    </div>
  );
}
