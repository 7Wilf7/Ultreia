import { useMemo, useRef, useState } from "react";
import { s, CONTOUR_BG } from "../styles";
import { getPeriodRange } from "../utils/period";
import { RUN_GROUP_TYPES } from "../constants";
import { formatDuration } from "../utils/format";
import { computeTrainingLoad } from "../utils/trainingLoad";

// ACWR ramp → restrained color cue (moss=good, ochre=watch, burnt=spike).
const RAMP_COLOR = { optimal: "var(--moss)", low: "var(--ink-3)", high: "var(--warn)", danger: "var(--danger)", unknown: "var(--ink-3)" };
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
      borderRadius: 8,
      background: "var(--panel)",
      overflow: "hidden",
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
              background: active ? "var(--accent-soft)" : "transparent",
              color: active ? "var(--accent-dark)" : "var(--ink-2)",
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

function mobileStatValueFontSize(value) {
  const digits = String(value).replace(/\D/g, "").length;
  if (digits <= 3) return 22;
  if (digits <= 4) return 20;
  if (digits <= 5) return 18;
  return 17;
}

function StatTile({ label, val, unit, isMobile }) {
  const mobileValueFontSize = isMobile ? mobileStatValueFontSize(val) : 32;
  return (
    <div style={{
      position: "relative",
      padding: isMobile ? "0 10px" : "20px 22px 24px",
      borderRight: isMobile ? "none" : "1px solid var(--rule)",
      minHeight: isMobile ? 44 : 110,
      height: isMobile ? 44 : undefined,
      minWidth: 0,
      boxSizing: "border-box",
      ...(isMobile ? {
        border: "1px solid var(--accent)",
        background: "var(--accent-soft)",
        borderRadius: 8,
      } : CONTOUR_BG),
    }}>
      {isMobile ? (
        <div style={{
          height: "100%",
          display: "grid",
          gridTemplateColumns: "58px 62px 14px",
          alignItems: "center",
          columnGap: 4,
          minWidth: 0,
        }}>
          <div style={{
            fontFamily: "var(--font-sans)",
            fontSize: 11,
            color: "var(--ink-2)",
            fontWeight: 650,
            textTransform: "uppercase",
            letterSpacing: "0.025em",
            whiteSpace: "nowrap",
            textAlign: "left",
          }}>{label}</div>
          <div style={{
            ...s.metricVal,
            fontSize: mobileValueFontSize,
            marginTop: 0,
            display: "flex", alignItems: "baseline", justifyContent: "center",
            lineHeight: 1.05,
            letterSpacing: 0,
            minWidth: 0,
            overflow: "visible",
          }}>
            <span style={{ minWidth: 0, overflow: "visible", whiteSpace: "nowrap" }}>{val}</span>
          </div>
          <div style={{
            fontSize: 10,
            color: "var(--ink-3)", fontWeight: 400, fontFamily: "var(--font-mono)",
            lineHeight: 1,
            textAlign: "left",
            whiteSpace: "nowrap",
          }}>{unit}</div>
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

function shouldSkipSectionSwipe(target) {
  return !!target?.closest?.("button,input,textarea,select,a,[role='button'],[data-dropdown-menu]");
}

export function TrainingTab({
  logs, addLog, updateLog, bulkAddLogs,
  filter, setFilter,
  period, setPeriod, periodDropdown, setPeriodDropdown,
  view, setView,            // "activities" | "charts" — lifted to AppShell so
                            // it survives top-tab switches within a session
  setConfirmDelete, profile, races, onCoachReviewRequest, onWeeklyReportPromptRequest,
}) {
  const t = useT();
  const isMobile = useIsMobile();
  const sectionTouch = useRef(null);
  const [viewMotionDir, setViewMotionDir] = useState(0);

  function changeView(nextView) {
    if (nextView === view) return;
    const order = { activities: 0, charts: 1 };
    setViewMotionDir((order[nextView] ?? 0) > (order[view] ?? 0) ? 1 : -1);
    setView(nextView);
  }

  function onSectionTouchStart(e) {
    if (!isMobile || e.touches.length !== 1 || shouldSkipSectionSwipe(e.target)) {
      sectionTouch.current = null;
      return;
    }
    const p = e.touches[0];
    sectionTouch.current = {
      x: p.clientX,
      y: p.clientY,
      t: e.timeStamp || 0,
      w: e.currentTarget?.clientWidth || window.innerWidth || 1,
      mode: null,
    };
  }

  function onSectionTouchMove(e) {
    if (!isMobile || e.touches.length !== 1 || !sectionTouch.current) return;
    const st = sectionTouch.current;
    const p = e.touches[0];
    const dx = p.clientX - st.x;
    const dy = p.clientY - st.y;
    if (st.mode == null) {
      if (Math.abs(dx) > Math.abs(dy) * 1.08 && Math.abs(dx) > 8) {
        const dir = dx < 0 ? 1 : -1;
        const canMove = (dir > 0 && view === "activities") || (dir < 0 && view === "charts");
        st.mode = canMove ? "inner" : "pass";
      } else if (Math.abs(dy) > 6 || Math.abs(dx) > 6) {
        st.mode = "scroll";
      } else {
        return;
      }
    }
    if (st.mode === "inner") {
      e.stopPropagation();
      e.preventDefault?.();
    }
  }

  function onSectionTouchEnd(e) {
    if (!isMobile || !sectionTouch.current) return;
    const st = sectionTouch.current;
    sectionTouch.current = null;
    if (st.mode !== "inner") {
      return;
    }
    const p = e.changedTouches?.[0];
    if (!p) return;
    const dx = p.clientX - st.x;
    const dy = p.clientY - st.y;
    const dt = Math.max(1, (e.timeStamp || 0) - (st.t || 0));
    const velocity = dx / dt;
    const threshold = Math.min((st.w || 1) * 0.16, 58);
    const shouldCommit = Math.abs(dx) >= threshold || Math.abs(velocity) > 0.38;
    if (!shouldCommit || Math.abs(dx) < Math.abs(dy) * 1.08) {
      return;
    }
    if (dx < 0 && view === "activities") {
      e.stopPropagation();
      changeView("charts");
    } else if (dx > 0 && view === "charts") {
      e.stopPropagation();
      changeView("activities");
    }
  }

  // Sticky stacking for the Activities view: nav rows (existing sticky) → stats
  // row → toolbar row all stay pinned at the top while only the list scrolls.
  // Activities keeps its controls, stats, and toolbar in one sticky block so
  // the four top rows do not move relative to each other while the list scrolls.
  const statsStickyHeight = isMobile ? 106 : 112;
  const toolbarTop = isMobile ? "calc(-1 * max(env(safe-area-inset-top), 14px))" : 0;

  // Activities / Charts must NOT include planned workouts (those live on the
  // Calendar tab only). Planned rows would inflate PR / weekly km / averages.
  const actualLogs = useMemo(() => logs.filter(l => !l.isPlanned), [logs]);

  // Whole-body smoothed ACWR (sRPE) — computed from ALL completed
  // activities, not the type-filtered set, since load is total stress. Recomputes
  // whenever the activity list changes (e.g. right after an import with RPE).
  const load = useMemo(() => computeTrainingLoad(actualLogs, new Date()), [actualLogs]);

  // The load strip — rendered inside the Activities sticky block (between the
  // toolbar and the list) so it pins with the stats and doesn't scroll away.
  const loadChipEl = load ? (
    <div title={t("training.load_hint")}
      style={{ display: "flex", alignItems: "center", gap: 6, padding: isMobile ? "7px 2px 3px" : "8px 2px 4px", fontSize: 12.5, flexWrap: "nowrap", borderTop: "1px solid var(--rule)", whiteSpace: "nowrap", overflow: "hidden" }}>
      <span style={{ ...s.muted, letterSpacing: "0.04em", fontSize: 11, flexShrink: 0 }}>{t("training.load_label")}</span>
      {load.building || load.acwr == null ? (
        <span style={{ ...s.muted }}>{t("training.load_building")}</span>
      ) : (
        <>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: RAMP_COLOR[load.ramp], flexShrink: 0 }} />
          <span style={{ fontFamily: "var(--font-mono)", color: "var(--ink-1)", flexShrink: 0 }}>ACWR {load.acwr.toFixed(2)}</span>
          <span style={{ ...s.muted, flexShrink: 0 }}>· {t(`training.ramp_${load.ramp}`)}</span>
          <span style={{ ...s.muted, marginLeft: "auto", fontSize: 11, fontFamily: "var(--font-mono)", flexShrink: 0 }}>
            {t("training.load_ac", { a: load.acute, c: load.chronicWeekly })}
          </span>
        </>
      )}
    </div>
  ) : null;

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
    { key: "distance", label: t("training.total_distance"), val: isMobile ? String(Math.round(periodKm)) : periodKm.toFixed(1), unit: "km" },
    { key: "ascent", label: t("training.total_ascent"), val: String(periodAscent), unit: "m" },
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

  const activitiesStickyHeader = (
    <>
      {isMobile ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <div style={{ flexShrink: 0 }}>
              <GlobalFilter filter={filter} setFilter={setFilter} compact />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <ViewToggle view={view} setView={changeView} t={t} />
            </div>
          </div>
          <PeriodSelector
            period={period} setPeriod={setPeriod}
            periodDropdown={periodDropdown} setPeriodDropdown={setPeriodDropdown}
            dense
            style={{ marginBottom: 8 }}
          />
        </>
      ) : (
        <>
          <GlobalFilter filter={filter} setFilter={setFilter} />
          <ViewToggle view={view} setView={changeView} t={t} style={{ marginBottom: 14 }} />
          <PeriodSelector
            period={period} setPeriod={setPeriod}
            periodDropdown={periodDropdown} setPeriodDropdown={setPeriodDropdown}
          />
        </>
      )}
      <div style={{
        display: "grid",
        gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(auto-fit, minmax(180px, 1fr))",
        gap: isMobile ? "6px 8px" : 0,
        marginBottom: 0,
        border: isMobile ? "none" : "1px solid var(--rule)",
        background: isMobile ? "var(--bg)" : "var(--bg-elevated)",
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
            {!isMobile && (
              <div style={{ position: "absolute", top: 10, right: 14, fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-3)" }}>
                {String(i + 1).padStart(2, "0")} / 04
              </div>
            )}
            <StatTile {...c} isMobile={isMobile} />
          </div>
        ))}
      </div>
    </>
  );

  const viewMotionClass = isMobile && viewMotionDir
    ? (viewMotionDir > 0 ? "ultreia-tab-in-right" : "ultreia-tab-in-left")
    : undefined;

  return (
    <div
      data-mobile-inner-swipe={isMobile ? "true" : undefined}
      data-swipe-prev={isMobile && view === "charts" ? "true" : "false"}
      data-swipe-next={isMobile && view === "activities" ? "true" : "false"}
      onTouchStart={onSectionTouchStart}
      onTouchMove={onSectionTouchMove}
      onTouchEnd={onSectionTouchEnd}
    >
      {view !== "activities" && (
      <div style={stickyHeaderStyle}>
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
                <ViewToggle view={view} setView={changeView} t={t} />
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
            <ViewToggle view={view} setView={changeView} t={t} style={{ marginBottom: 14 }} />
            {view === "activities" && (
              <PeriodSelector
                period={period} setPeriod={setPeriod}
                periodDropdown={periodDropdown} setPeriodDropdown={setPeriodDropdown}
              />
            )}
          </>
        )}
      </div>
      )}

      <div key={view} className={viewMotionClass}>
        {view === "activities" && (
          <>

            <ActivitiesTab
              logs={logs}
              addLog={addLog}
              updateLog={updateLog}
              bulkAddLogs={bulkAddLogs}
              periodLogs={periodLogs}
              setConfirmDelete={setConfirmDelete}
              profile={profile}
              toolbarStickyTop={toolbarTop}
              stickyHeader={activitiesStickyHeader}
              loadChip={loadChipEl}
              onCoachReviewRequest={onCoachReviewRequest}
              onWeeklyReportPromptRequest={onWeeklyReportPromptRequest}
            />
          </>
        )}

        {view === "charts" && (
          <ChartsTab filteredAllLogs={filteredAllLogs} filter={filter} races={races} />
        )}
      </div>
    </div>
  );
}
