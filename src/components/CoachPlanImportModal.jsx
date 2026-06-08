import { useState } from "react";
import { s } from "../styles";
import { ACTIVITY_TYPES, RUN_PACE_TYPES, STRENGTH_SUBS, TYPE_COLOR } from "../constants";
import { useT } from "../i18n/LanguageContext";
import { useIsMobile } from "../hooks/useMediaQuery";
import { timeOfDayToStartedAt } from "../utils/format";
import { planFields } from "./CalendarDayModal";
import { ModalRoot } from "./ModalRoot";
import { Dropdown } from "./Dropdown";

// Each row in the modal is a draft proposal — user can toggle, edit, or
// remove. Internal `_id` keeps React's key stable; `_selected` drives the
// checkbox. Both strip off when we hand off to bulkAddLogs. Fields shown per
// type mirror planFields (the Calendar add-plan form).
function buildDraft(p, idx) {
  const type = ACTIVITY_TYPES.includes(p.type) ? p.type : "Road Run";
  const f = planFields(type);
  const subs = Array.isArray(p.subTypes) ? p.subTypes : [];
  const partDurations = {};
  if (f.strength && p.subTypeDurations && typeof p.subTypeDurations === "object") {
    for (const [k, v] of Object.entries(p.subTypeDurations)) {
      if (STRENGTH_SUBS.includes(k)) partDurations[k] = String(v);
    }
  }
  return {
    _id: `proposal-${idx}`,
    _selected: true,
    date: p.date || "",
    type,
    distance: f.distance && p.distance != null ? String(p.distance) : "",
    ascent: f.ascent && p.ascent != null ? String(p.ascent) : "",
    speed: f.speed && p.speed != null ? String(p.speed) : "",
    durationMin: f.duration && p.duration != null ? String(p.duration) : "",
    runType: f.runType ? (subs.find(st => RUN_PACE_TYPES.includes(st)) || "") : "",
    subTypes: f.strength ? subs.filter(st => STRENGTH_SUBS.includes(st)) : [],
    partDurations,
    timeOfDay: (p.timeOfDay === "am" || p.timeOfDay === "pm") ? p.timeOfDay : "",
    notes: p.notes || "",
  };
}

function parseAscentMeters(notes) {
  const m = String(notes || "").match(/\+?\s*(\d+(?:\.\d+)?)\s*m\b/i);
  const n = m ? Number(m[1]) : 0;
  return Number.isFinite(n) ? Math.round(n) : 0;
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
    // Shape into workout records — type-specific, mirroring the Calendar
    // add-plan form (planFields). Fields not shown for a type stay zeroed.
    const workouts = selected.map(it => {
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
        const parts = {};
        let total = 0;
        for (const area of subTypes) {
          const m = Math.round(parseFloat(it.partDurations?.[area]) || 0);
          if (m > 0) { parts[area] = m; total += m; }
        }
        if (Object.keys(parts).length) planDetail = { subTypeDurations: parts };
        durationMin = total;
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
      };
    });
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
              const f = planFields(it.type);
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
                    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
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
                      />
                    </div>
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

                  {/* Road Run: run type. Strength: area(s) + per-area minutes. */}
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
                                const nextParts = { ...(it.partDurations || {}) };
                                if (on) delete nextParts[sub];
                                patch(it._id, { subTypes: nextSubs, partDurations: nextParts });
                              }}
                              style={{ ...s.chip(on), minHeight: 0, padding: "4px 10px", fontSize: 12 }}>
                              {t(`enum.subtype.${sub}`)}
                            </button>
                          );
                        })}
                      </div>
                      {(it.subTypes || []).map(area => (
                        <div key={area} style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                          <span style={{ ...s.muted, fontSize: 11, width: 84, flexShrink: 0 }}>{t(`enum.subtype.${area}`)}</span>
                          <input type="number" step="5" min="0" value={(it.partDurations || {})[area] || ""}
                            onChange={e => patch(it._id, { partDurations: { ...(it.partDurations || {}), [area]: e.target.value } })}
                            placeholder="—"
                            style={{ ...s.input, padding: "4px 8px", fontSize: 12, width: 76 }} />
                          <span style={{ ...s.muted, fontSize: 11 }}>{t("calendar.plan_part_minutes")}</span>
                        </div>
                      ))}
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
