// This file exports a few small date/label helpers (formatHeaderDate,
// logHeadline, todRank) alongside the modal component — CalendarTab imports
// them. Splitting them into a separate module would churn import sites for zero
// runtime benefit, so we disable the dev-only Fast-Refresh rule here (same call
// LanguageContext.jsx makes).
/* eslint-disable react-refresh/only-export-components */
import { useState, useRef } from "react";
import { s } from "../styles";
import { ACTIVITY_TYPES, DAILY_TAGS, DAILY_TAG_ICONS, RUN_GROUP_TYPES, STRENGTH_SUBS, TYPE_COLOR } from "../constants";
import { useT, useLanguage } from "../i18n/LanguageContext";
import { useIsMobile } from "../hooks/useMediaQuery";
import { formatDuration, timeOfDayToStartedAt, startedAtToTimeOfDay } from "../utils/format";
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
  // A planned session counts as DONE when explicitly marked done, or when any
  // completed workout exists on the same day (auto-reconciliation).
  const dayHasCompleted = logs.some(l => !l.isPlanned);
  function planOutcome(l) {
    if (!l.isPlanned) return null;
    if (l.planStatus === "skipped") return "skipped";
    if (l.planStatus === "done" || dayHasCompleted) return "done";
    return isPast ? "missed" : "pending";
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
  const [planDurationMin, setPlanDurationMin] = useState("");
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
  const planIsStrength = planType === "Strength";

  // Day-level tags live in dailyNotes — we toggle in-place. The Save is implicit:
  // each click calls setDailyTags() which upserts immediately. UI reflects the
  // latest state via the `note` prop the parent reloads after every mutation.
  const currentTags = note ? (note.tags || []) : [];
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
    setPlanDurationMin("");
    setPlanTimeOfDay("");
    setPlanSubTypes([]);
    setEditingId(null);
  }

  // Load an existing planned workout into the form for editing.
  function startEditPlan(l) {
    setEditingId(l.id);
    setPlanType(l.type);
    setPlanDistance(l.distance > 0 ? String(l.distance) : "");
    setPlanDurationMin(l.duration > 0 ? String(Math.round(l.duration / 60)) : "");
    setPlanTimeOfDay(startedAtToTimeOfDay(l.startedAt) || "");
    setPlanSubTypes(Array.isArray(l.subTypes) ? l.subTypes : []);
    setActionTarget(null);
    setPanel("plan");
  }

  async function savePlan() {
    const distNum = parseFloat(planDistance) || 0;
    const durSec = (parseFloat(planDurationMin) || 0) * 60;
    const subTypes = planIsStrength ? planSubTypes : [];
    // A strength plan is meaningful with just a picked area (e.g. "Core") even
    // without a duration; everything else still needs a distance or duration.
    if (distNum === 0 && durSec === 0 && subTypes.length === 0) {
      alert(t("calendar.plan_empty_warning"));
      return;
    }
    try {
      if (editingId) {
        // Edit mode: patch the existing planned row (stays is_planned=true).
        await updateLog(editingId, {
          type: planType,
          subTypes,
          distance: distNum,
          duration: Math.round(durSec),
          startedAt: timeOfDayToStartedAt(dateKey, planTimeOfDay),
        });
      } else {
        await addLog({
          date: dateKey,
          type: planType,
          subTypes,
          distance: distNum,
          duration: Math.round(durSec),
          pace: 0, hr: 0, maxHR: 0,
          ascent: 0, cadence: 0, aerobicTE: 0, gap: 0,
          startedAt: timeOfDayToStartedAt(dateKey, planTimeOfDay),
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
      className="ts-overlay-in"
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
        className="ts-modal-in"
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
                        {logHeadline(l)}
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
                      return (
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 7, flexWrap: "wrap" }}>
                          {outcome === "done" && badge("var(--moss)", `✓ ${t("calendar.plan_done")}`)}
                          {outcome === "skipped" && badge("var(--ink-3)", t("calendar.plan_skipped"))}
                          {outcome === "missed" && badge("#b07a3e", t("calendar.plan_missed"))}
                          {outcome === "missed" && miniBtn(`✓ ${t("calendar.plan_mark_done")}`, () => setPlanStatus(l.id, "done"))}
                          {outcome === "missed" && miniBtn(t("calendar.plan_mark_skip"), () => setPlanStatus(l.id, "skipped"))}
                          {(l.planStatus === "done" || l.planStatus === "skipped") && miniBtn(t("calendar.plan_reset"), () => setPlanStatus(l.id, "pending"))}
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
            {isFuture && (
              <button onClick={() => setPanel("plan")}
                style={{ ...s.btnGhost, fontSize: 12, padding: "6px 12px", marginTop: 10 }}>
                {t("calendar.add_short")}
              </button>
            )}
          </div>
        ) : (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            gap: 10, flexWrap: "wrap", padding: "16px 0 18px",
          }}>
            <span style={{ color: "var(--ink-3)", fontSize: 13, fontFamily: "var(--font-mono)" }}>
              {isFuture ? t("calendar.empty_future") : t("calendar.empty_past")}
            </span>
            {isFuture && (
              <button onClick={() => setPanel("plan")}
                style={{ ...s.btn, fontSize: 12, padding: "6px 14px" }}>
                {t("calendar.add_short")}
              </button>
            )}
          </div>
        )}

        {/* Day-level tags — available for past, today AND future days (e.g.
            pre-tag a known travel day). "Poor sleep" is hidden on future days
            since it hasn't happened yet. Each click upserts immediately. */}
        {(
          <div style={{ borderTop: "1px solid var(--rule)", paddingTop: 14, marginBottom: 14 }}>
            <div style={{ ...s.label, marginBottom: 8 }}>
              {t("calendar.day_tags_title")}
            </div>
            {/* 3-column grid → 2 rows. Row 1: massage / stretching / sick.
                Row 2: travel (left) + poor_sleep (right, spans 2 cols so
                "(last night)" fits one line). On future days poor_sleep is
                dropped, leaving travel alone on row 2. */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
              {DAILY_TAGS
                .filter(tag => !(isFuture && tag === "poor_sleep"))
                // poor_sleep renders after travel so it lands to travel's right.
                .sort((a, b) => Number(a === "poor_sleep") - Number(b === "poor_sleep"))
                .map(tag => (
                <button key={tag}
                  onClick={() => toggleDayTag(tag)}
                  style={{
                    ...s.chip(currentTags.includes(tag)),
                    width: "100%", minHeight: 0, padding: "8px 6px",
                    fontSize: 12, lineHeight: 1.25, textAlign: "center",
                    whiteSpace: "nowrap",
                    gridColumn: (tag === "poor_sleep" && !isFuture) ? "span 2" : undefined,
                  }}>
                  {DAILY_TAG_ICONS[tag] ? `${DAILY_TAG_ICONS[tag]} ` : ""}{t(`calendar.tag.${tag}`)}
                </button>
              ))}
            </div>
            {/* Travel destination — where are you going? Fed to the coach + push
                so it can suggest local running and reference the trip. */}
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
                  {RUN_GROUP_TYPES.includes(planType) && (
                    <div>
                      <div style={{ ...s.muted, fontSize: 11, marginBottom: 4 }}>{t("form.distance")} (km)</div>
                      <input type="number" step="0.1" min="0" value={planDistance}
                        onChange={e => setPlanDistance(e.target.value)}
                        placeholder="e.g. 8"
                        style={{ ...s.input, padding: "8px 10px", fontSize: 14 }} />
                    </div>
                  )}
                  <div>
                    <div style={{ ...s.muted, fontSize: 11, marginBottom: 4 }}>{t("form.duration")} ({t("form.minutes")})</div>
                    <input type="number" step="1" min="0" value={planDurationMin}
                      onChange={e => setPlanDurationMin(e.target.value)}
                      placeholder="e.g. 45"
                      style={{ ...s.input, padding: "8px 10px", fontSize: 14 }} />
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
                </div>
                {/* Strength: which area(s) — so an imported "Strength" plan shows
                    Upper / Lower / Core instead of a bare label. */}
                {planIsStrength && (
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
