// This file exports a few small date/label helpers (formatHeaderDate,
// logHeadline, todRank) alongside the modal component — CalendarTab imports
// them. Splitting them into a separate module would churn import sites for zero
// runtime benefit, so we disable the dev-only Fast-Refresh rule here (same call
// LanguageContext.jsx makes).
/* eslint-disable react-refresh/only-export-components */
import { useState, useRef } from "react";
import { s } from "../styles";
import { ACTIVITY_TYPES, DAILY_TAGS, DAILY_TAG_ICONS, RUN_GROUP_TYPES, RUN_PACE_TYPES, STRENGTH_SUBS, TYPE_COLOR } from "../constants";
import { useT, useLanguage } from "../i18n/LanguageContext";
import { useIsMobile } from "../hooks/useMediaQuery";
import { formatDuration, formatPlanDuration, timeOfDayToStartedAt, startedAtToTimeOfDay } from "../utils/format";
import { evaluatePlanOutcome } from "../utils/planMatch";

// Per-type plan field visibility — which inputs the add/edit-plan form shows for
// a given activity type (time-of-day is always shown). Mirrored in
// CoachPlanImportModal so a plan reads the same wherever it's edited.
//   Road Run        → run type + distance
//   Trail / Hiking  → distance + ascent
//   Floor Climbing  → ascent
//   Cycling         → distance + speed
//   Swimming        → duration
//   Strength        → body area(s)
//   HIIT            → time-of-day only
export function planFields(type) {
  return {
    runType:  type === "Road Run",
    distance: type === "Road Run" || type === "Trail Run" || type === "Hiking" || type === "Cycling",
    ascent:   type === "Trail Run" || type === "Hiking" || type === "Floor Climbing",
    speed:    type === "Cycling",
    duration: type === "Swimming",
    strength: type === "Strength",
  };
}

// Compact target readout for a PLANNED row, by type. Mirrors planFields so the
// row shows exactly what the user planned (never a spurious "00s").
export function planHeadline(l, t) {
  const f = planFields(l.type);
  const parts = [];
  if (f.distance && l.distance > 0) parts.push(`${l.distance} km`);
  if (f.ascent && l.ascent > 0) parts.push(`+${l.ascent} m`);
  if (f.speed && l.planDetail?.speed > 0) parts.push(`${l.planDetail.speed} km/h`);
  if (f.duration && l.duration > 0) parts.push(formatPlanDuration(l.duration));
  if (f.strength) {
    const d = l.planDetail?.subTypeDurations;
    if (d && typeof d === "object") {
      const segs = (l.subTypes || [])
        .filter(a => d[a] > 0)
        .map(a => `${t(`enum.subtype.${a}`)} ${d[a]}m`);
      if (segs.length) parts.push(segs.join(" · "));
      else if (l.duration > 0) parts.push(formatPlanDuration(l.duration));
    } else if (l.duration > 0) parts.push(formatPlanDuration(l.duration));
  }
  return parts.join(" · ") || "—";
}
import { skyconMeta } from "../lib/weather";
import { ModalRoot } from "./ModalRoot";
import { ItemActionModal } from "./ItemActionModal";
import { Dropdown } from "./Dropdown";

// Pretty header date: "Thu, May 21 2026" / "5月21日 周四 2026"
export function formatHeaderDate(yyyy_mm_dd, lang) {
  const [y, m, d] = yyyy_mm_dd.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  if (lang === "zh") {
    const wk = ["日", "一", "二", "三", "四", "五", "六"][dt.getDay()];
    return `${y} 年 ${m} 月 ${d} 日 · 周${wk}`;
  }
  const wkEn = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dt.getDay()];
  const monEn = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1];
  return `${wkEn}, ${monEn} ${d} ${y}`;
}

// Order workouts within a day: AM on top, PM at the bottom, untimed in between.
const TOD_RANK = { am: 0, pm: 2 };
export function todRank(l) {
  const tod = startedAtToTimeOfDay(l.startedAt);
  return tod ? TOD_RANK[tod] : 1;
}

export function logHeadline(log) {
  if (RUN_GROUP_TYPES.includes(log.type) && log.distance > 0) {
    return `${log.distance} km${log.duration > 0 ? " · " + formatDuration(log.duration) : ""}`;
  }
  if (log.duration > 0) return formatDuration(log.duration);
  return "—";
}

// Two-line weather: feels / temp / humidity, then sky / wind / AQI.
function weatherLines(w, lang) {
  if (!w) return null;
  const zh = lang === "zh";
  const apparent = w.apparentC ?? w.apparentAvgC;
  const l1 = [];
  if (Number.isFinite(apparent)) l1.push(`${zh ? "体感" : "feels"} ${Math.round(apparent)}°`);
  if (Number.isFinite(w.tempC)) l1.push(`${zh ? "温度" : "temp"} ${Math.round(w.tempC)}°`);
  else if (Number.isFinite(w.tempMaxC) && Number.isFinite(w.tempMinC)) l1.push(`${Math.round(w.tempMinC)}–${Math.round(w.tempMaxC)}°`);
  else if (Number.isFinite(w.tempAvgC)) l1.push(`${zh ? "温度" : "temp"} ${Math.round(w.tempAvgC)}°`);
  if (Number.isFinite(w.humidity)) {
    const rh = w.humidity > 1 ? Math.round(w.humidity) : Math.round(w.humidity * 100);
    l1.push(`${zh ? "湿度" : "RH"} ${rh}%`);
  }
  const sky = w.skycon ? skyconMeta(w.skycon, lang) : null;
  const l2 = [];
  if (sky) l2.push(sky.label);
  if (Number.isFinite(w.windSpeed) && w.windSpeed >= 1) l2.push(`${zh ? "风" : "wind"} ${Math.round(w.windSpeed)}km/h`);
  if (Number.isFinite(w.aqi) && w.aqi > 0) l2.push(`AQI ${w.aqi}`);
  return { l1: l1.join(" · "), l2: l2.join(" · "), icon: sky?.icon };
}

const navBtn = {
  flexShrink: 0, width: 38, height: 38, minHeight: 38,
  border: "1px solid var(--rule)", borderRadius: 8,
  background: "var(--bg-elevated)", color: "var(--ink-1)",
  fontSize: 20, lineHeight: 1, cursor: "pointer",
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  WebkitTapHighlightColor: "transparent",
};

export function CalendarDayModal({
  dateKey, isFuture, isToday, logs, note, weather, onClose, onPrev, onNext,
  addLog, updateLog, setConfirmDelete, setDailyTags, setReadiness,
}) {
  const t = useT();
  const { lang } = useLanguage();
  const isMobile = useIsMobile();
  const isPast = !isFuture && !isToday;
  // A planned session is reconciled against the SAME-TYPE completed workouts on
  // this day, comparing the planned target (distance / ascent / duration) to
  // what was actually done — see evaluatePlanOutcome. An explicit planStatus
  // (the "did it" / "skip" buttons below) always wins.
  function planOutcome(l) {
    return evaluatePlanOutcome(l, logs, { isPast }).outcome;
  }
  function setPlanStatus(id, status) {
    updateLog(id, { planStatus: status }).catch(() => {});
  }
  const readiness = note?.readiness || null;
  function setReadinessField(field, val) {
    const cur = readiness || {};
    setReadiness(dateKey, { sleep: cur.sleep ?? null, legs: cur.legs ?? null, energy: cur.energy ?? null, [field]: val });
  }

  // Single open panel — keeps the modal short.
  // null | 'plan'
  const [panel, setPanel] = useState(null);

  // ── Plan form state. Used both to add a new plan (future days) and to edit
  // an existing planned workout. editingId is null in add mode, the log id in
  // edit mode (Save then calls updateLog instead of addLog). ──
  const [planType, setPlanType] = useState("Road Run");
  const [planDistance, setPlanDistance] = useState("");
  const [planAscent, setPlanAscent] = useState("");        // trail/hiking/floor-climbing target ascent (m)
  const [planSpeed, setPlanSpeed] = useState("");          // cycling target speed (km/h) → plan_detail.speed
  const [planDurationMin, setPlanDurationMin] = useState(""); // swimming target (min)
  const [planRunType, setPlanRunType] = useState("");      // Road Run: Easy/Aerobic/Tempo/Interval
  const [planTimeOfDay, setPlanTimeOfDay] = useState(""); // "" | "am" | "pm"
  const [planSubTypes, setPlanSubTypes] = useState([]);   // strength: Upper/Lower/Core
  const [editingId, setEditingId] = useState(null);
  // Long-press a workout row → a centered Edit/Delete action card (same
  // pattern as the Training list's ItemActionModal). actionTarget = the log.
  const [actionTarget, setActionTarget] = useState(null);
  const pressTimer = useRef(null);
  function startRowPress(l) {
    clearTimeout(pressTimer.current);
    pressTimer.current = setTimeout(() => setActionTarget(l), 450);
  }
  function cancelRowPress() { clearTimeout(pressTimer.current); }
  const planF = planFields(planType);

  // Day-level tags live in dailyNotes — we toggle in-place. The Save is implicit:
  // each click calls setDailyTags() which upserts immediately. UI reflects the
  // latest state via the `note` prop the parent reloads after every mutation.
  const currentTags = note ? (note.tags || []) : [];
  const hasPlannedRest = currentTags.includes("planned_rest");
  function toggleDayTag(tag) {
    const next = currentTags.includes(tag)
      ? currentTags.filter(x => x !== tag)
      : [...currentTags, tag];
    setDailyTags(dateKey, next).catch(() => { /* alerted by wrapper */ });
  }

  function togglePlanSub(sub) {
    setPlanSubTypes(prev => prev.includes(sub) ? prev.filter(x => x !== sub) : [...prev, sub]);
  }

  function resetPlanForm() {
    setPlanType("Road Run");
    setPlanDistance("");
    setPlanAscent("");
    setPlanSpeed("");
    setPlanDurationMin("");
    setPlanRunType("");
    setPlanTimeOfDay("");
    setPlanSubTypes([]);
    setEditingId(null);
  }

  // Load an existing planned workout into the form for editing.
  function startEditPlan(l) {
    setEditingId(l.id);
    setPlanType(l.type);
    setPlanDistance(l.distance > 0 ? String(l.distance) : "");
    setPlanAscent(l.ascent > 0 ? String(l.ascent) : "");
    setPlanSpeed(l.planDetail?.speed > 0 ? String(l.planDetail.speed) : "");
    setPlanDurationMin(l.duration > 0 ? String(Math.round(l.duration / 60)) : "");
    const subs = Array.isArray(l.subTypes) ? l.subTypes : [];
    setPlanRunType(l.type === "Road Run" ? (subs.find(s => RUN_PACE_TYPES.includes(s)) || "") : "");
    setPlanTimeOfDay(startedAtToTimeOfDay(l.startedAt) || "");
    setPlanSubTypes(subs);
    setActionTarget(null);
    setPanel("plan");
  }

  function needsBackfillConfirm() {
    if (editingId) return false;
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    if (dateKey < todayKey) return true;
    return dateKey === todayKey && today.getHours() >= 12 && planTimeOfDay === "am";
  }

  async function savePlan() {
    const f = planFields(planType);
    // Assemble the type-specific fields. Everything not shown for this type
    // stays zero/empty so switching type then saving doesn't carry stale values.
    const distNum = f.distance ? (parseFloat(planDistance) || 0) : 0;
    const ascNum = f.ascent ? Math.round(parseFloat(planAscent) || 0) : 0;
    const speedNum = f.speed ? (parseFloat(planSpeed) || 0) : 0;
    let durSec = f.duration ? (parseFloat(planDurationMin) || 0) * 60 : 0;
    let subTypes = [];
    let planDetail = null;
    if (f.runType) {
      subTypes = planRunType ? [planRunType] : [];
    } else if (f.strength) {
      subTypes = planSubTypes;
    }
    if (f.speed && speedNum > 0) planDetail = { ...(planDetail || {}), speed: speedNum };

    // HIIT is valid with nothing but a time-of-day; every other type needs at
    // least one target so the plan means something.
    const hasTarget = distNum > 0 || ascNum > 0 || speedNum > 0 || durSec > 0 || subTypes.length > 0;
    if (planType !== "HIIT" && !hasTarget) {
      alert(t("calendar.plan_empty_warning"));
      return;
    }
    if (needsBackfillConfirm() && !window.confirm(t("calendar.plan_backfill_confirm"))) return;
    const payload = {
      type: planType,
      subTypes,
      distance: distNum,
      ascent: ascNum,
      duration: Math.round(durSec),
      planDetail,
      startedAt: timeOfDayToStartedAt(dateKey, planTimeOfDay),
    };
    try {
      if (editingId) {
        // Edit mode: patch the existing planned row (stays is_planned=true).
        await updateLog(editingId, payload);
      } else {
        await addLog({
          date: dateKey,
          ...payload,
          pace: 0, hr: 0, maxHR: 0, cadence: 0, aerobicTE: 0, gap: 0,
          isPlanned: true,
          tags: [],
        }, { source: "calendar_plan" });
      }
      resetPlanForm();
      setPanel(null);
    } catch { /* alert shown by wrapper */ }
  }

  function deleteLog(logId) {
    setConfirmDelete({ type: "log", id: logId });
    onClose();
  }

  const headerDate = formatHeaderDate(dateKey, lang);

  return (
    <ModalRoot onClose={onClose}>
    <div
      onClick={onClose}
      className="ultreia-overlay-in"
      style={{
        position: "fixed", inset: 0,
        background: "rgba(20,20,19,0.45)",
        backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 9999, padding: 16, overscrollBehavior: "contain",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="ultreia-modal-in"
        style={{
          background: "var(--bg)",
          border: "1px solid var(--rule)",
          borderRadius: 12,
          boxShadow: "0 18px 50px rgba(0,0,0,0.25)",
          width: "100%", maxWidth: 460,
          maxHeight: "calc(100dvh - 32px)",
          overflowY: "auto",
          padding: isMobile ? "16px 18px calc(env(safe-area-inset-bottom) + 20px)" : "20px 24px 22px",
          fontFamily: "var(--font-sans)",
        }}
      >
        {/* Header: ‹  centered date  ›  + close */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
          {onPrev && (
            <button onClick={onPrev} aria-label={lang === "zh" ? "前一天" : "Previous day"} style={navBtn}>‹</button>
          )}
          <div style={{ flex: 1, textAlign: "center", minWidth: 0 }}>
            <div style={{
              fontFamily: "var(--font-mono)", fontSize: 10,
              color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.06em",
              marginBottom: 2,
            }}>
              {isFuture ? t("calendar.day_future") : t("calendar.day_past")}
            </div>
            <div style={{ fontSize: 16, fontWeight: 600, color: "var(--ink-1)" }}>
              {headerDate}
            </div>
          </div>
          {onNext && (
            <button onClick={onNext} aria-label={lang === "zh" ? "后一天" : "Next day"} style={navBtn}>›</button>
          )}
          <button onClick={onClose} style={{
            background: "none", border: "none", fontSize: 22,
            color: "var(--ink-3)", cursor: "pointer", padding: "0 2px", marginLeft: 2,
          }} aria-label="Close">×</button>
        </div>

        <div style={{ height: 1, background: "var(--rule)", margin: "14px 0 16px" }} />

        {/* Weather summary — single line at the top. For future days this is
            the daily forecast (passed down from CalendarTab); for past days
            with logged workouts, the parent passes the first workout's
            snapshot. Hidden when no source is available (no location, or
            past day with no logged weather). */}
        {(() => {
          const wl = weatherLines(weather, lang);
          if (!wl || (!wl.l1 && !wl.l2)) return null;
          return (
            <div style={{
              display: "flex", alignItems: "center", gap: 12,
              marginBottom: 16, padding: "10px 12px",
              background: "var(--bg-elevated)", border: "1px solid var(--rule)", borderRadius: 8,
            }}>
              {wl.icon && <span style={{ fontSize: 26 }} aria-hidden="true">{wl.icon}</span>}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--ink-1)", fontVariantNumeric: "tabular-nums" }}>{wl.l1 || "—"}</div>
                {wl.l2 && <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-3)", marginTop: 3 }}>{wl.l2}</div>}
              </div>
            </div>
          );
        })()}

        {/* Existing workouts on this day */}
        {logs.length > 0 ? (
          <div style={{ marginBottom: 18 }}>
            <div style={{ ...s.label, marginBottom: 8 }}>
              {t("calendar.day_logs_title")}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[...logs].sort((a, b) => todRank(a) - todRank(b)).map(l => {
                const color = TYPE_COLOR[l.type] || "var(--ink-2)";
                return (
                  <div key={l.id}
                    onPointerDown={() => startRowPress(l)}
                    onPointerUp={cancelRowPress}
                    onPointerLeave={cancelRowPress}
                    onPointerCancel={cancelRowPress}
                    onContextMenu={e => e.preventDefault()}
                    style={{
                    border: "1px solid var(--rule)",
                    borderLeft: `3px ${l.isPlanned ? "dashed" : "solid"} ${color}`,
                    padding: "10px 12px",
                    background: l.isPlanned ? "var(--bg-elevated)" : "var(--bg)",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <div style={{ ...s.tag(l.type), fontSize: 11 }}>
                        {t(`enum.activity.${l.type}`)}
                      </div>
                      {/* Strength area(s) + AM/PM so a plan reads "Strength · Core · AM". */}
                      {Array.isArray(l.subTypes) && l.subTypes.length > 0 && (
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-2)" }}>
                          {l.subTypes.map(st => t(`enum.subtype.${st}`)).join(" · ")}
                        </div>
                      )}
                      {(() => {
                        const tod = startedAtToTimeOfDay(l.startedAt);
                        return tod ? (
                          <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-3)", letterSpacing: "0.06em" }}>
                            {t(tod === "am" ? "calendar.plan_tod_am" : "calendar.plan_tod_pm")}
                          </div>
                        ) : null;
                      })()}
                      <div style={{
                        fontFamily: "var(--font-mono)", fontSize: 13,
                        color: "var(--ink-2)", fontVariantNumeric: "tabular-nums",
                      }}>
                        {l.isPlanned ? planHeadline(l, t) : logHeadline(l)}
                      </div>
                    </div>
                    {/* Plan reconciliation — past plans show their outcome and a
                        one-tap resolve, so the user never has to delete a past
                        plan to keep the calendar clean. */}
                    {(() => {
                      const outcome = planOutcome(l);
                      if (!outcome || outcome === "pending") return null;
                      const badge = (color, txt) => (
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color, letterSpacing: "0.04em" }}>{txt}</span>
                      );
                      const miniBtn = (txt, onClick) => (
                        <button onClick={onClick} style={{ ...s.btnGhost, minHeight: 0, padding: "3px 9px", fontSize: 11 }}>{txt}</button>
                      );
                      // missed + partial can be manually accepted as done.
                      // Explicit done shows an undo; "skip" is no longer a
                      // separate status because it overlapped with missed.
                      const resolvable = outcome === "missed" || outcome === "partial";
                      return (
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 7, flexWrap: "wrap" }}>
                          {outcome === "done" && badge("var(--moss)", `✓ ${t("calendar.plan_done")}`)}
                          {outcome === "partial" && badge("#b07a3e", t("calendar.plan_partial"))}
                          {outcome === "missed" && badge("#b07a3e", t("calendar.plan_missed"))}
                          {resolvable && miniBtn(`✓ ${t("calendar.plan_mark_done")}`, () => setPlanStatus(l.id, "done"))}
                          {l.planStatus === "done" && miniBtn(t("calendar.plan_reset"), () => setPlanStatus(l.id, "pending"))}
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
            <button onClick={() => setPanel("plan")}
              style={{ ...s.btnGhost, fontSize: 12, padding: "6px 12px", marginTop: 10 }}>
              {t("calendar.add_short")}
            </button>
          </div>
        ) : (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            gap: 10, flexWrap: "wrap", padding: "16px 0 18px",
          }}>
            <span style={{ color: "var(--ink-3)", fontSize: 13, fontFamily: "var(--font-mono)" }}>
              {hasPlannedRest ? t("calendar.empty_planned_rest") : (isFuture ? t("calendar.empty_future") : t("calendar.empty_past"))}
            </span>
            <button onClick={() => setPanel("plan")}
              style={{ ...s.btn, fontSize: 12, padding: "6px 14px" }}>
              {t("calendar.add_short")}
            </button>
          </div>
        )}

        {/* Day-level tags — available for past, today AND future days. Each
            click upserts immediately. */}
        {(
          <div style={{ borderTop: "1px solid var(--rule)", paddingTop: 14, marginBottom: 14 }}>
            <div style={{ ...s.label, marginBottom: 8 }}>
              {t("calendar.day_tags_title")}
            </div>
            {/* 2-column grid: planned rest / massage / stretching / sick. Retired tags such
                as poor_sleep/travel are no longer rendered as toggles. */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6 }}>
              {DAILY_TAGS.map(tag => (
                <button key={tag}
                  onClick={() => toggleDayTag(tag)}
                  style={{
                    ...s.chip(currentTags.includes(tag)),
                    width: "100%", minHeight: 0, padding: "8px 6px",
                    fontSize: 12, lineHeight: 1.25, textAlign: "center",
                    whiteSpace: "nowrap",
                  }}>
                  {DAILY_TAG_ICONS[tag] ? `${DAILY_TAG_ICONS[tag]} ` : ""}{t(`calendar.tag.${tag}`)}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Morning readiness self-check — only for today / past (future hasn't
            happened). One tap per field; tapping the active level clears it.
            Feeds the coach so it can judge "push or back off today". */}
        {!isFuture && (
          <div style={{ borderTop: "1px solid var(--rule)", paddingTop: 14, marginBottom: 14 }}>
            <div style={{ ...s.label, marginBottom: 8 }}>{t("calendar.readiness_title")}</div>
            {[["sleep", "calendar.readiness_sleep"], ["legs", "calendar.readiness_legs"], ["energy", "calendar.readiness_energy"]].map(([field, key]) => (
              <div key={field} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ ...s.muted, fontSize: 12, width: 64, flexShrink: 0 }}>{t(key)}</span>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, flex: 1 }}>
                  {[1, 2, 3].map(v => (
                    <button key={v}
                      onClick={() => setReadinessField(field, (readiness?.[field] === v) ? null : v)}
                      style={{ ...s.chip((readiness?.[field] || null) === v), minHeight: 0, padding: "6px 4px", fontSize: 12, whiteSpace: "nowrap" }}>
                      {t(`calendar.readiness_lvl_${v}`)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Long-press action sheet for a workout row — Edit (plans only) + Delete.
            Mirrors the Training list's long-press pattern. Portals to body. */}
        {actionTarget && (
          <ItemActionModal
            title={t(`enum.activity.${actionTarget.type}`)}
            onEdit={actionTarget.isPlanned ? () => startEditPlan(actionTarget) : undefined}
            onDelete={() => { const id = actionTarget.id; setActionTarget(null); deleteLog(id); }}
            onClose={() => setActionTarget(null)}
          />
        )}

        {/* Plan add/edit form — a modal over the day modal (ModalRoot portals
            it to body, so it floats above this card). */}
        {panel === "plan" && (
          <ModalRoot onClose={() => { setPanel(null); resetPlanForm(); }}>
            <div style={s.modalOverlay(isMobile, { float: true })} onClick={() => { setPanel(null); resetPlanForm(); }}>
              <div style={s.modalCard(isMobile, { maxWidth: 460, float: true })} onClick={e => e.stopPropagation()}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <h2 style={{ fontSize: 18, fontWeight: 500, margin: 0 }}>
                    {editingId ? t("calendar.edit_plan_title") : t("calendar.add_plan_title")}
                  </h2>
                  <button onClick={() => { setPanel(null); resetPlanForm(); }} style={s.modalCloseBtn} aria-label="Close">×</button>
                </div>
                {/* Type + time-of-day are shown for every activity; the metric
                    inputs below switch per type (see planFields). */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                  <div>
                    <div style={{ ...s.muted, fontSize: 11, marginBottom: 4 }}>{t("form.type")}</div>
                    <Dropdown
                      ariaLabel={t("form.type")}
                      options={ACTIVITY_TYPES.map(at => ({ value: at, label: t(`enum.activity.${at}`) }))}
                      value={planType}
                      onChange={setPlanType}
                    />
                  </div>
                  <div>
                    <div style={{ ...s.muted, fontSize: 11, marginBottom: 4 }}>{t("calendar.plan_time_of_day")}</div>
                    <Dropdown
                      ariaLabel={t("calendar.plan_time_of_day")}
                      options={[
                        { value: "", label: t("calendar.plan_tod_any") },
                        { value: "am", label: t("calendar.plan_tod_am") },
                        { value: "pm", label: t("calendar.plan_tod_pm") },
                      ]}
                      value={planTimeOfDay}
                      onChange={setPlanTimeOfDay}
                    />
                  </div>
                  {planF.distance && (
                    <div>
                      <div style={{ ...s.muted, fontSize: 11, marginBottom: 4 }}>{t("form.distance")} (km)</div>
                      <input type="number" step="0.1" min="0" value={planDistance}
                        onChange={e => setPlanDistance(e.target.value)}
                        placeholder="e.g. 8"
                        style={{ ...s.input, padding: "8px 10px", fontSize: 14 }} />
                    </div>
                  )}
                  {planF.ascent && (
                    <div>
                      <div style={{ ...s.muted, fontSize: 11, marginBottom: 4 }}>{t("calendar.plan_ascent")} (m)</div>
                      <input type="number" step="10" min="0" value={planAscent}
                        onChange={e => setPlanAscent(e.target.value)}
                        placeholder="e.g. 600"
                        style={{ ...s.input, padding: "8px 10px", fontSize: 14 }} />
                    </div>
                  )}
                  {planF.speed && (
                    <div>
                      <div style={{ ...s.muted, fontSize: 11, marginBottom: 4 }}>{t("calendar.plan_speed")} (km/h)</div>
                      <input type="number" step="0.5" min="0" value={planSpeed}
                        onChange={e => setPlanSpeed(e.target.value)}
                        placeholder="e.g. 25"
                        style={{ ...s.input, padding: "8px 10px", fontSize: 14 }} />
                    </div>
                  )}
                  {planF.duration && (
                    <div>
                      <div style={{ ...s.muted, fontSize: 11, marginBottom: 4 }}>{t("form.duration")} ({t("form.minutes")})</div>
                      <input type="number" step="1" min="0" value={planDurationMin}
                        onChange={e => setPlanDurationMin(e.target.value)}
                        placeholder="e.g. 45"
                        style={{ ...s.input, padding: "8px 10px", fontSize: 14 }} />
                    </div>
                  )}
                  {planF.runType && (
                    <div style={{ gridColumn: "1 / -1" }}>
                      <div style={{ ...s.muted, fontSize: 11, marginBottom: 6 }}>{t("calendar.plan_run_type")}</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {RUN_PACE_TYPES.map(rt => (
                          <button key={rt} type="button"
                            onClick={() => setPlanRunType(planRunType === rt ? "" : rt)}
                            style={{ ...s.chip(planRunType === rt), minHeight: 0, padding: "6px 12px", fontSize: 13 }}>
                            {t(`enum.subtype.${rt}`)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                {/* Strength: area(s). */}
                {planF.strength && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ ...s.muted, fontSize: 11, marginBottom: 6 }}>{t("calendar.plan_strength_area")}</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {STRENGTH_SUBS.map(sub => (
                        <button key={sub} type="button" onClick={() => togglePlanSub(sub)}
                          style={{ ...s.chip(planSubTypes.includes(sub)), minHeight: 0, padding: "6px 12px", fontSize: 13 }}>
                          {t(`enum.subtype.${sub}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button onClick={() => { setPanel(null); resetPlanForm(); }} style={s.btnGhost}>
                    {t("common.cancel")}
                  </button>
                  <button onClick={savePlan} style={s.btn}>
                    {t("calendar.save_plan")}
                  </button>
                </div>
              </div>
            </div>
          </ModalRoot>
        )}
      </div>
    </div>
    </ModalRoot>
  );
}
