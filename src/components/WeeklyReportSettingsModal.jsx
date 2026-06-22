import { useState } from "react";
import { useT } from "../i18n/LanguageContext";
import { ModalRoot } from "./ModalRoot";
import { TimeWheelModal } from "./WheelPicker";

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

function cleanWeekday(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 6 ? n : 0;
}

function cleanTime(value) {
  return typeof value === "string" && /^\d{2}:\d{2}$/.test(value) ? value : "20:00";
}

export function WeeklyReportSettingsModal({
  weeklyReportSettings,
  setWeeklyReportSettings,
  onClose,
}) {
  const t = useT();
  const initial = weeklyReportSettings || {};
  const [enabled, setEnabled] = useState(initial.enabled === true);
  const [weekday, setWeekday] = useState(cleanWeekday(initial.weekday));
  const [time, setTime] = useState(cleanTime(initial.time));
  const [afterSundayImport, setAfterSundayImport] = useState(initial.afterSundayImport !== false);
  const [timePickerOpen, setTimePickerOpen] = useState(false);

  function save() {
    setWeeklyReportSettings({
      weeklyReportEnabled: enabled,
      weeklyReportWeekday: weekday,
      weeklyReportTime: time,
      weeklyReportAfterSundayImport: afterSundayImport,
    });
    onClose();
  }

  return (
    <ModalRoot onClose={onClose}>
      <div style={s.overlay} onClick={onClose}>
        <div style={s.modal} onClick={e => e.stopPropagation()}>
          <div style={s.header}>
            <h2 style={s.title}>{t("weekly_settings.title")}</h2>
            <button onClick={onClose} style={s.close} aria-label="Close">×</button>
          </div>

          <label style={s.switchRow}>
            <span>
              <span style={s.primary}>{t("weekly_settings.auto_generate")}</span>
              <span style={s.secondary}>{t("weekly_settings.auto_generate_desc")}</span>
            </span>
            <input
              type="checkbox"
              checked={enabled}
              onChange={e => setEnabled(e.target.checked)}
              style={{ width: 20, height: 20 }}
            />
          </label>

          <div style={{ opacity: enabled ? 1 : 0.45, pointerEvents: enabled ? "auto" : "none" }}>
            <div style={{ ...s.label, marginTop: 16 }}>{t("weekly_settings.schedule")}</div>
            <div style={s.scheduleGrid}>
              <select
                value={weekday}
                onChange={e => setWeekday(cleanWeekday(e.target.value))}
                style={s.select}
              >
                {WEEKDAYS.map(day => (
                  <option key={day} value={day}>{t(`weekly_settings.day_${day}`)}</option>
                ))}
              </select>
              <button type="button" onClick={() => setTimePickerOpen(true)} style={s.timeButton}>
                <span style={s.timeValue}>{time}</span>
                <span style={s.timeChevron}>⌄</span>
              </button>
            </div>
          </div>

          <label style={s.switchRow}>
            <span>
              <span style={s.primary}>{t("weekly_settings.after_sunday_import")}</span>
              <span style={s.secondary}>{t("weekly_settings.after_sunday_import_desc")}</span>
            </span>
            <input
              type="checkbox"
              checked={afterSundayImport}
              onChange={e => setAfterSundayImport(e.target.checked)}
              style={{ width: 20, height: 20 }}
            />
          </label>

          <div style={s.note}>{t("weekly_settings.behavior_note")}</div>

          <div style={s.actions}>
            <button onClick={onClose} style={s.secondaryBtn}>{t("common.cancel")}</button>
            <button onClick={save} style={s.primaryBtn}>{t("common.save")}</button>
          </div>
        </div>
      </div>
      {timePickerOpen && (
        <TimeWheelModal
          value={time}
          title={t("weekly_settings.pick_time")}
          onConfirm={(next) => {
            setTime(cleanTime(next));
            setTimePickerOpen(false);
          }}
          onClose={() => setTimePickerOpen(false)}
        />
      )}
    </ModalRoot>
  );
}

const s = {
  overlay: {
    position: "fixed", inset: 0, zIndex: 9999,
    background: "rgba(0,0,0,0.28)",
    display: "flex", alignItems: "center", justifyContent: "center",
    padding: 18,
  },
  modal: {
    width: "min(440px, 100%)",
    background: "var(--bg)",
    color: "var(--ink-1)",
    border: "1px solid var(--rule)",
    borderRadius: 8,
    boxShadow: "0 18px 50px rgba(0,0,0,0.24)",
    padding: 18,
    fontFamily: "var(--font-sans)",
  },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 },
  title: { margin: 0, fontSize: 18, fontWeight: 600 },
  close: { border: "none", background: "transparent", color: "var(--ink-2)", fontSize: 24, lineHeight: 1, cursor: "pointer" },
  switchRow: {
    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
    padding: "12px 0", borderBottom: "1px solid var(--rule-soft)",
  },
  primary: { display: "block", fontSize: 14, fontWeight: 600 },
  secondary: { display: "block", marginTop: 4, fontSize: 12, color: "var(--ink-3)", lineHeight: 1.45 },
  label: { fontSize: 12, fontWeight: 600, color: "var(--ink-2)", marginBottom: 8 },
  scheduleGrid: { display: "grid", gridTemplateColumns: "minmax(0, 1fr) 104px", gap: 8 },
  select: {
    border: "1px solid var(--rule)",
    background: "var(--bg-elevated)",
    color: "var(--ink-1)",
    borderRadius: 6,
    padding: "9px 10px",
    fontSize: 13,
    minHeight: 38,
  },
  timeButton: {
    border: "1px solid var(--rule)",
    background: "var(--bg-elevated)",
    color: "var(--ink-1)",
    borderRadius: 6,
    padding: "8px 9px",
    fontSize: 13,
    minHeight: 38,
    fontFamily: "var(--font-mono)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
    cursor: "pointer",
    minWidth: 0,
  },
  timeValue: { fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" },
  timeChevron: { color: "var(--ink-3)", fontFamily: "var(--font-sans)", fontSize: 13, flexShrink: 0 },
  note: {
    marginTop: 16,
    padding: 12,
    background: "var(--bg-elevated)",
    border: "1px solid var(--rule-soft)",
    borderRadius: 6,
    fontSize: 12,
    lineHeight: 1.55,
    color: "var(--ink-2)",
  },
  actions: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 },
  secondaryBtn: { border: "1px solid var(--rule)", background: "var(--bg)", color: "var(--ink-1)", borderRadius: 6, padding: "9px 14px", cursor: "pointer" },
  primaryBtn: { border: "1px solid var(--ink-1)", background: "var(--ink-1)", color: "var(--ink-inv)", borderRadius: 6, padding: "9px 14px", cursor: "pointer" },
};
