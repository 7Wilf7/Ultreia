import { useState } from "react";
import { s } from "../styles";
import { ACTIVITY_TYPES, RUN_GROUP_TYPES, STRENGTH_SUBS, TYPE_COLOR } from "../constants";
import { useT } from "../i18n/LanguageContext";
import { useIsMobile } from "../hooks/useMediaQuery";
import { timeOfDayToStartedAt } from "../utils/format";
import { ModalRoot } from "./ModalRoot";
import { Dropdown } from "./Dropdown";

// Each row in the modal is a draft proposal — user can toggle, edit, or
// remove. Internal `_id` keeps React's key stable; `_selected` drives the
// checkbox. Both strip off when we hand off to bulkAddLogs.
function buildDraft(p, idx) {
  return {
    _id: `proposal-${idx}`,
    _selected: true,
    date: p.date || "",
    type: ACTIVITY_TYPES.includes(p.type) ? p.type : "Road Run",
    subTypes: Array.isArray(p.subTypes) ? p.subTypes : [],
    distance: p.distance != null ? String(p.distance) : "",
    durationMin: p.duration != null ? String(p.duration) : "",
    timeOfDay: (p.timeOfDay === "am" || p.timeOfDay === "pm") ? p.timeOfDay : "",
    notes: p.notes || "",
  };
}

export function CoachPlanImportModal({ plans, onConfirm, onCancel }) {
  const t = useT();
  const isMobile = useIsMobile();
  const [items, setItems] = useState(() => plans.map(buildDraft));
  const [importing, setImporting] = useState(false);

  function patch(id, p) {
    setItems(items.map(it => it._id === id ? { ...it, ...p } : it));
  }
  function remove(id) {
    setItems(items.filter(it => it._id !== id));
  }

  const selectedCount = items.filter(it => it._selected).length;

  async function doImport() {
    // Validate: every selected row needs a date + type.
    const selected = items.filter(it => it._selected);
    for (const it of selected) {
      if (!it.date || !/^\d{4}-\d{2}-\d{2}$/.test(it.date)) {
        alert(t("coach.import_invalid_date", { date: it.date || "(empty)" }));
        return;
      }
    }
    // Shape into workout records — every field bulkInsertWorkouts expects.
    const workouts = selected.map(it => ({
      date: it.date,
      type: it.type,
      subTypes: it.subTypes || [],
      distance: parseFloat(it.distance) || 0,
      duration: Math.round((parseFloat(it.durationMin) || 0) * 60),
      pace: 0, hr: 0, maxHR: 0, ascent: 0, cadence: 0, aerobicTE: 0, gap: 0,
      startedAt: timeOfDayToStartedAt(it.date, it.timeOfDay),
      isPlanned: true,
      tags: [],
    }));
    setImporting(true);
    try {
      await onConfirm(workouts);
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
              {t("coach.import_modal_eyebrow")}
            </div>
            <div style={{ fontSize: 17, fontWeight: 500, color: "var(--ink-1)" }}>
              {t("coach.import_modal_title", { n: plans.length })}
            </div>
          </div>
          <button onClick={onCancel} style={s.modalCloseBtn} aria-label="Close">×</button>
        </div>

        <div style={{ ...s.muted, marginTop: 10, lineHeight: 1.5, fontSize: 13 }}>
          {t("coach.import_modal_hint")}
        </div>

        <div style={{ height: 1, background: "var(--rule)", margin: "16px 0" }} />

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
              const color = TYPE_COLOR[it.type] || "var(--ink-2)";
              const showDistance = RUN_GROUP_TYPES.includes(it.type);
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
                    <div style={{ ...s.tag(it.type), fontSize: 11 }}>
                      {t(`enum.activity.${it.type}`)}
                    </div>
                    <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--ink-3)",
                      textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      {t("calendar.planned_badge")}
                    </div>
                    {it.notes && (
                      <div style={{ fontSize: 12, color: "var(--ink-2)", fontStyle: "italic",
                        flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {it.notes}
                      </div>
                    )}
                    <button onClick={() => remove(it._id)}
                      style={{ ...s.btnGhost, fontSize: 11, padding: "4px 9px",
                        marginLeft: "auto", color: "var(--ink-3)" }}>
                      {t("common.delete")}
                    </button>
                  </div>

                  {/* Editable fields */}
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: showDistance ? "1fr 1fr 1fr 1fr" : "1fr 1fr 1fr",
                    gap: 8,
                  }}>
                    <div>
                      <div style={{ ...s.muted, fontSize: 11, marginBottom: 3 }}>{t("form.date")}</div>
                      <input type="date" value={it.date}
                        onChange={e => patch(it._id, { date: e.target.value })}
                        style={{ ...s.input, padding: "5px 8px", fontSize: 12 }} />
                    </div>
                    <div>
                      <div style={{ ...s.muted, fontSize: 11, marginBottom: 3 }}>{t("form.type")}</div>
                      <Dropdown
                        ariaLabel={t("form.type")}
                        options={ACTIVITY_TYPES.map(at => ({ value: at, label: t(`enum.activity.${at}`) }))}
                        value={it.type}
                        onChange={(v) => patch(it._id, { type: v })}
                      />
                    </div>
                    {showDistance && (
                      <div>
                        <div style={{ ...s.muted, fontSize: 11, marginBottom: 3 }}>{t("form.distance")} (km)</div>
                        <input type="number" step="0.1" min="0" value={it.distance}
                          onChange={e => patch(it._id, { distance: e.target.value })}
                          placeholder="—"
                          style={{ ...s.input, padding: "5px 8px", fontSize: 12 }} />
                      </div>
                    )}
                    <div>
                      <div style={{ ...s.muted, fontSize: 11, marginBottom: 3 }}>
                        {t("form.duration")} ({t("form.minutes")})
                      </div>
                      <input type="number" step="1" min="0" value={it.durationMin}
                        onChange={e => patch(it._id, { durationMin: e.target.value })}
                        placeholder="—"
                        style={{ ...s.input, padding: "5px 8px", fontSize: 12 }} />
                    </div>
                  </div>

                  {/* Second row: time of day + (strength) area chips, so an
                      imported plan clearly says when + what to train. */}
                  <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <div style={{ width: 130 }}>
                      <Dropdown
                        ariaLabel={t("calendar.plan_time_of_day")}
                        options={[
                          { value: "", label: t("calendar.plan_tod_any") },
                          { value: "am", label: t("calendar.plan_tod_am") },
                          { value: "pm", label: t("calendar.plan_tod_pm") },
                        ]}
                        value={it.timeOfDay}
                        onChange={(v) => patch(it._id, { timeOfDay: v })}
                      />
                    </div>
                    {it.type === "Strength" && STRENGTH_SUBS.map(sub => {
                      const on = (it.subTypes || []).includes(sub);
                      return (
                        <button key={sub} type="button"
                          onClick={() => patch(it._id, { subTypes: on ? it.subTypes.filter(x => x !== sub) : [...(it.subTypes || []), sub] })}
                          style={{ ...s.chip(on), minHeight: 0, padding: "4px 10px", fontSize: 12 }}>
                          {t(`enum.subtype.${sub}`)}
                        </button>
                      );
                    })}
                  </div>
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
          <button onClick={onCancel} disabled={importing}
            style={{ ...s.btnGhost, opacity: importing ? 0.5 : 1 }}>
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
    </ModalRoot>
  );
}
