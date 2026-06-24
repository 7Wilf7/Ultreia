import { useState } from "react";
import { useT } from "../i18n/LanguageContext";
import { ModalRoot } from "./ModalRoot";
import { WEATHER_UPDATE_INTERVAL_OPTIONS } from "../lib/weather";

export function WeatherSettingsModal({ weatherAutoUpdate, weatherIntervalHours, setWeatherSettings, onClose }) {
  const t = useT();
  const [autoUpdate, setAutoUpdate] = useState(weatherAutoUpdate !== false);
  const [intervalHours, setIntervalHours] = useState(Number(weatherIntervalHours) || 3);

  function save() {
    setWeatherSettings({ autoUpdate, intervalHours });
    onClose();
  }

  return (
    <ModalRoot onClose={onClose}>
      <div style={s.overlay} onClick={onClose}>
        <div style={s.modal} onClick={e => e.stopPropagation()}>
          <div style={s.header}>
            <h2 style={s.title}>{t("weather_settings.title")}</h2>
            <button onClick={onClose} style={s.close} aria-label="Close">×</button>
          </div>

          <label style={s.switchRow}>
            <span>
              <span style={s.primary}>{t("weather_settings.auto_update")}</span>
              <span style={s.secondary}>{t("weather_settings.auto_update_desc")}</span>
            </span>
            <input
              type="checkbox"
              checked={autoUpdate}
              onChange={e => setAutoUpdate(e.target.checked)}
              style={{ width: 20, height: 20 }}
            />
          </label>

          <div style={{ opacity: autoUpdate ? 1 : 0.45, pointerEvents: autoUpdate ? "auto" : "none" }}>
            <div style={{ ...s.label, marginTop: 16 }}>{t("weather_settings.interval")}</div>
            <div style={s.segment}>
              {WEATHER_UPDATE_INTERVAL_OPTIONS.map(h => (
                <button
                  key={h}
                  type="button"
                  onClick={() => setIntervalHours(h)}
                  style={s.segBtn(intervalHours === h)}
                >
                  {h === 24 ? t("weather_settings.daily") : t("weather_settings.hours", { n: String(h) })}
                </button>
              ))}
            </div>
          </div>

          <div style={s.note}>{t("weather_settings.behavior_note")}</div>

          <div style={s.actions}>
            <button onClick={onClose} style={s.secondaryBtn}>{t("common.cancel")}</button>
            <button onClick={save} style={s.primaryBtn}>{t("common.save")}</button>
          </div>
        </div>
      </div>
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
  segment: { display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 6 },
  segBtn: (active) => ({
    border: `1px solid ${active ? "var(--accent)" : "var(--rule)"}`,
    background: active ? "var(--accent-soft)" : "var(--bg-elevated)",
    color: active ? "var(--accent-dark)" : "var(--ink-1)",
    borderRadius: 6,
    minHeight: 36,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  }),
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
  primaryBtn: { border: "1px solid var(--accent)", background: "linear-gradient(180deg, oklch(0.58 0.060 138), var(--accent))", color: "var(--accent-ink)", borderRadius: 6, padding: "9px 14px", cursor: "pointer" },
};
