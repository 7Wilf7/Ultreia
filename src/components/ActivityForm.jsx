import { useState, useEffect, useRef } from "react";
import { s } from "../styles";
import { ACTIVITY_TYPES, RUN_PACE_TYPES, RUN_FLAGS, STRENGTH_SUBS, RUN_GROUP_TYPES } from "../constants";
import { useT } from "../i18n/LanguageContext";
import { parseTimeToSeconds, formatPaceFromSec } from "../utils/format";
import { useClickOutside } from "../utils/useClickOutside";

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

function buildEmpty() {
  return {
    date: "",
    type: "Road Run",
    subTypes: ["Easy Run"],
    distance: "",
    durationH: "", durationM: "", durationS: "",
    hr: "", maxHR: "",
    ascent: "",
    cadence: "",
    aerobicTE: "",
    gapText: "",
  };
}

function fromLog(log) {
  const d = splitDuration(log.duration || 0);
  return {
    date: normalizeDate(log.date),
    type: log.type || "Road Run",
    subTypes: Array.isArray(log.subTypes) ? log.subTypes : [],
    distance: log.distance ? String(log.distance) : "",
    durationH: d.h, durationM: d.m, durationS: d.s,
    hr:        log.hr        ? String(log.hr)        : "",
    maxHR:     log.maxHR     ? String(log.maxHR)     : "",
    ascent:    log.ascent    ? String(log.ascent)    : "",
    cadence:   log.cadence   ? String(log.cadence)   : "",
    aerobicTE: log.aerobicTE ? String(log.aerobicTE) : "",
    gapText:   log.gap       ? formatPaceFromSec(log.gap) : "",
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

export function ActivityForm({ mode, initial, onSave, onCancel }) {
  const t = useT();
  const [form, setForm] = useState(() => initial ? fromLog(initial) : buildEmpty());
  // Snapshot of the form's initial state — used to detect unsaved changes when
  // the user clicks outside in edit mode.
  const initialFormRef = useRef(initial ? fromLog(initial) : buildEmpty());

  useEffect(() => {
    if (initial) {
      const snapshot = fromLog(initial);
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
  // Only road Running uses pace types (Easy/Aerobic/Tempo/Interval). Trail / Hiking / Floor just track time + climb.
  const showPaceTypes = isRoadRun;
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
    const next = pickedPace ? [pickedPace, ...newFlags] : newFlags;
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
    if (form.type === "Road Run" && !pickedPace) {
      alert(t("form.alert_run"));
      return;
    }
    const dist = showDistance ? (parseFloat(form.distance) || 0) : 0;
    const pace = (dist > 0 && isRun) ? Math.round(dur / dist) : 0;

    onSave({
      date: form.date,
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
      gap:       showCadenceAndGap ? (parseTimeToSeconds(form.gapText) || 0) : 0,
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
          <select value={form.type} onChange={e => changeType(e.target.value)} style={s.input}>
            {ACTIVITY_TYPES.map(at => <option key={at} value={at}>{t(`enum.activity.${at}`)}</option>)}
          </select>
        </label>
      </div>

      {showPaceTypes && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ ...s.label, marginBottom: 6 }}>
            {t("form.run_type")} {t("form.run_type_required")}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {RUN_PACE_TYPES.map(sub => (
              <button key={sub} type="button"
                onClick={() => setPace(pickedPace === sub ? "" : sub)}
                style={s.chip(pickedPace === sub)}>{t(`enum.subtype.${sub}`)}</button>
            ))}
          </div>
        </div>
      )}
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

      {/* GAP — road running only. Stays in a 3-col grid for visual consistency. */}
      {showCadenceAndGap && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginBottom: 14 }}>
          <LabeledInput label={t("form.gap")} unit="min/km" placeholder="6:30" type="text"
            value={form.gapText} onChange={e => setForm({ ...form, gapText: e.target.value })} />
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={handleSave} style={s.btn}>{mode === "edit" ? t("common.save_changes") : t("common.save")}</button>
        <button onClick={onCancel} style={s.btnGhost}>{t("common.cancel")}</button>
      </div>
    </div>
  );
}
