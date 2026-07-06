import { useState } from "react";
import { s } from "../styles";
import { ACTIVITY_TYPES, RUN_PACE_TYPES, STRENGTH_SUBS, TYPE_COLOR } from "../constants";
import { useLanguage, useT } from "../i18n/LanguageContext";
import { useIsMobile } from "../hooks/useMediaQuery";
import { timeOfDayToStartedAt } from "../utils/format";
import { buildCreatePlansAction, describeCreatePlansImpact, getCreatePlans, getPlanTargetId, isPlanUpdateItem, isRestPlanItem } from "../utils/agentActions";
import { filterActionableProactivePlans } from "../utils/actionPlanFilters";
import { planFields } from "../utils/planFields";
import { ModalRoot } from "./ModalRoot";
import { Dropdown } from "./Dropdown";
import { useAppDialog } from "./AppDialogContext";
import { useInstantPress } from "../hooks/useInstantPress";

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
    keySession: p.keySession === true,
  };
}

function compactDateLabel(date) {
  const m = String(date || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[2]}-${m[3]}` : (date || "—");
}

function weekdayLabel(date, lang) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) return "";
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  const zh = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const en = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return (lang === "zh" ? zh : en)[d.getDay()];
}

function dateWithWeekdayLabel(date, lang) {
  const dateLabel = compactDateLabel(date);
  const weekday = weekdayLabel(date, lang);
  return weekday ? `${weekday} ${dateLabel}` : dateLabel;
}

function isExistingKeySession(plan) {
  return plan?.isPlanned && plan?.planDetail?.keySession === true;
}

function keySessionPlanLabel(plan, t, lang) {
  if (!plan) return "";
  const f = planFields(plan.type);
  const bits = [dateWithWeekdayLabel(plan.date, lang), t(`enum.activity.${plan.type}`)];
  if (Array.isArray(plan.subTypes) && plan.subTypes.length) {
    bits.push(plan.subTypes.map(st => t(`enum.subtype.${st}`)).join(" / "));
  }
  if (f.distance && Number(plan.distance) > 0) bits.push(`${Number(plan.distance)} km`);
  if (f.ascent && Number(plan.ascent) > 0) bits.push(`+${Number(plan.ascent)} m`);
  if (f.speed && Number(plan.planDetail?.speed) > 0) bits.push(`${Number(plan.planDetail.speed)} km/h`);
  if (f.duration && Number(plan.duration) > 0) bits.push(`${Math.round(Number(plan.duration) / 60)} ${t("form.minutes")}`);
  return bits.filter(Boolean).join(" · ");
}

function keySessionImpactsForItems(items, existingPlans, t, lang) {
  const existing = Array.isArray(existingPlans) ? existingPlans.filter(Boolean) : [];
  const byId = new Map(existing.map(plan => [String(plan.id || ""), plan]));
  const hits = new Map();
  for (const item of items || []) {
    if (!item?._selected) continue;
    if (isPlanUpdateItem(item)) {
      const target = byId.get(getPlanTargetId(item));
      if (isExistingKeySession(target)) hits.set(target.id, keySessionPlanLabel(target, t, lang));
      continue;
    }
    if (!item.date) continue;
    for (const plan of existing) {
      if (plan?.date === item.date && isExistingKeySession(plan)) {
        hits.set(plan.id, keySessionPlanLabel(plan, t, lang));
      }
    }
  }
  return [...hits.values()].filter(Boolean);
}

function parseAscentMeters(notes) {
  const m = String(notes || "").match(/\+?\s*(\d+(?:\.\d+)?)\s*m\b/i);
  const n = m ? Number(m[1]) : 0;
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function planSummary(it, t, lang) {
  if (isRestPlanItem(it)) {
    const bits = [dateWithWeekdayLabel(it.date, lang), t("calendar.planned_rest_label")];
    if (it.notes) bits.push(it.notes);
    return bits.filter(Boolean).join(" · ");
  }
  const bits = [dateWithWeekdayLabel(it.date, lang), t(`enum.activity.${it.type}`)];
  if (it.runType) bits.push(t(`enum.subtype.${it.runType}`));
  if ((it.subTypes || []).length) bits.push(it.subTypes.map(st => t(`enum.subtype.${st}`)).join(" / "));
  if (it.distance) bits.push(`${it.distance} km`);
  if (it.ascent) bits.push(`+${it.ascent} m`);
  if (it.speed) bits.push(`${it.speed} km/h`);
  if (it.durationMin) bits.push(`${it.durationMin} ${t("form.minutes")}`);
  if (it.timeOfDay) bits.push(t(`calendar.plan_tod_${it.timeOfDay}`));
  if (it.keySession) bits.push(t("calendar.plan_key_session_short"));
  return bits.filter(Boolean).join(" · ");
}

function containsChinese(value) {
  return /[\u3400-\u9FFF]/.test(String(value || ""));
}

function normalizeReasonLine(value) {
  return String(value || "")
    .replace(/^#{1,6}\s*/, "")
    .replace(/^(?:[-*]|\u2022)\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function assistantAnalysisLines(assistantContent, lang) {
  return String(assistantContent || "")
    .replace(/```[\s\S]*?```/g, " ")
    .split(/\n+/)
    .map(normalizeReasonLine)
    .filter(Boolean)
    .filter(line => !/^\{|\[|\]$/.test(line))
    .filter(line => !/^\d{4}-\d{2}-\d{2}\b/.test(line))
    .filter(line => !/^(Road Run|Trail Run|Hiking|Strength|HIIT|Rest)\b/i.test(line))
    .filter(line => lang !== "zh" || containsChinese(line))
    .slice(0, 3);
}

function localizedActionReason(action, t) {
  const source = String(action?.source || "ai_coach_reply");
  const key = `coach.action_reason_source_${source}`;
  const translated = t(key);
  return translated === key ? t("coach.action_reason_source_default") : translated;
}

function planReasonLabel(it, t) {
  if (isRestPlanItem(it)) return t("calendar.planned_rest_label");
  const bits = [t(`enum.activity.${it.type}`)];
  if (it.runType) bits.push(t(`enum.subtype.${it.runType}`));
  if ((it.subTypes || []).length) bits.push(it.subTypes.map(st => t(`enum.subtype.${st}`)).join(" / "));
  if (it.distance) bits.push(`${it.distance} km`);
  if (it.ascent) bits.push(`+${it.ascent} m`);
  if (it.speed) bits.push(`${it.speed} km/h`);
  if (it.durationMin) bits.push(`${it.durationMin} ${t("form.minutes")}`);
  return bits.filter(Boolean).join(" · ");
}

function noteFactors(note, t) {
  const text = String(note || "").toLowerCase();
  const factors = [];
  const add = key => {
    const value = t(key);
    if (value && value !== key && !factors.includes(value)) factors.push(value);
  };
  if (/(poor|bad|short).*sleep|sleep/.test(text)) add("coach.action_factor_sleep");
  if (/hot|humid|humidity/.test(text)) add("coach.action_factor_heat_humidity");
  if (/rpe\s*8|rpe.*high|recent rpe/.test(text)) add("coach.action_factor_high_rpe");
  if (/recover|recovery/.test(text)) add("coach.action_factor_recovery");
  if (/missed|chasing|chase/.test(text)) add("coach.action_factor_missed_volume");
  if (/lower-body|non-leg|leg-dominant|eccentric/.test(text)) add("coach.action_factor_lower_body");
  if (/rain|wet/.test(text)) add("coach.action_factor_rain");
  if (/downhill|footing/.test(text)) add("coach.action_factor_terrain");
  if (/bail|earlier|flat|fresh/.test(text)) add("coach.action_factor_state_check");
  return factors;
}

function fallbackItemReason(it, action, t) {
  const plan = planReasonLabel(it, t);
  const source = String(action?.source || "");
  const baseKey = isRestPlanItem(it)
    ? "coach.action_item_reason_rest"
    : source === "recovery_load_guard"
      ? "coach.action_item_reason_recovery"
      : source === "plan_deviation_rescue"
        ? "coach.action_item_reason_plan_deviation"
        : source === "combined_training_adjustment"
          ? "coach.action_item_reason_combined"
          : isPlanUpdateItem(it)
            ? "coach.action_item_reason_update"
            : "coach.action_item_reason_default";
  const base = t(baseKey, { plan });
  const factors = noteFactors(it.notes, t);
  return factors.length
    ? `${base}${t("coach.action_item_reason_factors", { factors: factors.join("、") })}`
    : base;
}

function displayItemReason(it, action, t, lang) {
  const note = normalizeReasonLine(it.notes);
  if (!note) return "";
  if (lang !== "zh" || containsChinese(note)) return note;
  return fallbackItemReason(it, action, t);
}

function coachReasonLines(action, selectedItems, assistantContent, t, lang) {
  const lines = [];
  const seen = new Set();
  const add = value => {
    const line = normalizeReasonLine(value);
    const key = line.toLowerCase();
    if (!line || seen.has(key)) return;
    seen.add(key);
    lines.push(line);
  };

  assistantAnalysisLines(assistantContent, lang).forEach(add);
  if (lines.length === 0) add(localizedActionReason(action, t));
  selectedItems.map(it => displayItemReason(it, action, t, lang)).forEach(add);
  return lines.slice(0, 4);
}

function dateImpactText(row, t, lang) {
  const date = dateWithWeekdayLabel(row.date, lang);
  if (row.dateWideReplace && row.existingPlanCount > 0) {
    if (row.restCount > 0 && row.createCount === 0) {
      return row.existingPlanCount === 1
        ? t("coach.action_date_replace_rest_single", { date })
        : t("coach.action_date_replace_rest", { date, count: row.existingPlanCount });
    }
    return row.existingPlanCount === 1
      ? t("coach.action_date_replace_plan_single", { date })
      : t("coach.action_date_replace_plan", { date, count: row.existingPlanCount });
  }
  if (row.dateWideReplace && row.restCount > 0 && row.createCount === 0) {
    return t("coach.action_date_add_rest", { date });
  }
  if (row.updateCount > 0) {
    const otherCount = Math.max(0, row.existingPlanCount - row.updateCount);
    return otherCount > 0
      ? t("coach.action_date_update_with_others", { date, n: row.updateCount, other: otherCount })
      : t("coach.action_date_update_single", { date, n: row.updateCount });
  }
  return t("coach.action_date_add_plan", { date, n: row.createCount || row.itemCount });
}

export function CoachPlanImportModal({ plans = [], action = null, assistantContent = "", existingPlans = [], onConfirm, onCancel, onReject, onReExtract }) {
  const t = useT();
  const { lang } = useLanguage();
  const appDialog = useAppDialog();
  const isMobile = useIsMobile();
  const instantPress = useInstantPress();
  const agentAction = action || buildCreatePlansAction(plans);
  const actionPlans = filterActionableProactivePlans(getCreatePlans(agentAction), agentAction);
  const [items, setItems] = useState(() => actionPlans.map(buildDraft));
  const [importing, setImporting] = useState(false);
  const [showMeta, setShowMeta] = useState(false);

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
  const selectedUpdateCount = selectedItems.filter(isPlanUpdateItem).length;
  const selectedWorkoutCount = selectedItems.filter(it => !isRestPlanItem(it) && !isPlanUpdateItem(it)).length;
  const selectedRestCount = selectedItems.filter(isRestPlanItem).length;
  const keySessionImpacts = keySessionImpactsForItems(selectedItems, existingPlans, t, lang);
  const displayRisk = keySessionImpacts.length > 0 || impact.overwrittenDates.length > 0 || selectedItems.length > 1 ? "medium" : "low";
  const reasonLines = coachReasonLines(agentAction, selectedItems, assistantContent, t, lang);
  const dateImpactRows = impact.dateImpacts || [];
  const actionMetaTitle = t("coach.action_meta_toggle");

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
    const existingById = new Map((existingPlans || []).map(plan => [String(plan.id || ""), plan]));
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
      const targetPlan = existingById.get(getPlanTargetId(it));
      if (it.keySession === true || isExistingKeySession(targetPlan)) {
        planDetail = { ...(planDetail || {}), keySession: true };
      }
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
        className="ultreia-scroll-stable ultreia-no-motion-surface"
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
            marginBottom: showMeta ? 8 : 0,
          }}>
            <div style={{ fontSize: 14, fontWeight: 650, color: "var(--ink-1)" }}>
              {t("coach.action_card_title")}
            </div>
            <button
              type="button"
              {...instantPress("coach-plan-meta-toggle", () => setShowMeta(v => !v))}
              aria-label={actionMetaTitle}
              title={actionMetaTitle}
              aria-expanded={showMeta}
              style={{
                width: 24,
                height: 24,
                minHeight: 0,
                borderRadius: "50%",
                border: "1px solid var(--rule)",
                background: showMeta ? "var(--accent-soft)" : "var(--bg)",
                color: showMeta ? "var(--accent-dark)" : "var(--ink-2)",
                fontFamily: "var(--font-mono)",
                fontSize: 14,
                fontWeight: 700,
                lineHeight: 1,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                padding: 0,
                flex: "0 0 auto",
                touchAction: "manipulation",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              !
            </button>
          </div>
          {showMeta && (
            <div style={{
              marginTop: 8,
              padding: "9px 10px",
              border: "1px solid var(--rule)",
              background: "var(--bg)",
              fontSize: 12,
              lineHeight: 1.45,
            }}>
              <div style={{ fontFamily: "var(--font-mono)", color: "var(--ink-3)", marginBottom: 6 }}>
                {t("coach.action_meta_title")} · {t(`coach.action_risk_${displayRisk}`)}
              </div>
              <div style={{ color: "var(--ink-2)" }}>
                {t("coach.action_create_plans_reason", { n: selectedCount, workouts: selectedWorkoutCount, updates: selectedUpdateCount, rests: selectedRestCount })}
              </div>
              <div style={{ ...s.muted, fontSize: 12, marginTop: 6 }}>
                {t("coach.action_requires_confirmation")}
              </div>
              <div style={{ ...s.muted, fontSize: 12, marginTop: 4 }}>
                {t(`coach.action_risk_help_${displayRisk}`)}
              </div>
              {actionStatus !== "proposed" && (
                <div style={{
                  marginTop: 7,
                  paddingTop: 7,
                  borderTop: "1px solid var(--rule)",
                  color: actionStatus === "executed" ? "var(--moss-deep)" : "var(--ink-3)",
                }}>
                  {t(`coach.action_status_${actionStatus}`)}
                </div>
              )}
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
              {t("coach.action_analysis_title")}
            </div>
            {reasonLines.length === 0 ? (
              <div style={{ ...s.muted, fontSize: 12 }}>
                {t("coach.action_analysis_empty")}
              </div>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, color: "var(--ink-2)", fontSize: 12, lineHeight: 1.55 }}>
                {reasonLines.map(line => <li key={line}>{line}</li>)}
              </ul>
            )}
          </div>
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
              {t("coach.action_calendar_impact_title")}
            </div>
            <div style={{ ...s.muted, fontSize: 12, lineHeight: 1.45, marginBottom: dateImpactRows.length ? 7 : 0 }}>
              {t("coach.action_calendar_impact_scope")}
            </div>
            {dateImpactRows.length > 0 && (
              <ul style={{ margin: 0, paddingLeft: 18, color: "var(--ink-2)", fontSize: 12, lineHeight: 1.55 }}>
                {dateImpactRows.map(row => (
                  <li key={row.date}>{dateImpactText(row, t, lang)}</li>
                ))}
              </ul>
            )}
            {keySessionImpacts.length > 0 && (
              <div style={{
                marginTop: 9,
                border: "1px solid var(--warn)",
                background: "rgba(182, 119, 45, 0.12)",
                color: "var(--ink-1)",
                padding: "8px 9px",
                fontSize: 12,
                lineHeight: 1.45,
              }}>
                {t("coach.action_key_session_warning", { sessions: keySessionImpacts.join(lang === "zh" ? "、" : ", ") })}
              </div>
            )}
          </div>
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
                  <li key={it._id}>{planSummary(it, t, lang)}</li>
                ))}
                {selectedItems.length > 4 && (
                  <li>{t("coach.action_more_items", { n: selectedItems.length - 4 })}</li>
                )}
              </ul>
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
              const itemReason = displayItemReason(it, agentAction, t, lang);
              const dateColumn = lang === "zh" ? "102px" : "108px";
              const fieldLabelStyle = {
                ...s.muted,
                fontSize: 11,
                marginBottom: 3,
                lineHeight: 1.18,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              };
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
                    <button onClick={() => remove(it._id)}
                      style={{ ...s.btnGhost, fontSize: 11, padding: "4px 9px",
                        marginLeft: "auto", color: "var(--ink-3)" }}>
                      {t("common.delete")}
                    </button>
                  </div>
                  {itemReason && (
                    <div style={{
                      marginBottom: 8,
                      fontSize: 12,
                      lineHeight: 1.45,
                      color: "var(--ink-2)",
                    }}>
                      {itemReason}
                    </div>
                  )}

                  {/* Editable fields — date + type + time-of-day always; the
                      metric inputs switch per type (planFields). */}
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: isRest
                      ? `${dateColumn} minmax(126px, 1fr)`
                      : (isMobile
                        ? `${dateColumn} minmax(0, 1fr)`
                        : `${dateColumn} minmax(126px, 1fr) 84px`),
                    gap: 8,
                    alignItems: "end",
                  }}>
                    <div>
                      <div style={fieldLabelStyle}>{t("form.date")}</div>
                      <label style={{ display: "block", position: "relative" }}>
                        <input type="date" value={it.date}
                          onChange={e => patch(it._id, { date: e.target.value })}
                          style={{ ...s.input, padding: "5px 7px", height: 30, fontSize: 12, color: "transparent", caretColor: "transparent" }} />
                        <span style={{
                          position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)",
                          pointerEvents: "none", fontFamily: "var(--font-mono)", fontSize: 12,
                          color: it.date ? "var(--ink-1)" : "var(--ink-3)",
                        }}>{dateWithWeekdayLabel(it.date, lang)}</span>
                      </label>
                    </div>
                    {isRest ? (
                      <div>
                        <div style={fieldLabelStyle}>{t("form.type")}</div>
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
                          <div style={fieldLabelStyle}>{t("form.type")}</div>
                          <Dropdown
                            ariaLabel={t("form.type")}
                            options={ACTIVITY_TYPES.map(at => ({ value: at, label: t(`enum.activity.${at}`) }))}
                            value={it.type}
                            onChange={(v) => patch(it._id, { type: v })}
                            fontSize={12}
                            triggerStyle={{ padding: "5px 8px", height: 30, minHeight: 0, fontSize: 12 }}
                          />
                        </div>
                        <div style={{ gridColumn: isMobile ? "1 / -1" : undefined }}>
                          <div style={fieldLabelStyle}>{t("calendar.plan_time_of_day")}</div>
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
                            {...instantPress(`coach-plan-run-type-${it._id}-${rt}`, () => patch(it._id, { runType: on ? "" : rt }))}
                            style={{ ...s.chip(on), minHeight: 0, padding: "4px 10px", fontSize: 12, touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}>
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
                              {...instantPress(`coach-plan-strength-${it._id}-${sub}`, () => {
                                const nextSubs = on ? it.subTypes.filter(x => x !== sub) : [...(it.subTypes || []), sub];
                                patch(it._id, { subTypes: nextSubs });
                              })}
                              style={{ ...s.chip(on), minHeight: 0, padding: "4px 10px", fontSize: 12, touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}>
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
