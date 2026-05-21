import { useMemo, useState } from "react";
import { s, CONTOUR_BG } from "../styles";
import { getPeriodRange } from "../utils/period";
import { RUN_GROUP_TYPES } from "../constants";
import { useT } from "../i18n/LanguageContext";
import { GlobalFilter, logMatchesFilter } from "./GlobalFilter";
import { PeriodSelector } from "./PeriodSelector";
import { ActivitiesTab } from "./ActivitiesTab";
import { ChartsTab } from "./ChartsTab";
import { CalendarTab } from "./CalendarTab";

export function TrainingTab({
  logs, addLog, updateLog, bulkAddLogs,
  filter, setFilter, filterDropdown, setFilterDropdown,
  period, setPeriod, periodDropdown, setPeriodDropdown,
  setConfirmDelete, profile,
}) {
  const t = useT();
  const [view, setView] = useState("activities"); // "activities" | "calendar" | "charts"

  // Calendar needs BOTH actual + planned workouts (it visually distinguishes
  // them). Activities / Charts / stats cards must NOT include future plans
  // (otherwise PR would count un-run distance, weekly km would jump, etc).
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

      {/* Period selector hides on Calendar view — calendar has its own month picker
          and the global period filter doesn't apply to a month grid. */}
      {view !== "calendar" && (
        <PeriodSelector
          period={period}
          setPeriod={setPeriod}
          periodDropdown={periodDropdown}
          setPeriodDropdown={setPeriodDropdown}
        />
      )}

      {/* Sub-view toggle — Activities ↔ Calendar ↔ Charts */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        <button onClick={() => setView("activities")} style={s.chip(view === "activities")}>
          {t("training.view.activities")}
        </button>
        <button onClick={() => setView("calendar")} style={s.chip(view === "calendar")}>
          {t("training.view.calendar")}
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
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 0,
            marginBottom: 28,
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
                padding: "20px 22px 24px",
                borderRight: i < 3 ? "1px solid var(--rule)" : "none",
                minHeight: 110,
                ...CONTOUR_BG,
              }}>
                {/* corner position number — keeps the instrument hint, stays tiny */}
                <div style={{ position: "absolute", top: 10, right: 14, fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-3)" }}>
                  {String(i + 1).padStart(2, "0")} / 04
                </div>
                <div style={{ fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--ink-2)", marginBottom: 10, fontWeight: 500 }}>{c.label}</div>
                <div style={{ ...s.metricVal, fontSize: 32, display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span>{c.val}</span>
                  {c.unit && (
                    <span style={{ fontSize: 13, color: "var(--ink-3)", fontWeight: 400, fontFamily: "var(--font-mono)" }}>
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

      {view === "calendar" && (
        <CalendarTab
          logs={logs}
          addLog={addLog}
          updateLog={updateLog}
          setConfirmDelete={setConfirmDelete}
        />
      )}

      {view === "charts" && (
        <ChartsTab filteredAllLogs={filteredAllLogs} profile={profile} />
      )}
    </div>
  );
}
