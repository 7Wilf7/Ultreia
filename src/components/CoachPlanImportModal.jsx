import { useState } from "react";
import { s } from "../styles";
import { ACTIVITY_TYPES, RUN_PACE_TYPES, STRENGTH_SUBS, TYPE_COLOR } from "../constants";
import { useT } from "../i18n/LanguageContext";
import { useIsMobile } from "../hooks/useMediaQuery";
import { timeOfDayToStartedAt } from "../utils/format";
import { buildCreatePlansAction, describeCreatePlansImpact, getCreatePlans, getPlanTargetId, isPlanUpdateItem, isRestPlanItem } from "../utils/agentActions";
import { planFields } from "../utils/planFields";
import { ModalRoot } from "./ModalRoot";
import { Dropdown } from "./Dropdown";
import { useAppDialog } from "./AppDialogContext";

// Each row in the modal is a draft proposal — user can toggle, edit, or
// remove. Internal `_id` keeps React's key stable; `_selected` drives the
// checkbox. Both strip off when we hand off to bulkAddLogs. Fields shown per
// type mirror planFields (the Calendar add-plan form).
function buildDraft(p, idx) {
  if (isRestPlanItem(p)) {
    return {
      _id: `proposal-${idx}`,
      _selected: true,
      kind: "rest",
      date: p.date || "",
      type: "Rest",
      notes: p.notes || "",
    };
  }
  const type = ACTIVITY_TYPES.includes(p.type) ? p.type : "Road Run";
  const f = planFields(type);
  const subs = Array.isArray(p.subTypes) ? p.subTypes : [];
  const targetPlanId = getPlanTargetId(p);
  return {
    _id: `proposal-${idx}`,
    _selected: true,
    action: targetPlanId ? "update" : "create",
    targetPlanId,
    date: p.date || "",
    type,
    distance: f.distance && p.distance != null ? String(p.distance) : "",
    ascent: f.ascent && p.ascent != null ? String(p.ascent) : "",
    speed: f.speed && p.speed != null ? String(p.speed) : "",
    durationMin: f.duration && p.duration != null ? String(p.duration) : "",
    runType: f.runType ? (subs.find(st => RUN_PACE_TYPES.includes(st)) || "") : "",
    subTypes: f.strength ? subs.filter(st => STRENGTH_SUBS.includes(st)) : [],
    timeOfDay: (p.timeOfDay === "am" || p.timeOfDay === "pm") ? p.timeOfDay : "",
    notes: p.notes || "",
  };
}

function compactDateLabel(date) {
  const m = String(date || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[2]}-${m[3]}` : (date || "—");
}

function parseAscentMeters(notes) {
  const m = String(notes || "").match(/\+?\s*(\d+(?:\.\d+)?)\s*m\b/i);
  const n = m ? Number(m[1]) : 0;
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function planSummary(it, t) {
  if (isRestPlanItem(it)) {
    const bits = [compactDateLabel(it.date), t("calendar.planned_rest_label")];
    if (it.notes) bits.push(it.notes);
    return bits.filter(Boolean).join(" · ");
  }
  const bits = [compactDateLabel(it.date), t(`enum.activity.${it.type}`)];
  if (it.runType) bits.push(t(`enum.subtype.${it.runType}`));
  if ((it.subTypes || []).length) bits.push(it.subTypes.map(st => t(`enum.subtype.${st}`)).join(" / "));
  if (it.distance) bits.push(`${it.distance} km`);
  if (it.ascent) bits.push(`+${it.ascent} m`);
  if (it.speed) bits.push(`${it.speed} km/h`);
  if (it.durationMin) bits.push(`${it.durationMin} ${t("form.minutes")}`);
  if (it.timeOfDay) bits.push(t(`calendar.plan_tod_${it.timeOfDay}`));
  return bits.filter(Boolean).join(" · ");
}

export function CoachPlanImportModal({ plans = [], action = null, existingPlans = [], onConfirm, onCancel, onReject, onReExtract }) {
  const t = useT();
  const appDialog = useAppDialog();
  const isMobile = useIsMobile();
  const agentAction = action || buildCreatePlansAction(plans);
  const actionPlans = getCreatePlans(agentAction);
  const [items, setItems] = useState(() => actionPlans.map(buildDraft));
  const [importing, setImporting] = useState(false);

  function patch(id, p) {
    setItems(items.map(it => it._id === id ? { ...it, ...p } : it));
  }
  function remove(id) {
    setItems(items.filter(it => it._id !== id));
  }

  const selectedCount = items.filter(it => it._selected).length;
  const selectedItems = items.filter(it => it._selected);
  const previewAction = buildCreatePlansAction(selectedItems, {
    id: agentAction.id,
    sourceMessageId: agentAction.sourceMessageId,
    createdAt: agentAction.createdAt,
    replacesExistingPlans: agentAction.payload?.replacesExistingPlans,
  });
  const impact = describeCreatePlansImpact(previewAction, existingPlans);
  const actionStatus = agentAction.status || "proposed";
  const displayRisk = impact.overwrittenDates.length > 0 || selectedItems.length > 1 ? "medium" : "low";
  const selectedUpdateCount = selectedItems.filter(isPlanUpdateItem).length;
  const selectedWorkoutCount = selectedItems.filter(it => !isRestPlanItem(it) && !isPlanUpdateItem(it)).length;
  const selectedRestCount = selectedItems.filter(isRestPlanItem).length;

  async function doImport() {
    // Validate: every selected row needs a date + type.
    const selected = items.filter(it => it._selected);
    for (const it of selected) {
      if (!it.date || !/^\d{4}-\d{2}-\d{2}$/.test(it.date)) {
        appDialog.alert(t("coach.import_invalid_date", { date: it.date || "(empty)" }));
        return;
      }
    }
    // Shape non-rest items into workout records — type-specific, mirroring the Calendar
    // add-plan form (planFields). Fields not shown for a type stay zeroed.
    const restDates = selected.filter(isRestPlanItem).map(it => it.date);
    const workoutItems = selected.filter(it => !isRestPlanItem(it));
    const replacePlannedDates = workoutItems.filter(it => !isPlanUpdateItem(it)).map(it => it.date);
    const replacePlannedIds = workoutItems.map(getPlanTargetId).filter(Boolean);
    const workouts = workoutItems.map(it => {
      const f = planFields(it.type);
      const distance = f.distance ? (parseFloat(it.distance) || 0) : 0;
      const ascent = f.ascent
        ? (Math.round(parseFloat(it.ascent) || 0) || parseAscentMeters(it.notes))
        : 0;
      const speed = f.speed ? (parseFloat(it.speed) || 0) : 0;
      let durationMin = f.duration ? (parseFloat(it.durationMin) || 0) : 0;
      let subTypes = [];
      let planDetail = null;
      if (f.runType) {
        subTypes = it.runType ? [it.runType] : [];
      } else if (f.strength) {
        subTypes = it.subTypes || [];
      }
      if (f.speed && speed > 0) planDetail = { ...(planDetail || {}), speed };
      return {
        date: it.date,
        type: it.type,
        subTypes,
        distance,
        duration: Math.round(durationMin * 60),
        pace: 0, hr: 0, maxHR: 0, ascent, cadence: 0, aerobicTE: 0, gap: 0,
        planDetail,
        startedAt: timeOfDayToStartedAt(it.date, it.timeOfDay),
        isPlanned: true,
        tags: [],
        _targetPlanId: getPlanTargetId(it) || undefined,
      };
    });
    setImporting(true);
    try {
      await onConfirm(workouts, { restDates, replacePlannedDates, replacePlannedIds });
    } finally {
      setImporting(false);
    }
  }

  return (
    <ModalRoot onClose={onCancel}>
    <div
      onClick={onCancel}
      style={{ ...s.modalOverlay(isMobile), background: "rgba(20,20,19,0.55)" }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          ...s.modalCard(isMobile, { maxWidth: 720, bg: "var(--bg)" }),
          maxHeight: isMobile ? "none" : "90vh",
          overflowY: "auto",
          fontFamily: "var(--font-sans)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{
              fontFamily: "var(--font-mono)", fontSize: 11,
              color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.06em",
              marginBottom: 2,
            }}>
              {t("coach.action_modal_eyebrow")}
            </div>
            <div style={{ fontSize: 17, fontWeight: 500, color: "var(--ink-1)" }}>
              {t("coach.action_create_plans_title", { n: actionPlans.length })}
            </div>
          </div>
          <button onClick={onCancel} style={s.modalCloseBtn} aria-label="Close">×</button>
        </div>

        <div style={{ ...s.muted, marginTop: 10, lineHeight: 1.5, fontSize: 13 }}>
          {t("coach.action_create_plans_hint")}
        </div>
        {onReExtract && (
          <button onClick={onReExtract} disabled={importing}
            style={{ ...s.btnGhost, marginTop: 10, minHeight: 0, padding: "6px 10px", fontSize: 12, opacity: importing ? 0.5 : 1 }}>
            {t("coach.import_reextract")}
          </button>
        )}

        <div style={{ height: 1, background: "var(--rule)", margin: "16px 0" }} />

        <div style={{
          border: "1px solid var(--ink-1)",
          borderRadius: 4,
          background: "var(--bg-elevated)",
          padding: "12px 13px",
          marginBottom: 14,
        }}>
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            marginBottom: 8,
          }}>
            <div style={{ fontSize: 14, fontWeight: 650, color: "var(--ink-1)" }}>
              {t("coach.action_card_title")}
            </div>
            <div style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color: "var(--ink-2)",
              border: "1px solid var(--rule)",
              padding: "3px 7px",
              whiteSpace: "nowrap",
            }}>
              {t(`coach.action_risk_${displayRisk}`)}
            </div>
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--ink-2)" }}>
            {t("coach.action_create_plans_reason", { n: selectedCount, workouts: selectedWorkoutCount, updates: selectedUpdateCount, rests: selectedRestCount })}
          </div>
          <div style={{ ...s.muted, fontSize: 12, marginTop: 8 }}>
            {t("coach.action_requires_confirmation")}
          </div>
          <div style={{ ...s.muted, fontSize: 12, marginTop: 5 }}>
            {t(`coach.action_risk_help_${displayRisk}`)}
          </div>
          {actionStatus !== "proposed" && (
            <div style={{
              marginTop: 8,
              padding: "7px 9px",
              border: "1px solid var(--rule)",
              background: actionStatus === "executed" ? "var(--moss-bg)" : "var(--bg)",
              color: actionStatus === "executed" ? "var(--moss-deep)" : "var(--ink-3)",
              fontSize: 12,
              lineHeight: 1.45,
            }}>
              {t(`coach.action_status_${actionStatus}`)}
            </div>
          )}
          <div style={{
            marginTop: 12,
            paddingTop: 10,
            borderTop: "1px solid var(--rule)",
          }}>
            <div style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--ink-3)",
              marginBottom: 7,
            }}>
              {t("coach.action_will_execute")}
            </div>
            {selectedItems.length === 0 ? (
              <div style={{ ...s.muted, fontSize: 12 }}>
                {t("coach.action_no_selected")}
              </div>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, color: "var(--ink-2)", fontSize: 12, lineHeight: 1.55 }}>
                {selectedItems.slice(0, 4).map(it => (
                  <li key={it._id}>{planSummary(it, t)}</li>
                ))}
                {selectedItems.length > 4 && (
                  <li>{t("coach.action_more_items", { n: selectedItems.length - 4 })}</li>
                )}
              </ul>
            )}
            {impact.overwrittenDates.length > 0 && (
              <div style={{
                marginTop: 9,
                padding: "8px 10px",
                border: "1px solid var(--rule)",
                background: "var(--bg)",
                fontSize: 12,
                lineHeight: 1.45,
                color: "var(--ink-2)",
              }}>
                {t("coach.action_replace_warning", {
                  dates: impact.overwrittenDates.map(x => compactDateLabel(x.date)).join(", "),
                })}
              </div>
            )}
          </div>
        </div>

        {/* Plan rows */}
        {items.length === 0 ? (
          <div style={{
            padding: "28px 0",
            color: "var(--ink-3)", textAlign: "center", fontSize: 13,
            fontFamily: "var(--font-mono)",
          }}>
            {t("coach.import_all_removed")}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {items.map(it => {
              const isRest = isRestPlanItem(it);
              const color = isRest ? "var(--ink-3)" : (TYPE_COLOR[it.type] || "var(--ink-2)");
              const f = isRest ? {} : planFields(it.type);
              return (
                <div key={it._id} style={{
                  border: "1px solid var(--rule)",
                  borderLeft: `3px dashed ${color}`,
                  background: it._selected ? "var(--bg)" : "var(--bg-elevated)",
                  padding: "10px 12px",
                  opacity: it._selected ? 1 : 0.55,
                }}>
                  {/* Top row: checkbox + type chip + delete */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
                    <input type="checkbox" checked={it._selected}
                      onChange={() => patch(it._id, { _selected: !it._selected })}
                      style={{ width: 16, height: 16, accentColor: "var(--ink-1)" }} />
                    {isRest ? (
                      <div style={{
                        fontSize: 11,
                        fontFamily: "var(--font-mono)",
                        padding: "3px 8px",
                        border: "1px solid var(--rule)",
                        background: "var(--bg-elevated)",
                        color: "var(--ink-2)",
                        textTransform: "uppercase",
                      }}>
                        {t("calendar.planned_rest_label")}
                      </div>
                    ) : (
                      <div style={{ ...s.tag(it.type), fontSize: 11 }}>
                        {t(`enum.activity.${it.type}`)}
                      </div>
                    )}
                    {isPlanUpdateItem(it) && (
                      <div style={{
                        fontSize: 10,
                        fontFamily: "var(--font-mono)",
                        padding: "3px 7px",
                        border: "1px solid var(--moss)",
                        background: "var(--moss-bg)",
                        color: "var(--moss-deep)",
                        textTransform: "uppercase",
                      }}>
                        {t("coach.action_update_badge")}
                      </div>
                    )}
                    <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--ink-3)",
                      textTransform: "uppercase", letterSpacing: "0.06em", display: isMobile ? "none" : "block" }}>
                      {t("calendar.planned_badge")}
                    </div>
                    {it.notes && (
                      <div style={{ fontSize: 12, color: "var(--ink-2)", fontStyle: "italic",
                        flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        display: isMobile ? "none" : "block" }}>
                        {it.notes}
                      </div>
                    )}
                    <button onClick={() => remove(it._id)}
                      style={{ ...s.btnGhost, fontSize: 11, padding: "4px 9px",
                        marginLeft: "auto", color: "var(--ink-3)" }}>
                      {t("common.delete")}
                    </button>
                  </div>
                  {it.notes && isMobile && (
                    <div style={{
                      marginBottom: 8,
                      fontSize: 12,
                      lineHeight: 1.35,
                      color: "var(--ink-2)",
                      overflow: "hidden",
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                    }}>
                      {it.notes}
                    </div>
                  )}

                  {/* Editable fields — date + type + time-of-day always; the
                      metric inputs switch per type (planFields). */}
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: isRest ? "86px minmax(126px, 1fr)" : "86px minmax(126px, 1fr) 72px",
                    gap: 8,
                    alignItems: "end",
                  }}>
                    <div>
                      <div style={{ ...s.muted, fontSize: 11, marginBottom: 3 }}>{t("form.date")}</div>
                      <label style={{ display: "block", position: "relative" }}>
                        <input type="date" value={it.date}
                          onChange={e => patch(it._id, { date: e.target.value })}
                          style={{ ...s.input, padding: "5px 7px", height: 30, fontSize: 12, color: "transparent", caretColor: "transparent" }} />
                        <span style={{
                          position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)",
                          pointerEvents: "none", fontFamily: "var(--font-mono)", fontSize: 12,
                          color: it.date ? "var(--ink-1)" : "var(--ink-3)",
                        }}>{compactDateLabel(it.date)}</span>
                      </label>
                    </div>
                    {isRest ? (
                      <div>
                        <div style={{ ...s.muted, fontSize: 11, marginBottom: 3 }}>{t("form.type")}</div>
                        <div style={{
                          ...s.input,
                          height: 30,
                          padding: "5px 8px",
                          fontSize: 12,
                          color: "var(--ink-2)",
                          background: "var(--bg-elevated)",
                        }}>
                          {t("calendar.planned_rest_hint")}
                        </div>
                      </div>
                    ) : (
                      <>
                        <div>
                          <div style={{ ...s.muted, fontSize: 11, marginBottom: 3 }}>{t("form.type")}</div>
                          <Dropdown
                            ariaLabel={t("form.type")}
                            options={ACTIVITY_TYPES.map(at => ({ value: at, label: t(`enum.activity.${at}`) }))}
                            value={it.type}
                            onChange={(v) => patch(it._id, { type: v })}
                            fontSize={12}
                            triggerStyle={{ padding: "5px 8px", height: 30, minHeight: 0, fontSize: 12 }}
                          />
                        </div>
                        <div>
                          <div style={{ ...s.muted, fontSize: 11, marginBottom: 3 }}>{t("calendar.plan_time_of_day")}</div>
                          <Dropdown
                            ariaLabel={t("calendar.plan_time_of_day")}
                            options={[
                              { value: "", label: t("calendar.plan_tod_any") },
                              { value: "am", label: t("calendar.plan_tod_am") },
                              { value: "pm", label: t("calendar.plan_tod_pm") },
                            ]}
                            value={it.timeOfDay}
                            onChange={(v) => patch(it._id, { timeOfDay: v })}
                            fontSize={12}
                            triggerStyle={{ padding: "5px 7px", height: 30, minHeight: 0, fontSize: 12 }}
                          />
                        </div>
                      </>
                    )}
                    {f.distance && (
                      <div>
                        <div style={{ ...s.muted, fontSize: 11, marginBottom: 3 }}>{t("form.distance")} (km)</div>
                        <input type="number" step="0.1" min="0" value={it.distance}
                          onChange={e => patch(it._id, { distance: e.target.value })}
                          placeholder="—"
                          style={{ ...s.input, padding: "5px 8px", fontSize: 12 }} />
                      </div>
                    )}
                    {f.ascent && (
                      <div>
                        <div style={{ ...s.muted, fontSize: 11, marginBottom: 3 }}>{t("calendar.plan_ascent")} (m)</div>
                        <input type="number" step="10" min="0" value={it.ascent}
                          onChange={e => patch(it._id, { ascent: e.target.value })}
                          placeholder="—"
                          style={{ ...s.input, padding: "5px 8px", fontSize: 12 }} />
                      </div>
                    )}
                    {f.speed && (
                      <div>
                        <div style={{ ...s.muted, fontSize: 11, marginBottom: 3 }}>{t("calendar.plan_speed")} (km/h)</div>
                        <input type="number" step="0.5" min="0" value={it.speed}
                          onChange={e => patch(it._id, { speed: e.target.value })}
                          placeholder="—"
                          style={{ ...s.input, padding: "5px 8px", fontSize: 12 }} />
                      </div>
                    )}
                    {f.duration && (
                      <div>
                        <div style={{ ...s.muted, fontSize: 11, marginBottom: 3 }}>
                          {t("form.duration")} ({t("form.minutes")})
                        </div>
                        <input type="number" step="1" min="0" value={it.durationMin}
                          onChange={e => patch(it._id, { durationMin: e.target.value })}
                          placeholder="—"
                          style={{ ...s.input, padding: "5px 8px", fontSize: 12 }} />
                      </div>
                    )}
                  </div>

                  {/* Road Run: run type. Strength: area(s). */}
                  {f.runType && (
                    <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
                      {RUN_PACE_TYPES.map(rt => {
                        const on = it.runType === rt;
                        return (
                          <button key={rt} type="button"
                            onClick={() => patch(it._id, { runType: on ? "" : rt })}
                            style={{ ...s.chip(on), minHeight: 0, padding: "4px 10px", fontSize: 12 }}>
                            {t(`enum.subtype.${rt}`)}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {f.strength && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                        {STRENGTH_SUBS.map(sub => {
                          const on = (it.subTypes || []).includes(sub);
                          return (
                            <button key={sub} type="button"
                              onClick={() => {
                                const nextSubs = on ? it.subTypes.filter(x => x !== sub) : [...(it.subTypes || []), sub];
                                patch(it._id, { subTypes: nextSubs });
                              }}
                              style={{ ...s.chip(on), minHeight: 0, padding: "4px 10px", fontSize: 12 }}>
                              {t(`enum.subtype.${sub}`)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Footer actions */}
        <div style={{
          display: "flex", gap: 8, marginTop: 18,
          paddingTop: 14, borderTop: "1px solid var(--rule)",
        }}>
          <button onClick={doImport}
            disabled={importing || selectedCount === 0}
            style={{ ...s.btn, opacity: (importing || selectedCount === 0) ? 0.5 : 1 }}>
            {importing
              ? t("coach.importing")
              : t("coach.import_confirm", { n: selectedCount })}
          </button>
          <button onClick={onReject || onCancel} disabled={importing}
            style={{ ...s.btnGhost, opacity: importing ? 0.5 : 1 }}>
            {t("coach.action_reject")}
          </button>
        </div>
      </div>
    </div>
    </ModalRoot>
  );
}
