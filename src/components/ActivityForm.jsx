import { useState, useEffect, useRef } from "react";
import { s } from "../styles";
import { ACTIVITY_TYPES, RUN_PACE_TYPES, RUN_FLAGS, STRENGTH_SUBS, RUN_GROUP_TYPES } from "../constants";
import { Dropdown } from "./Dropdown";
import { useT } from "../i18n/LanguageContext";
import { recommendRunType } from "../utils/format";
import { useClickOutside } from "../utils/useClickOutside";
import { useIsMobile } from "../hooks/useMediaQuery";

// Decompose seconds into {h,m,s} strings for the duration inputs
function splitDuration(totalSec) {
  if (!totalSec) return { h: "", m: "", s: "" };
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  return { h: h ? String(h) : "", m: m ? String(m) : "", s: sec ? String(sec) : "" };
}

// Defensive normalization of log.date into YYYY-MM-DD (input type="date" only accepts this)
function normalizeDate(d) {
  if (!d) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const parsed = new Date(d);
  if (isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

// Local time → "YYYY-MM-DDTHH:MM" for <input type="datetime-local">.
// Built piece-by-piece because toISOString() returns UTC and would shift
// by the GMT offset.
function formatLocalDateTimeForInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function buildEmpty() {
  return {
    date: "",
    startedAtLocal: "",     // optional — "YYYY-MM-DDTHH:MM" from datetime-local input
    type: "Road Run",
    subTypes: ["Easy Run"],
    distance: "",
    durationH: "", durationM: "", durationS: "",
    hr: "", maxHR: "",
    ascent: "",
    cadence: "",
    aerobicTE: "",
    // GAP is stored as two parts: minutes (single digit, 0–9) and seconds
    // (two digits, 0–59). Combined at save time. The split avoids forcing
    // the user to type a colon on a mobile numeric keyboard.
    gapMin: "", gapSec: "",
    rpe: "",
    note: "",
  };
}

function fromLog(log) {
  const d = splitDuration(log.duration || 0);
  // GAP is stored in seconds (e.g. 390 = "6:30/km"). Split back into
  // mm/ss for the two-input UI; empty strings when no GAP recorded.
  const gapSec = log.gap || 0;
  const gapMm = gapSec > 0 ? Math.floor(gapSec / 60) : "";
  const gapSs = gapSec > 0 ? gapSec % 60 : "";
  return {
    date: normalizeDate(log.date),
    startedAtLocal: formatLocalDateTimeForInput(log.startedAt),
    type: log.type || "Road Run",
    subTypes: Array.isArray(log.subTypes) ? log.subTypes : [],
    distance: log.distance ? String(log.distance) : "",
    durationH: d.h, durationM: d.m, durationS: d.s,
    hr:        log.hr        ? String(log.hr)        : "",
    maxHR:     log.maxHR     ? String(log.maxHR)     : "",
    ascent:    log.ascent    ? String(log.ascent)    : "",
    cadence:   log.cadence   ? String(log.cadence)   : "",
    aerobicTE: log.aerobicTE ? String(log.aerobicTE) : "",
    gapMin:    gapMm === "" ? "" : String(gapMm),
    gapSec:    gapSs === "" ? "" : String(gapSs).padStart(2, "0"),
    rpe:       log.rpe ? String(log.rpe) : "",
    note:      log.note || "",
  };
}

function LabeledInput({ label, unit, value, onChange, placeholder, type = "number", step }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 11, color: "#666", fontWeight: 500 }}>
        {label}{unit && <span style={{ color: "#aaa", fontWeight: 400 }}> ({unit})</span>}
      </span>
      <input type={type} step={step} placeholder={placeholder} value={value} onChange={onChange} style={s.input} />
    </label>
  );
}

export function ActivityForm({ mode, initial, onSave, onCancel, hrZones }) {
  const t = useT();
  const isMobile = useIsMobile();
  const [form, setForm] = useState(() => initial ? fromLog(initial) : buildEmpty());
  // Snapshot of the form's initial state — used to detect unsaved changes when
  // the user clicks outside in edit mode.
  const initialFormRef = useRef(initial ? fromLog(initial) : buildEmpty());

  // Re-sync the form when a different row is passed in for editing. Callers
  // mount this with key={row.id} so this mostly fires on the rare in-place
  // initial swap; it's an intentional reset-on-prop-change, not the cascading-
  // render anti-pattern the rule guards against.
  useEffect(() => {
    if (initial) {
      const snapshot = fromLog(initial);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm(snapshot);
      initialFormRef.current = snapshot;
    }
  }, [initial]);

  // Click-outside cancels edit; warn first if there are unsaved changes.
  const isDirty = () => JSON.stringify(form) !== JSON.stringify(initialFormRef.current);
  const rootRef = useClickOutside(() => {
    if (!isDirty() || window.confirm(t("form.discard_confirm"))) onCancel();
  }, mode === "edit");

  const isRun = RUN_GROUP_TYPES.includes(form.type);
  const isRoadRun = form.type === "Road Run";
  const isStrength = form.type === "Strength";
  // A race isn't an easy/tempo/etc session, so when the Race flag is on we hide
  // the run-type picker and don't require a pace type (req #2).
  const isRace = isRun && form.subTypes.includes("Race");
  // Only road Running uses pace types (Easy/Aerobic/Tempo/Interval). Trail / Hiking / Floor just track time + climb.
  const showPaceTypes = isRoadRun && !isRace;
  // GAP + cadence make sense for road running only. Trail/hiking pace is dominated by terrain, strength has no distance.
  const showCadenceAndGap = isRoadRun;
  // Floor Climbing tracks vertical only — no horizontal distance. Other Run-group types do track distance.
  const showDistance = isRun && form.type !== "Floor Climbing";
  // All Run-group types track ascent (Floor Climbing is essentially pure ascent).
  const showAscent = isRun;

  const pickedPace = isRoadRun ? (form.subTypes.find(t => RUN_PACE_TYPES.includes(t)) || "") : "";
  const pickedFlags = isRun ? form.subTypes.filter(t => RUN_FLAGS.includes(t)) : [];

  function setPace(p) {
    const flags = pickedFlags;
    const next = p ? [p, ...flags] : [...flags];
    setForm({ ...form, subTypes: next });
  }

  function toggleFlag(flag) {
    const hasIt = pickedFlags.includes(flag);
    const newFlags = hasIt ? pickedFlags.filter(f => f !== flag) : [...pickedFlags, flag];
    // Race ⇒ no pace type: drop it when Race turns on; when Race turns off on a
    // Road Run, restore the default so the required pace field stays satisfied.
    const raceOn = newFlags.includes("Race");
    let pace = pickedPace;
    if (raceOn) pace = "";
    else if (isRoadRun && !pace) pace = "Easy Run";
    const next = pace ? [pace, ...newFlags] : [...newFlags];
    setForm({ ...form, subTypes: next });
  }

  function toggleStrengthSub(sub) {
    const has = form.subTypes.includes(sub);
    setForm({
      ...form,
      subTypes: has ? form.subTypes.filter(x => x !== sub) : [...form.subTypes, sub],
    });
  }

  function changeType(t) {
    // Only road Running auto-picks a pace type; everything else starts blank.
    const nextSubTypes = t === "Road Run" ? ["Easy Run"] : [];
    setForm({ ...form, type: t, subTypes: nextSubTypes });
  }

  function handleSave() {
    if (!form.date) { alert(t("form.alert_date")); return; }
    const dur = (parseInt(form.durationH) || 0) * 3600
      + (parseInt(form.durationM) || 0) * 60
      + (parseInt(form.durationS) || 0);
    if (!dur) { alert(t("form.alert_duration")); return; }
    if (form.type === "Strength" && form.subTypes.length === 0) {
      alert(t("form.alert_body"));
      return;
    }
    if (form.type === "Road Run" && !isRace && !pickedPace) {
      alert(t("form.alert_run"));
      return;
    }
    const dist = showDistance ? (parseFloat(form.distance) || 0) : 0;
    const pace = (dist > 0 && isRun) ? Math.round(dur / dist) : 0;

    // Optional started_at — convert local "YYYY-MM-DDTHH:MM" to ISO. The DAL
    // stores it as timestamptz; null means "we don't know when this started".
    // The weather snapshot path in addLog uses this to decide realtime vs
    // historical fetch.
    let startedAt = null;
    if (form.startedAtLocal) {
      const d = new Date(form.startedAtLocal);
      if (!isNaN(d.getTime())) startedAt = d.toISOString();
    }

    onSave({
      date: form.date,
      startedAt,
      type: form.type,
      subTypes: form.subTypes,
      distance: dist,
      duration: dur,
      pace,
      hr:        parseInt(form.hr)         || 0,
      maxHR:     parseInt(form.maxHR)      || 0,
      ascent:    showAscent ? (parseInt(form.ascent) || 0) : 0,
      cadence:   showCadenceAndGap ? (parseInt(form.cadence) || 0) : 0,
      aerobicTE: parseFloat(form.aerobicTE)|| 0,
      gap:       showCadenceAndGap
        ? ((parseInt(form.gapMin) || 0) * 60 + (parseInt(form.gapSec) || 0))
        : 0,
      // RPE: keep only a valid 1–10 integer; anything else (empty / out of
      // range) → null so the DB CHECK (rpe BETWEEN 1 AND 10) never rejects.
      rpe:       (() => { const n = parseInt(form.rpe, 10); return n >= 1 && n <= 10 ? n : null; })(),
      note:      form.note.trim() || null,
    });
  }

  return (
    <div ref={rootRef} style={{ ...s.cardDark, marginBottom: 14 }}>
      <div style={s.section}>{mode === "edit" ? t("form.edit_title") : t("form.add_title")}</div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 11, color: "#666", fontWeight: 500 }}>{t("form.date")}</span>
          {/* Native date input. Click the calendar icon at the right to open the picker;
              the rest of the input remains editable so users can type YYYY-MM-DD directly. */}
          <input type="date" value={form.date}
            onChange={e => setForm({ ...form, date: e.target.value })}
            style={s.input} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 11, color: "#666", fontWeight: 500 }}>{t("form.type")}</span>
          <Dropdown
            ariaLabel={t("form.type")}
            options={ACTIVITY_TYPES.map(at => ({ value: at, label: t(`enum.activity.${at}`) }))}
            value={form.type}
            onChange={changeType}
          />
        </label>
      </div>

      {/* Optional start time. Empty = "weather snapshot at the moment of save".
          Filled = past timestamp → historical weather at that time; future =
          forecast for that day. The hint is short so it doesn't dominate the
          form for users who never need this field. */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 11, color: "#666", fontWeight: 500 }}>
            {t("form.started_at")}
            <span style={{ color: "#aaa", fontWeight: 400 }}> ({t("form.started_at_optional")})</span>
          </span>
          <input type="datetime-local" value={form.startedAtLocal}
            onChange={e => setForm({ ...form, startedAtLocal: e.target.value })}
            style={s.input} />
          <span style={{ fontSize: 11, color: "#999", lineHeight: 1.4 }}>{t("form.started_at_hint")}</span>
        </label>
      </div>

      {showPaceTypes && (() => {
        // Personalized suggestion: when the user has entered avg HR, mark the
        // pace type that falls into the matching zone. Personalized via hrZones
        // (Karvonen on the user's Resting + Max HR). Falls back to legacy fixed
        // thresholds when HR zones aren't configured yet. The suggestion is
        // ADVISORY — we never change `pickedPace` automatically; the user must
        // click the chip to apply it.
        const hrNum = parseInt(form.hr, 10);
        const suggested = hrNum > 0 ? recommendRunType(hrNum, false, hrZones) : "";
        return (
          <div style={{ marginBottom: 10 }}>
            <div style={{ ...s.label, marginBottom: 6 }}>
              {t("form.run_type")} {t("form.run_type_required")}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {RUN_PACE_TYPES.map(sub => {
                const isSuggested = suggested && sub === suggested && pickedPace !== sub;
                // Mobile drops the "Run" suffix — the column is too narrow
                // for "Easy Run · suggested" to fit on one line.
                const label = isMobile ? t(`enum.subtype.${sub}_short`) : t(`enum.subtype.${sub}`);
                return (
                  <button key={sub} type="button"
                    onClick={() => setPace(pickedPace === sub ? "" : sub)}
                    title={isSuggested ? t("form.run_type_suggested_hint") : undefined}
                    style={{
                      ...s.chip(pickedPace === sub),
                      ...(isSuggested ? { boxShadow: "0 0 0 1px var(--moss)", color: "var(--moss-deep)" } : {}),
                    }}>
                    {label}{isSuggested ? ` · ${t("form.run_type_suggested")}` : ""}
                  </button>
                );
              })}
            </div>
            {suggested && (
              <div style={{ ...s.muted, fontSize: 11, marginTop: 6, lineHeight: 1.5 }}>
                {t("form.run_type_suggested_explain", { type: t(`enum.subtype.${suggested}`) })}
              </div>
            )}
          </div>
        );
      })()}
      {isRun && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ ...s.label, marginBottom: 6 }}>{t("form.flags")}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {RUN_FLAGS.map(flag => (
              <button key={flag} type="button"
                onClick={() => toggleFlag(flag)}
                style={s.chip(pickedFlags.includes(flag))}>🏆 {t(`enum.subtype.${flag}`)}</button>
            ))}
          </div>
        </div>
      )}

      {isStrength && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ ...s.label, marginBottom: 6 }}>{t("form.body_parts")}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {STRENGTH_SUBS.map(sub => (
              <button key={sub} type="button"
                onClick={() => toggleStrengthSub(sub)}
                style={s.chip(form.subTypes.includes(sub))}>{t(`enum.subtype.${sub}`)}</button>
            ))}
          </div>
        </div>
      )}

      {/* Duration */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ ...s.label, marginBottom: 6 }}>{t("form.duration")}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          <LabeledInput label={t("form.hours")}   unit="h" placeholder="0"
            value={form.durationH} onChange={e => setForm({ ...form, durationH: e.target.value })} />
          <LabeledInput label={t("form.minutes")} unit="m" placeholder="0"
            value={form.durationM} onChange={e => setForm({ ...form, durationM: e.target.value })} />
          <LabeledInput label={t("form.seconds")} unit="s" placeholder="0"
            value={form.durationS} onChange={e => setForm({ ...form, durationS: e.target.value })} />
        </div>
      </div>

      {/* Fixed 3-column grid; only visible fields are rendered, in document order.
          Grid auto-places them starting at column 1 — each visible field gets a
          fixed 1/3 width, no full-width stretching, no empty placeholder cells. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginBottom: 10 }}>
        {showDistance && (
          <LabeledInput label={t("form.distance")} unit="km" placeholder="0"
            value={form.distance} onChange={e => setForm({ ...form, distance: e.target.value })} />
        )}
        <LabeledInput label={t("form.avg_hr")} unit="bpm" placeholder="0"
          value={form.hr} onChange={e => setForm({ ...form, hr: e.target.value })} />
        <LabeledInput label={t("form.max_hr")} unit="bpm" placeholder="0"
          value={form.maxHR} onChange={e => setForm({ ...form, maxHR: e.target.value })} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginBottom: 10 }}>
        {showAscent && (
          <LabeledInput label={t("form.ascent")} unit="m" placeholder="0"
            value={form.ascent} onChange={e => setForm({ ...form, ascent: e.target.value })} />
        )}
        {showCadenceAndGap && (
          <LabeledInput label={t("form.cadence")} unit="spm" placeholder="0"
            value={form.cadence} onChange={e => setForm({ ...form, cadence: e.target.value })} />
        )}
        <LabeledInput label={t("form.te")} unit="1–5" placeholder="0" step="0.1"
          value={form.aerobicTE} onChange={e => setForm({ ...form, aerobicTE: e.target.value })} />
      </div>

      {/* GAP — road running only. Two number inputs split by a fixed colon
          so the user types digits only (mobile keyboard never has to flip
          to symbols for ":"). Minutes: 1 digit (0–9); seconds: 2 digits
          (0–59). Combined back to seconds at save time. */}
      {showCadenceAndGap && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginBottom: 14 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, color: "#666", fontWeight: 500 }}>
              {t("form.gap")}<span style={{ color: "#aaa", fontWeight: 400 }}> (min/km)</span>
            </span>
            <div style={{
              display: "flex", alignItems: "stretch",
              border: "1px solid var(--rule)",
              borderRadius: 2,
              background: "var(--bg-elevated)",
              overflow: "hidden",
            }}>
              <input
                type="number" inputMode="numeric" min="0" max="9" maxLength={1}
                placeholder="6" value={form.gapMin}
                onChange={e => {
                  // Keep at most 1 digit; allow empty so the field clears
                  const v = e.target.value.replace(/[^0-9]/g, "").slice(0, 1);
                  setForm({ ...form, gapMin: v });
                }}
                aria-label={t("form.minutes")}
                style={{
                  flex: 1, width: "100%", boxSizing: "border-box",
                  border: "none", background: "transparent",
                  padding: "10px 8px", fontSize: 14,
                  textAlign: "center", outline: "none",
                  fontFamily: "var(--font-sans)",
                  fontVariantNumeric: "tabular-nums",
                }} />
              <span style={{
                display: "inline-flex", alignItems: "center", padding: "0 6px",
                fontSize: 16, fontWeight: 600, color: "var(--ink-2)",
                fontFamily: "var(--font-mono)", userSelect: "none",
              }}>:</span>
              <input
                type="number" inputMode="numeric" min="0" max="59" maxLength={2}
                placeholder="30" value={form.gapSec}
                onChange={e => {
                  const v = e.target.value.replace(/[^0-9]/g, "").slice(0, 2);
                  setForm({ ...form, gapSec: v });
                }}
                onBlur={e => {
                  // Pad to 2 digits on blur so it reads as "06" not "6".
                  if (e.target.value && e.target.value.length === 1) {
                    setForm({ ...form, gapSec: e.target.value.padStart(2, "0") });
                  }
                }}
                aria-label={t("form.seconds")}
                style={{
                  flex: 1, width: "100%", boxSizing: "border-box",
                  border: "none", background: "transparent",
                  padding: "10px 8px", fontSize: 14,
                  textAlign: "center", outline: "none",
                  fontFamily: "var(--font-sans)",
                  fontVariantNumeric: "tabular-nums",
                }} />
            </div>
          </label>
        </div>
      )}

      {/* RPE — optional, every activity type. Drives the training-load (sRPE)
          calculation. Kept narrow so it doesn't read like a required metric;
          the hint below spells out the 1–10 scale for users new to RPE. */}
      <div style={{ marginBottom: 14 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: 160 }}>
          <span style={{ fontSize: 11, color: "#666", fontWeight: 500 }}>
            {t("form.rpe")}<span style={{ color: "#aaa", fontWeight: 400 }}> (1–10, {t("form.optional")})</span>
          </span>
          <input type="number" inputMode="numeric" min="1" max="10" step="1"
            placeholder="—" value={form.rpe}
            onChange={e => setForm({ ...form, rpe: e.target.value.replace(/[^0-9]/g, "").slice(0, 2) })}
            style={s.input} />
        </label>
        <span style={{ fontSize: 11, color: "#999", lineHeight: 1.45, display: "block", marginTop: 6 }}>
          {t("form.rpe_hint")}
        </span>
      </div>

      {/* Free-text note — travels into the coach prompt verbatim, so things
          like "new shoes" / "knee felt tight" become coaching context. */}
      <div style={{ marginBottom: 14 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 11, color: "#666", fontWeight: 500 }}>
            {t("form.note")}<span style={{ color: "#aaa", fontWeight: 400 }}> ({t("form.optional")})</span>
          </span>
          <textarea rows={2} placeholder={t("form.note_placeholder")}
            value={form.note}
            onChange={e => setForm({ ...form, note: e.target.value })}
            style={{ ...s.input, resize: "vertical", fontFamily: "var(--font-sans)", lineHeight: 1.45 }} />
        </label>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={handleSave} style={s.btn}>{mode === "edit" ? t("common.save_changes") : t("common.save")}</button>
        <button onClick={onCancel} style={s.btnGhost}>{t("common.cancel")}</button>
      </div>
    </div>
  );
}
