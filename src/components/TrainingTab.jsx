import { useMemo, useState } from "react";
import { s, CONTOUR_BG } from "../styles";
import { getPeriodRange } from "../utils/period";
import { RUN_GROUP_TYPES } from "../constants";
import { formatDuration, formatDurationShort } from "../utils/format";
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
  setConfirmDelete,
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
  const periodDurationSec = periodLogs.reduce((sum, l) => sum + (l.duration || 0), 0);

  // Sticky header for the three navigation rows: All activities ▼ /
  // Activities-Charts toggle / period selector (when in activities view).
  // Mobile: glues to the top of MobileShell's scrolling main; covers main's
  // top padding (safe-area + 14px gutter) so when scrolled, no scrolled
  // content shows through above the sticky. The trick is `top` set to
  // negative paddingTop — position:sticky measures `top` from the
  // scrolling ancestor's padding edge, so a positive top:0 pins it
  // INSIDE the padding (leaves a visible gap above). A negative top equal
  // to the padding lifts the sticky's top edge up to main's outer edge.
  // Desktop: pins to the viewport top while the user scrolls a long list,
  // so the global filter + tab toggle + period selector stay reachable.
  const stickyHeaderStyle = isMobile ? {
    position: "sticky",
    top: "calc(-1 * max(env(safe-area-inset-top), 14px))",
    zIndex: 10,
    background: "var(--bg)",
    marginLeft: -14, marginRight: -14, paddingLeft: 14, paddingRight: 14,
    marginTop: "calc(-1 * max(env(safe-area-inset-top), 14px))",
    paddingTop: "calc(max(env(safe-area-inset-top), 14px) + 4px)",
    paddingBottom: 4,
    marginBottom: 6,
  } : {
    position: "sticky", top: 0, zIndex: 10,
    background: "var(--bg)",
    paddingTop: 8, paddingBottom: 8,
    marginBottom: 8,
  };

  return (
    <div>
      <div style={stickyHeaderStyle}>
        {/* Centered borderless filter dropdown — same on desktop and mobile.
            Applies to both Activities and Charts views (the filter narrows
            the dataset, not the visualization). */}
        <GlobalFilter filter={filter} setFilter={setFilter} />

        {/* Activities ↔ Charts sits ABOVE the period selector: the period only
            governs Activities (Charts has its own period selector inside).
            Wrapped as segmented tabs so the hierarchy reads correctly. */}
        <div style={{
          display: "flex",
          marginBottom: 14,
          border: "1px solid var(--rule)",
          borderRadius: 2,
          background: "var(--bg-elevated)",
        }}>
          {[
            { id: "activities", label: t("training.view.activities") },
            { id: "charts",     label: t("training.view.charts") },
          ].map((tab, i) => {
            const active = view === tab.id;
            return (
              <button key={tab.id} onClick={() => setView(tab.id)}
                style={{
                  flex: 1, minHeight: 36,
                  background: active ? "var(--ink-1)" : "transparent",
                  color: active ? "var(--ink-inv)" : "var(--ink-2)",
                  border: "none",
                  borderRight: i === 0 ? "1px solid var(--rule)" : "none",
                  fontFamily: "var(--font-sans)", fontSize: 13,
                  fontWeight: active ? 600 : 500,
                  cursor: "pointer", borderRadius: 0,
                }}>
                {tab.label}
              </button>
            );
          })}
        </div>

        {view === "activities" && (
          /* Period applies to the activity list + the four stats only. */
          <PeriodSelector
            period={period}
            setPeriod={setPeriod}
            periodDropdown={periodDropdown}
            setPeriodDropdown={setPeriodDropdown}
          />
        )}
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
              { label: t("training.total_time"),     val: periodDurationSec ? (isMobile ? formatDurationShort(periodDurationSec) : formatDuration(periodDurationSec)) : t("common.no_data"), unit: "" },
              { label: t("training.total_distance"), val: periodKm.toFixed(1),                                       unit: "km" },
              { label: t("training.total_ascent"),   val: periodAscent.toLocaleString(),                             unit: "m" },
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
        <ChartsTab filteredAllLogs={filteredAllLogs} filter={filter} />
      )}
    </div>
  );
}
