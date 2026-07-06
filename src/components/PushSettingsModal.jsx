import { useState } from "react";
import { s } from "../styles";
import { useT } from "../i18n/LanguageContext";
import { ModalRoot } from "./ModalRoot";
import { TimeWheelModal } from "./WheelPicker";
import { Spinner } from "./Spinner";
import { useInstantPress, useInstantTap } from "../hooks/useInstantPress";

const MAX_TIMES = 3;

// Daily coach push settings. Persists to user_settings (push_enabled /
// push_hours / push_timezone); the server-side dispatch reads them to decide
// who to push and at which local hours. Up to 3 times a day (for runners who
// train more than once). Timezone is auto-detected on save — the user picks
// wall-clock hours, the server maps them to UTC via the IANA name.
//
// Push only fires on the Android APK (FCM). On web this screen still saves the
// preference, but no notification is delivered.
// All 48 half-hour slots: "00:00", "00:30", … "23:30".
const HALF_HOUR_SLOTS = Array.from({ length: 48 }, (_, i) =>
  `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 === 0 ? "00" : "30"}`);

export function PushSettingsModal({ pushEnabled, pushHours, pushTimes, pushTimezone, setPushSettings, onClose }) {
  const t = useT();
  const instantPress = useInstantPress();
  const instantTap = useInstantTap();
  const [enabled, setEnabled] = useState(pushEnabled === true);
  const [showInfo, setShowInfo] = useState(false);
  // Working copy of "HH:MM" half-hour slots. Prefer the new push_times; fall
  // back to the legacy whole-hour list (8 → "08:00"); default to one 08:00 slot.
  const initial = (Array.isArray(pushTimes) && pushTimes.length)
    ? [...new Set(pushTimes)].sort()
    : (Array.isArray(pushHours) && pushHours.length)
      ? [...new Set(pushHours.map(h => `${String(h).padStart(2, "0")}:00`))].sort()
      : ["08:00"];
  const [times, setTimes] = useState(initial);
  // Which time row's wheel picker is open (null = none).
  const [editingIdx, setEditingIdx] = useState(null);
  const [saving, setSaving] = useState(false);

  const detectedTz = (() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; }
    catch { return ""; }
  })();
  const infoText = [
    t("push.hint"),
    t("push.apk_note"),
    t("push.keepalive_note"),
  ].join("\n\n");

  function setTimeAt(idx, value) {
    setTimes(prev => prev.map((tm, i) => (i === idx ? value : tm)));
  }
  function removeAt(idx) {
    setTimes(prev => prev.filter((_, i) => i !== idx));
  }
  function addTime() {
    setTimes(prev => {
      if (prev.length >= MAX_TIMES) return prev;
      const used = new Set(prev);
      const next = HALF_HOUR_SLOTS.find(s => !used.has(s)) || "08:00";
      return [...prev, next];
    });
  }

  function closeIfIdle() {
    if (!saving) onClose();
  }

  async function save() {
    if (saving) return;
    // De-dupe + sort on the way out; if enabling with no slots, keep ["08:00"].
    const clean = [...new Set(times)].sort();
    setSaving(true);
    try {
      await Promise.resolve(setPushSettings({
        pushEnabled: enabled,
        pushTimes: enabled ? (clean.length ? clean : ["08:00"]) : clean,
        pushTimezone: detectedTz || pushTimezone || "",
      }));
      onClose();
    } catch (e) {
      console.error("[push] settings save failed:", e);
      setSaving(false);
    }
  }

  return (
    <ModalRoot onClose={closeIfIdle}>
      <div onClick={closeIfIdle} className="ultreia-overlay-in" style={{
        position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
        background: "oklch(0.04 0.006 274 / 0.72)",
        backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 9999, padding: 16, overscrollBehavior: "contain",
      }}>
        <div onClick={e => e.stopPropagation()} className="ultreia-modal-in" style={{
          background: "var(--panel)", border: "1px solid var(--rule)",
          borderRadius: 12, boxShadow: "var(--shadow)",
          width: "100%", maxWidth: 480, maxHeight: "calc(100dvh - 32px)",
          overflowY: "auto", padding: "22px 24px 20px", boxSizing: "border-box",
          fontFamily: "var(--font-sans)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: showInfo ? 10 : 14, gap: 12 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <h2 style={{ fontSize: 19, fontWeight: 500, margin: 0 }}>{t("push.title")}</h2>
              <InfoHintButton
                label={infoText}
                open={showInfo}
                onClick={() => setShowInfo(v => !v)}
              />
            </div>
            <button onClick={closeIfIdle} disabled={saving} style={{ ...s.modalCloseBtn, opacity: saving ? 0.45 : 1 }} aria-label="Close">×</button>
          </div>
          {showInfo && (
            <div style={infoPanelStyle}>{infoText}</div>
          )}

          {/* Enable toggle */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <button
              {...instantPress("push-enabled-toggle", () => setEnabled(v => !v))}
              disabled={saving}
              role="switch"
              aria-checked={enabled}
              style={{
                width: 40, height: 22, minHeight: 22, flexShrink: 0, borderRadius: 11,
                border: "none", boxSizing: "border-box",
                background: enabled ? "var(--accent)" : "var(--panel-3)",
                position: "relative", cursor: "pointer", transition: "background 0.15s",
                padding: 0,
                touchAction: "manipulation",
                WebkitTapHighlightColor: "transparent",
              }}>
              <span style={{
                position: "absolute", top: 2, left: enabled ? 20 : 2,
                width: 18, height: 18, borderRadius: "50%",
                background: "var(--ink-inv)", boxShadow: "0 1px 2px oklch(0 0 0 / 0.35)",
                transition: "left 0.15s",
              }} />
            </button>
            <span style={{ fontSize: 15, color: "var(--ink-1)" }}>
              {enabled ? t("push.enabled_on") : t("push.enabled_off")}
            </span>
          </div>

          {/* Times — up to 3. Only meaningful when enabled. */}
          <div style={{ opacity: enabled ? 1 : 0.45, pointerEvents: enabled ? "auto" : "none", marginBottom: 14 }}>
            <div style={{ ...s.label, marginBottom: 8 }}>{t("push.times_label")}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {times.map((tm, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button
                    {...instantTap(`push-time-open-${i}`, () => setEditingIdx(i))}
                    disabled={saving}
                    style={{
                      ...s.input, maxWidth: 140, cursor: "pointer", textAlign: "left",
                      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                      fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", fontSize: 16,
                      touchAction: "manipulation", WebkitTapHighlightColor: "transparent",
                    }}>
                    <span>{tm}</span>
                    <span style={{ fontSize: 11, color: "var(--ink-3)" }}>▾</span>
                  </button>
                  {times.length > 1 && (
                    <button
                      onClick={() => removeAt(i)}
                      disabled={saving}
                      aria-label={t("push.remove_time")}
                      style={{
                        border: "none", background: "none", color: "var(--ink-3)",
                        cursor: "pointer", fontSize: 16, padding: "0 6px", lineHeight: 1,
                      }}>×</button>
                  )}
                </div>
              ))}
            </div>
            {times.length < MAX_TIMES && (
              <button
                {...instantTap("push-add-time", addTime)}
                disabled={saving}
                style={{ ...s.btnGhost, fontSize: 12, padding: "6px 12px", marginTop: 10, touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}>
                {t("push.add_time")}
              </button>
            )}
            <div style={{ ...s.muted, fontSize: 11, marginTop: 10, lineHeight: 1.5 }}>
              {t("push.tz_note", { tz: detectedTz || pushTimezone || "—" })}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
            <button onClick={closeIfIdle} disabled={saving} style={{ ...s.btnGhost, opacity: saving ? 0.55 : 1 }}>{t("common.cancel")}</button>
            <button
              onClick={save}
              disabled={saving}
              aria-busy={saving ? "true" : undefined}
              style={{ ...s.btn, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, opacity: saving ? 0.72 : 1 }}
            >
              {saving && <Spinner size={13} thickness={1.6} color="currentColor" />}
              {saving ? t("common.saving") : t("common.save")}
            </button>
          </div>

          {editingIdx != null && (
            <TimeWheelModal
              value={times[editingIdx]}
              onConfirm={(v) => { setTimeAt(editingIdx, v); setEditingIdx(null); }}
              onClose={() => setEditingIdx(null)}
            />
          )}
        </div>
      </div>
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
      {...instantPress("push-info-hint", onClick)}
      style={{
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
      }}
    >
      !
    </button>
  );
}

const infoPanelStyle = {
  whiteSpace: "pre-line",
  fontSize: 12,
  lineHeight: 1.55,
  color: "var(--ink-2)",
  background: "var(--bg-elevated)",
  border: "1px solid var(--rule-soft)",
  borderRadius: 6,
  padding: 10,
  marginBottom: 14,
};
