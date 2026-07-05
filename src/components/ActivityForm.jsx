import { useState, useEffect, useRef } from "react";
import { s } from "../styles";
import { ACTIVITY_TYPES, RUN_PACE_TYPES, RUN_FLAGS, STRENGTH_SUBS, RUN_GROUP_TYPES, WEATHER_RELEVANT_TYPES } from "../constants";
import { Dropdown } from "./Dropdown";
import { useT } from "../i18n/LanguageContext";
import { recommendRunType } from "../utils/format";
import { useClickOutside } from "../utils/useClickOutside";
import { useIsMobile } from "../hooks/useMediaQuery";
import { weatherWindowEligible } from "../lib/weather";
import { useAppDialog } from "./AppDialogContext";
import { Spinner } from "./Spinner";

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
    rpe: "",
    note: "",
    fetchWeather: true, // Road Run default (outdoor); changeType resets per type
  };
}

function fromLog(log) {
  const d = splitDuration(log.duration || 0);
  return {
    date: normalizeDate(log.date),
    startedAtLocal: formatLocalDateTimeForInput(log.startedAt),
    type: log.type || "Road Run",
    subTypes: Array.isArray(log.subTypes) ? log.subTypes : [],
    // Swimming distance is entered/displayed in meters; stored in km like
    // everything else. Convert km → m for the input here, m → km on save.
    distance: log.distance ? String(log.type === "Swimming" ? Math.round(log.distance * 1000) : log.distance) : "",
    durationH: d.h, durationM: d.m, durationS: d.s,
    hr:        log.hr        ? String(log.hr)        : "",
    maxHR:     log.maxHR     ? String(log.maxHR)     : "",
    ascent:    log.ascent    ? String(log.ascent)    : "",
    cadence:   log.cadence   ? String(log.cadence)   : "",
    rpe:       log.rpe ? String(log.rpe) : "",
    note:      log.note || "",
  };
}

function LabeledInput({ label, unit, value, onChange, placeholder, type = "number", step }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 11, color: "var(--ink-2)", fontWeight: 500 }}>
        {label}{unit && <span style={{ color: "var(--ink-3)", fontWeight: 400 }}> ({unit})</span>}
      </span>
      <input type={type} step={step} placeholder={placeholder} value={value} onChange={onChange} style={s.input} />
    </label>
  );
}

export function ActivityForm({ mode, initial, onSave, onCancel, hrZones }) {
  const t = useT();
  const appDialog = useAppDialog();
  const isMobile = useIsMobile();
  const [form, setForm] = useState(() => initial ? fromLog(initial) : buildEmpty());
  const [saving, setSaving] = useState(false);
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
  const rootRef = useClickOutside(async () => {
    if (!isDirty() || await appDialog.confirm(t("form.discard_confirm"))) onCancel();
  }, mode === "edit" && !saving);

  const isRun = RUN_GROUP_TYPES.includes(form.type);
  const isRoadRun = form.type === "Road Run";
  const isStrength = form.type === "Strength";
  const isCycling = form.type === "Cycling";
  const isSwimming = form.type === "Swimming";
  // A race isn't an easy/tempo/etc session, so when the Race flag is on we hide
  // the run-type picker and don't require a pace type (req #2).
  const isRace = isRun && form.subTypes.includes("Race");
  // Only road Running uses pace types (Easy/Aerobic/Tempo/Interval). Trail / Hiking / Floor just track time + climb.
  const showPaceTypes = isRoadRun && !isRace;
  // Cadence makes sense for road running only. Trail/hiking pace is dominated by
  // terrain, strength has no distance, cycling here has no cadence sensor data.
  const showCadence = isRoadRun;
  // Distance: Run-group (except Floor Climbing, vertical-only) + Cycling + Swimming.
  const showDistance = (isRun && form.type !== "Floor Climbing") || isCycling || isSwimming;
  // Ascent: all Run-group types + Cycling (road climbing). Swimming has none.
  const showAscent = isRun || isCycling;
  const formDurationSec = (parseInt(form.durationH) || 0) * 3600
    + (parseInt(form.durationM) || 0) * 60
    + (parseInt(form.durationS) || 0);

  // Weather toggle is offered ONLY when Caiyun could actually return weather for
  // this moment: now / past 24h / future. Ultra sessions that overlap the past
  // 24h can still get the recent part of their weather range. No start time +
  // today's date counts as "now".
  const weatherEligible = weatherWindowEligible({ startedAt: form.startedAtLocal, date: form.date, durationSec: formDurationSec });

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
    // Default the weather toggle to on for outdoor types, off for indoor
    // (Strength / Floor / Swimming) — user can still override.
    setForm({ ...form, type: t, subTypes: nextSubTypes, fetchWeather: WEATHER_RELEVANT_TYPES.includes(t) });
  }

  async function handleSave() {
    if (saving) return;
    if (!form.date) { appDialog.alert(t("form.alert_date")); return; }
    const dur = formDurationSec;
    if (!dur) { appDialog.alert(t("form.alert_duration")); return; }
    if (form.type === "Strength" && form.subTypes.length === 0) {
      appDialog.alert(t("form.alert_body"));
      return;
    }
    if (form.type === "Road Run" && !isRace && !pickedPace) {
      appDialog.alert(t("form.alert_run"));
      return;
    }
    const rpe = parseInt(form.rpe, 10);
    if (!(rpe >= 1 && rpe <= 10)) {
      appDialog.alert(t("form.alert_rpe"));
      return;
    }
    // Swimming input is in meters → convert back to km for storage.
    const distInput = showDistance ? (parseFloat(form.distance) || 0) : 0;
    const dist = isSwimming ? +(distInput / 1000).toFixed(3) : distInput;
    // pace (min/km) is a running metric only. Cycling shows speed, swimming
    // shows /100m — both derived at display time, so we leave pace at 0.
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

    setSaving(true);
    try {
      await Promise.resolve(onSave({
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
        cadence:   showCadence ? (parseInt(form.cadence) || 0) : 0,
        rpe,
        note:      form.note.trim() || null,
        // Only consulted by addLog (manual add). Edit/import ignore it.
        fetchWeather: form.fetchWeather,
      }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div ref={rootRef} style={{ ...s.cardDark, marginBottom: 14 }}>
      <div style={s.section}>{mode === "edit" ? t("form.edit_title") : t("form.add_title")}</div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 11, color: "var(--ink-2)", fontWeight: 500 }}>{t("form.date")}</span>
          {/* Native date input. Click the calendar icon at the right to open the picker;
              the rest of the input remains editable so users can type YYYY-MM-DD directly. */}
          <input type="date" value={form.date}
            onChange={e => setForm({ ...form, date: e.target.value })}
            style={s.input} />
        </label>
        {/* div, not label — a label wrapping the Dropdown's button double-fires
            the click (open→close) and the picker never opens. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 11, color: "var(--ink-2)", fontWeight: 500 }}>{t("form.type")}</span>
          <Dropdown
            ariaLabel={t("form.type")}
            options={ACTIVITY_TYPES.map(at => ({ value: at, label: t(`enum.activity.${at}`) }))}
            value={form.type}
            onChange={changeType}
          />
        </div>
      </div>

      {/* Optional start time. Empty = "weather snapshot at the moment of save".
          Filled = past timestamp → historical weather at that time; future =
          forecast for that day. The hint is short so it doesn't dominate the
          form for users who never need this field. */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 11, color: "var(--ink-2)", fontWeight: 500 }}>
            {t("form.started_at")}
            <span style={{ color: "var(--ink-3)", fontWeight: 400 }}> ({t("form.started_at_optional")})</span>
          </span>
          <input type="datetime-local" value={form.startedAtLocal}
            onChange={e => setForm({ ...form, startedAtLocal: e.target.value })}
            style={s.input} />
          <span style={{ fontSize: 11, color: "var(--ink-3)", lineHeight: 1.4 }}>{t("form.started_at_hint")}</span>
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
          <LabeledInput label={t("form.distance")} unit={isSwimming ? "m" : "km"} placeholder="0"
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
        {showCadence && (
          <LabeledInput label={t("form.cadence")} unit="spm" placeholder="0"
            value={form.cadence} onChange={e => setForm({ ...form, cadence: e.target.value })} />
        )}
      </div>

      {/* RPE — required for completed activities. Drives training-load (sRPE). */}
      <div style={{ marginBottom: 14 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: 160 }}>
          <span style={{ fontSize: 11, color: "var(--ink-2)", fontWeight: 500 }}>
            {t("form.rpe")}<span style={{ color: "var(--ink-3)", fontWeight: 400 }}> (1–10, {t("form.required_short")})</span>
          </span>
          <input type="number" inputMode="numeric" min="1" max="10" step="1"
            placeholder="—" value={form.rpe}
            onChange={e => setForm({ ...form, rpe: e.target.value.replace(/[^0-9]/g, "").slice(0, 2) })}
            style={s.input} />
        </label>
        <span style={{ fontSize: 11, color: "var(--ink-3)", lineHeight: 1.45, display: "block", marginTop: 6 }}>
          {t("form.rpe_hint")}
        </span>
      </div>

      {/* Free-text note — travels into the coach prompt verbatim, so things
          like "new shoes" / "knee felt tight" become coaching context. */}
      <div style={{ marginBottom: 14 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 11, color: "var(--ink-2)", fontWeight: 500 }}>
            {t("form.note")}<span style={{ color: "var(--ink-3)", fontWeight: 400 }}> ({t("form.optional")})</span>
          </span>
          <textarea rows={2} placeholder={t("form.note_placeholder")}
            value={form.note}
            onChange={e => setForm({ ...form, note: e.target.value })}
            style={{ ...s.input, resize: "vertical", fontFamily: "var(--font-sans)", lineHeight: 1.45 }} />
        </label>
      </div>

      {/* Weather toggle — manual add only (edit/import don't capture weather).
          Defaults on for outdoor types, off for indoor; user decides. Hidden
          when the session is older than Caiyun's 24h window (no data to fetch). */}
      {mode !== "edit" && weatherEligible && (
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, cursor: "pointer" }}>
          <input type="checkbox" checked={form.fetchWeather}
            onChange={e => setForm({ ...form, fetchWeather: e.target.checked })}
            style={{ width: 16, height: 16, flexShrink: 0, minHeight: 0 }} />
          <span style={{ fontSize: 12, color: "var(--ink-2)" }}>{t("form.fetch_weather")}</span>
        </label>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={handleSave}
          disabled={saving}
          aria-busy={saving ? "true" : undefined}
          style={{ ...s.btn, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, opacity: saving ? 0.72 : 1 }}
        >
          {saving && <Spinner size={13} thickness={1.6} color="currentColor" />}
          {saving ? t("common.saving") : (mode === "edit" ? t("common.save_changes") : t("common.save"))}
        </button>
        <button onClick={onCancel} disabled={saving} style={{ ...s.btnGhost, opacity: saving ? 0.55 : 1 }}>{t("common.cancel")}</button>
      </div>
    </div>
  );
}
