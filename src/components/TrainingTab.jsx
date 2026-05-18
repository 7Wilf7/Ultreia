import { useMemo, useState } from "react";
import { s } from "../styles";
import { getPeriodRange } from "../utils/period";
import { RUN_GROUP_TYPES } from "../constants";
import { useT } from "../i18n/LanguageContext";
import { GlobalFilter, logMatchesFilter } from "./GlobalFilter";
import { PeriodSelector } from "./PeriodSelector";
import { ActivitiesTab } from "./ActivitiesTab";
import { ChartsTab } from "./ChartsTab";

export function TrainingTab({
  logs, setLogs,
  filter, setFilter, filterDropdown, setFilterDropdown,
  period, setPeriod, periodDropdown, setPeriodDropdown,
  setConfirmDelete,
}) {
  const t = useT();
  const [view, setView] = useState("activities"); // "activities" | "charts"

  const filteredAllLogs = useMemo(
    () => logs.filter(l => logMatchesFilter(l, filter)),
    [logs, filter]
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

      {/* Sub-view toggle — Activities ↔ Charts */}
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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 24 }}>
            {[
              { label: t("training.sessions"),       val: periodSessions,                  unit: "" },
              { label: t("training.total_distance"), val: periodKm.toFixed(1),             unit: "km" },
              { label: t("training.total_ascent"),   val: periodAscent.toLocaleString(),   unit: "m" },
              { label: t("training.avg_hr"),         val: periodAvgHR || t("common.no_data"), unit: periodAvgHR ? "bpm" : "" },
            ].map(c => (
              <div key={c.label} style={s.cardDark}>
                <div style={s.label}>{c.label}</div>
                <div style={s.metricVal}>
                  {c.val}
                  {c.unit && <span style={{ fontSize: 14, color: "#888", fontWeight: 400, marginLeft: 4 }}>{c.unit}</span>}
                </div>
              </div>
            ))}
          </div>

          <ActivitiesTab
            logs={logs}
            setLogs={setLogs}
            periodLogs={periodLogs}
            setConfirmDelete={setConfirmDelete}
          />
        </>
      )}

      {view === "charts" && (
        <ChartsTab filteredAllLogs={filteredAllLogs} />
      )}
    </div>
  );
}
