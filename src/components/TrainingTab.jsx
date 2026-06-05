import { useMemo, useRef, useState, useEffect } from "react";
import { s, CONTOUR_BG } from "../styles";
import { getPeriodRange } from "../utils/period";
import { RUN_GROUP_TYPES } from "../constants";
import { formatDuration } from "../utils/format";
import { useT } from "../i18n/LanguageContext";
import { useIsMobile } from "../hooks/useMediaQuery";
import { GlobalFilter, logMatchesFilter } from "./GlobalFilter";
import { PeriodSelector } from "./PeriodSelector";
import { ActivitiesTab } from "./ActivitiesTab";
import { ChartsTab } from "./ChartsTab";

// Activities ↔ Charts segmented toggle. Module-level (not defined inside
// TrainingTab's render) so it keeps a stable identity across renders.
function ViewToggle({ view, setView, t, style }) {
  return (
    <div style={{
      display: "flex",
      border: "1px solid var(--rule)",
      borderRadius: 2,
      background: "var(--bg-elevated)",
      ...style,
    }}>
      {[
        { id: "activities", label: t("training.view.activities") },
        { id: "charts",     label: t("training.view.charts") },
      ].map((tab, i) => {
        const active = view === tab.id;
        return (
          <button key={tab.id} onClick={() => setView(tab.id)}
            style={{
              flex: 1, minHeight: 36, padding: "0 14px",
              background: active ? "var(--ink-1)" : "transparent",
              color: active ? "var(--ink-inv)" : "var(--ink-2)",
              border: "none",
              borderRight: i === 0 ? "1px solid var(--rule)" : "none",
              fontFamily: "var(--font-sans)", fontSize: 13,
              fontWeight: active ? 600 : 500,
              cursor: "pointer", borderRadius: 0, whiteSpace: "nowrap",
            }}>
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

function StatTile({ label, val, unit, isMobile }) {
  const compactMobileValue = isMobile && unit;
  return (
    <div style={{
      position: "relative",
      padding: isMobile ? "0 11px" : "20px 22px 24px",
      borderRight: isMobile ? "none" : "1px solid var(--rule)",
      minHeight: isMobile ? 44 : 110,
      height: isMobile ? 44 : undefined,
      minWidth: 0,
      boxSizing: "border-box",
      ...(isMobile ? {
        border: "1px solid rgba(74,92,55,0.2)",
        background: "var(--moss-bg)",
        borderRadius: 8,
      } : CONTOUR_BG),
    }}>
      {isMobile ? (
        <div style={{
          height: "100%",
          display: "grid",
          gridTemplateColumns: "60px minmax(0, 1fr)",
          alignItems: "center",
          columnGap: 9,
          minWidth: 0,
        }}>
          <div style={{
            fontFamily: "var(--font-sans)",
            fontSize: 10,
            color: "var(--ink-2)",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            whiteSpace: "nowrap",
            textAlign: "left",
          }}>{label}</div>
          <div style={{
            ...s.metricVal,
            fontSize: compactMobileValue ? "clamp(16px, 4.35vw, 18px)" : "clamp(18px, 5vw, 21px)",
            marginTop: 0,
            display: "flex", alignItems: "baseline", justifyContent: "flex-start", gap: 3,
            lineHeight: 1.05,
            letterSpacing: 0,
            minWidth: 0,
            overflow: "visible",
          }}>
            <span style={{ minWidth: 0, overflow: "visible", whiteSpace: "nowrap" }}>{val}</span>
            {unit && (
              <span style={{
                fontSize: 9,
                color: "var(--ink-3)", fontWeight: 400, fontFamily: "var(--font-mono)",
                flexShrink: 0,
              }}>
                {unit}
              </span>
            )}
          </div>
        </div>
      ) : (
        <>
          <div style={{
            fontFamily: "var(--font-sans)",
            fontSize: 13,
            color: "var(--ink-2)",
            marginBottom: 10,
            fontWeight: 500,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>{label}</div>
          <div style={{
            ...s.metricVal,
            fontSize: 32,
            marginTop: 0,
            display: "flex", alignItems: "baseline", gap: 3,
            lineHeight: 1.05,
            minWidth: 0,
            overflow: "hidden",
          }}>
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{val}</span>
            {unit && (
              <span style={{
                fontSize: 13,
                color: "var(--ink-3)", fontWeight: 400, fontFamily: "var(--font-mono)",
                flexShrink: 0,
              }}>
                {unit}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function TrainingTab({
  logs, addLog, updateLog, bulkAddLogs,
  filter, setFilter,
  period, setPeriod, periodDropdown, setPeriodDropdown,
  view, setView,            // "activities" | "charts" — lifted to AppShell so
                            // it survives top-tab switches within a session
  setConfirmDelete, profile, races,
}) {
  const t = useT();
  const isMobile = useIsMobile();

  // Sticky stacking for the Activities view: nav rows (existing sticky) → stats
  // row → toolbar row all stay pinned at the top while only the list scrolls.
  // We measure each element's pinned bottom and feed the next one's `top`.
  //   statsTop    = nav pinned-bottom  = navStickyTop + navHeight
  //   toolbarTop  = stats pinned-bottom = statsTop + statsHeight
  // Mobile lifts the nav by its paddingTop (the negative-top trick); desktop
  // pins at 0.
  const headerRef = useRef(null);   // the nav-rows sticky block
  const [summaryTop, setSummaryTop] = useState(0);
  useEffect(() => {
    const navEl = headerRef.current;
    if (!navEl) { setSummaryTop(0); return; }
    const measure = () => {
      const padTop = parseFloat(getComputedStyle(navEl).paddingTop) || 0;
      const navStickyTop = isMobile ? -(padTop - 4) : 0;
      setSummaryTop(Math.round(navEl.offsetHeight + navStickyTop));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(navEl);
    return () => ro.disconnect();
  }, [isMobile, view]);
  const statsStickyHeight = isMobile ? 106 : 112;
  const statsTop = summaryTop;
  const toolbarTop = summaryTop + statsStickyHeight;

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
  const mobileTimeStat = (() => {
    if (!periodDurationSec) return { val: t("common.no_data"), unit: "" };
    const h = Math.floor(periodDurationSec / 3600);
    if (h > 0) return { val: String(h), unit: "h" };
    const m = Math.floor(periodDurationSec / 60);
    if (m > 0) return { val: String(m), unit: "m" };
    return { val: String(Math.round(periodDurationSec)), unit: "s" };
  })();
  const statItems = [
    { key: "sessions", label: t("training.sessions"), val: String(periodSessions), unit: "" },
    { key: "time", label: t("training.total_time"), val: isMobile ? mobileTimeStat.val : (periodDurationSec ? formatDuration(periodDurationSec) : t("common.no_data")), unit: isMobile ? mobileTimeStat.unit : "" },
    { key: "distance", label: t("training.total_distance"), val: isMobile ? Math.round(periodKm).toLocaleString() : periodKm.toFixed(1), unit: "km" },
    { key: "ascent", label: t("training.total_ascent"), val: periodAscent.toLocaleString(), unit: "m" },
  ];

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
    paddingBottom: 0,
    marginBottom: 0,
  } : {
    position: "sticky", top: 0, zIndex: 10,
    background: "var(--bg)",
    paddingTop: 8, paddingBottom: 8,
    marginBottom: 8,
  };

  return (
    <div>
      <div ref={headerRef} style={stickyHeaderStyle}>
        {isMobile ? (
          /* Mobile: compress to TWO rows (was three).
             Row 1 — type filter (left) + Activities/Charts toggle (right),
             sharing one line to claw back vertical space.
             Row 2 — period bar, full width (activities view only). */
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <div style={{ flexShrink: 0 }}>
                <GlobalFilter filter={filter} setFilter={setFilter} compact />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <ViewToggle view={view} setView={setView} t={t} />
              </div>
            </div>
            {view === "activities" && (
              <PeriodSelector
                period={period} setPeriod={setPeriod}
                periodDropdown={periodDropdown} setPeriodDropdown={setPeriodDropdown}
                dense
                style={{ marginBottom: 8 }}
              />
            )}
          </>
        ) : (
          /* Desktop: original stacked layout — centered filter, full-width
             toggle, full-width period bar. Plenty of room here; no need to
             cram onto one line. */
          <>
            <GlobalFilter filter={filter} setFilter={setFilter} />
            <ViewToggle view={view} setView={setView} t={t} style={{ marginBottom: 14 }} />
            {view === "activities" && (
              <PeriodSelector
                period={period} setPeriod={setPeriod}
                periodDropdown={periodDropdown} setPeriodDropdown={setPeriodDropdown}
              />
            )}
          </>
        )}
      </div>

      {view === "activities" && (
        <>

          {/* Instrument-readout stats — four cells in a single row, each like a
              meter on a control panel. Sticks just below the nav header so the
              period totals stay visible while the list scrolls. */}
          <div style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(auto-fit, minmax(180px, 1fr))",
            gap: isMobile ? "6px 8px" : 0,
            marginBottom: 0,
            border: isMobile ? "none" : "1px solid var(--rule)",
            background: isMobile ? "var(--bg)" : "var(--bg-elevated)",
            position: "sticky", top: statsTop, zIndex: 9,
            height: isMobile ? statsStickyHeight : undefined,
            padding: isMobile ? "5px 0" : 0,
            boxSizing: "border-box",
            borderBottom: isMobile ? "1px solid var(--rule)" : undefined,
          }}>
            {statItems.map((c, i) => (
              <div key={c.key} style={{
                position: "relative",
                display: "block",
              }}>
                {/* Corner position number — desktop only (no room on mobile) */}
                {!isMobile && (
                  <div style={{ position: "absolute", top: 10, right: 14, fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-3)" }}>
                    {String(i + 1).padStart(2, "0")} / 04
                  </div>
                )}
                <StatTile {...c} isMobile={isMobile} />
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
            profile={profile}
            toolbarStickyTop={toolbarTop}
          />
        </>
      )}

      {view === "charts" && (
        <ChartsTab filteredAllLogs={filteredAllLogs} filter={filter} races={races} />
      )}
    </div>
  );
}
