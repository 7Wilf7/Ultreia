import { useState } from "react";
import { useT } from "../i18n/LanguageContext";
import { ModalRoot } from "./ModalRoot";
import { SingleWheelModal, TimeWheelModal } from "./WheelPicker";
import { Spinner } from "./Spinner";
import { useInstantPress, useInstantTap } from "../hooks/useInstantPress";

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
  const instantPress = useInstantPress();
  const instantTap = useInstantTap();
  const initial = weeklyReportSettings || {};
  const [enabled, setEnabled] = useState(initial.enabled === true);
  const [weekday, setWeekday] = useState(cleanWeekday(initial.weekday));
  const [time, setTime] = useState(cleanTime(initial.time));
  const [afterSundayImport, setAfterSundayImport] = useState(initial.afterSundayImport !== false);
  const [weekdayPickerOpen, setWeekdayPickerOpen] = useState(false);
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [saving, setSaving] = useState(false);
  const weekdayOptions = WEEKDAYS.map(day => ({ value: day, label: t(`weekly_settings.day_${day}`) }));
  const infoText = [
    t("weekly_settings.auto_generate_desc"),
    t("weekly_settings.after_sunday_import_desc"),
    t("weekly_settings.behavior_note"),
  ].join("\n\n");

  function closeIfIdle() {
    if (!saving) onClose();
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      await Promise.resolve(setWeeklyReportSettings({
        weeklyReportEnabled: enabled,
        weeklyReportWeekday: weekday,
        weeklyReportTime: time,
        weeklyReportAfterSundayImport: afterSundayImport,
      }));
      onClose();
    } catch (err) {
      console.error("[weekly-report] settings save failed:", err);
      setSaving(false);
    }
  }

  return (
    <ModalRoot onClose={closeIfIdle}>
      <div style={s.overlay} onClick={closeIfIdle}>
        <div style={s.modal} onClick={e => e.stopPropagation()}>
          <div style={s.header}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <h2 style={s.title}>{t("weekly_settings.title")}</h2>
              <InfoHintButton
                label={infoText}
                open={showInfo}
                onClick={() => setShowInfo(v => !v)}
              />
            </div>
            <button {...instantPress("weekly-settings-close", closeIfIdle)} disabled={saving} style={{ ...s.close, opacity: saving ? 0.45 : 1 }} aria-label="Close">×</button>
          </div>
          {showInfo && (
            <div style={s.infoPanel}>{infoText}</div>
          )}

          <div style={s.switchRow}>
            <span>
              <span style={s.primary}>{t("weekly_settings.auto_generate")}</span>
            </span>
            <button
              type="button"
              {...instantPress("weekly-settings-enabled-toggle", () => setEnabled(v => !v))}
              disabled={saving}
              role="switch"
              aria-checked={enabled}
              style={s.switchButton(enabled, saving)}
            >
              <span style={s.switchKnob(enabled)} />
            </button>
          </div>

          <div style={{ opacity: enabled ? 1 : 0.45, pointerEvents: enabled ? "auto" : "none" }}>
            <div style={{ ...s.label, marginTop: 16 }}>{t("weekly_settings.schedule")}</div>
            <div style={s.scheduleGrid}>
              <button type="button" {...instantTap("weekly-settings-open-weekday", () => setWeekdayPickerOpen(true))} disabled={saving} style={s.scheduleButton}>
                <span style={s.weekdayValue}>{t(`weekly_settings.day_${weekday}`)}</span>
                <span style={s.scheduleChevron}>⌄</span>
              </button>
              <button type="button" {...instantTap("weekly-settings-open-time", () => setTimePickerOpen(true))} disabled={saving} style={s.scheduleButton}>
                <span style={s.timeValue}>{time}</span>
                <span style={s.scheduleChevron}>⌄</span>
              </button>
            </div>
          </div>

          <div style={s.switchRow}>
            <span>
              <span style={s.primary}>{t("weekly_settings.after_sunday_import")}</span>
            </span>
            <button
              type="button"
              {...instantPress("weekly-settings-after-import-toggle", () => setAfterSundayImport(v => !v))}
              disabled={saving}
              role="switch"
              aria-checked={afterSundayImport}
              style={s.switchButton(afterSundayImport, saving)}
            >
              <span style={s.switchKnob(afterSundayImport)} />
            </button>
          </div>

          <div style={s.actions}>
            <button {...instantPress("weekly-settings-cancel", closeIfIdle)} disabled={saving} style={{ ...s.secondaryBtn, opacity: saving ? 0.55 : 1 }}>{t("common.cancel")}</button>
            <button
              onClick={save}
              disabled={saving}
              aria-busy={saving ? "true" : undefined}
              style={{ ...s.primaryBtn, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, opacity: saving ? 0.72 : 1 }}
            >
              {saving && <Spinner size={13} thickness={1.6} color="currentColor" />}
              {saving ? t("common.saving") : t("common.save")}
            </button>
          </div>
        </div>
      </div>
      {weekdayPickerOpen && (
        <SingleWheelModal
          value={weekday}
          options={weekdayOptions}
          title={t("weekly_settings.pick_day")}
          ariaLabel={t("weekly_settings.pick_day")}
          onConfirm={(next) => {
            setWeekday(cleanWeekday(next));
            setWeekdayPickerOpen(false);
          }}
          onClose={() => setWeekdayPickerOpen(false)}
        />
      )}
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

function InfoHintButton({ label, open, onClick }) {
  const instantPress = useInstantPress();
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-expanded={open}
      {...instantPress("weekly-settings-info-hint", onClick)}
      style={s.infoButton(open)}
    >
      !
    </button>
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
  switchButton: (checked, disabled) => ({
    width: 40,
    height: 22,
    minHeight: 22,
    flexShrink: 0,
    borderRadius: 999,
    border: "1px solid var(--rule)",
    background: checked ? "var(--accent)" : "var(--bg-elevated)",
    position: "relative",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.55 : 1,
    padding: 0,
    touchAction: "manipulation",
    WebkitTapHighlightColor: "transparent",
  }),
  switchKnob: (checked) => ({
    position: "absolute",
    top: 2,
    left: checked ? 20 : 2,
    width: 16,
    height: 16,
    borderRadius: "50%",
    background: checked ? "var(--accent-ink)" : "var(--ink-3)",
    boxShadow: "0 1px 2px oklch(0 0 0 / 0.22)",
  }),
  label: { fontSize: 12, fontWeight: 600, color: "var(--ink-2)", marginBottom: 8 },
  scheduleGrid: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 },
  scheduleButton: {
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
  weekdayValue: { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 },
  timeValue: { fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" },
  scheduleChevron: { color: "var(--ink-3)", fontFamily: "var(--font-sans)", fontSize: 13, flexShrink: 0 },
  infoButton: (open) => ({
    width: 18,
    height: 18,
    minHeight: 0,
    padding: 0,
    borderRadius: 999,
    border: "1px solid var(--rule)",
    background: open ? "var(--accent-soft)" : "transparent",
    color: open ? "var(--accent-dark)" : "var(--ink-3)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 12,
    lineHeight: 1,
    flexShrink: 0,
    cursor: "pointer",
    touchAction: "manipulation",
    WebkitTapHighlightColor: "transparent",
  }),
  infoPanel: {
    whiteSpace: "pre-line",
    marginBottom: 14,
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
  primaryBtn: { border: "1px solid var(--accent)", background: "linear-gradient(180deg, oklch(0.58 0.060 138), var(--accent))", color: "var(--accent-ink)", borderRadius: 6, padding: "9px 14px", cursor: "pointer" },
};
