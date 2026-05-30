import { useState } from "react";
import { s } from "../styles";
import { useT } from "../i18n/LanguageContext";
import { ModalRoot } from "./ModalRoot";

const MAX_TIMES = 3;

// Daily coach push settings. Persists to user_settings (push_enabled /
// push_hours / push_timezone); the server-side dispatch reads them to decide
// who to push and at which local hours. Up to 3 times a day (for runners who
// train more than once). Timezone is auto-detected on save — the user picks
// wall-clock hours, the server maps them to UTC via the IANA name.
//
// Push only fires on the Android APK (FCM). On web this screen still saves the
// preference, but no notification is delivered.
export function PushSettingsModal({ pushEnabled, pushHours, pushTimezone, setPushSettings, onClose }) {
  const t = useT();
  const [enabled, setEnabled] = useState(pushEnabled === true);
  // Local working copy: sorted, de-duped hours. Default to a single 08:00 slot
  // so a freshly-enabled user has something sensible to save.
  const initial = Array.isArray(pushHours) && pushHours.length
    ? [...new Set(pushHours)].sort((a, b) => a - b)
    : [8];
  const [hours, setHours] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const detectedTz = (() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; }
    catch { return ""; }
  })();

  function setHourAt(idx, value) {
    setHours(prev => prev.map((h, i) => (i === idx ? value : h)));
  }
  function removeAt(idx) {
    setHours(prev => prev.filter((_, i) => i !== idx));
  }
  function addTime() {
    setHours(prev => {
      if (prev.length >= MAX_TIMES) return prev;
      // Pick the first hour not already chosen, so the new row isn't a dup.
      const used = new Set(prev);
      let h = 8;
      for (let cand = 0; cand < 24; cand++) { if (!used.has(cand)) { h = cand; break; } }
      return [...prev, h];
    });
  }

  async function save() {
    setBusy(true);
    setMsg("");
    try {
      // De-dupe + sort on the way out; if enabling with no slots, keep [8].
      const clean = [...new Set(hours)].sort((a, b) => a - b);
      await setPushSettings({
        pushEnabled: enabled,
        pushHours: enabled ? (clean.length ? clean : [8]) : clean,
        pushTimezone: detectedTz || pushTimezone || "",
      });
      setMsg(t("push.saved"));
      setTimeout(() => onClose(), 700);
    } catch (e) {
      setMsg(t("push.save_failed", { msg: e?.message || String(e) }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalRoot onClose={onClose}>
      <div onClick={onClose} style={{
        position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
        background: "rgba(20,20,19,0.45)",
        backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 9999, padding: 16, overscrollBehavior: "contain",
      }}>
        <div onClick={e => e.stopPropagation()} style={{
          background: "var(--bg-elevated)", border: "1px solid var(--rule)",
          borderRadius: 4, boxShadow: "0 18px 50px rgba(0,0,0,0.25)",
          width: "100%", maxWidth: 480, maxHeight: "calc(100dvh - 32px)",
          overflowY: "auto", padding: "22px 24px 20px", boxSizing: "border-box",
          fontFamily: "var(--font-sans)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
            <h2 style={{ fontSize: 19, fontWeight: 500, margin: 0 }}>{t("push.title")}</h2>
            <button onClick={onClose} style={s.modalCloseBtn} aria-label="Close">×</button>
          </div>
          <p style={{ ...s.muted, marginBottom: 18, lineHeight: 1.6, fontSize: 12 }}>
            {t("push.hint")}
          </p>

          {/* Enable toggle */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <button
              onClick={() => setEnabled(v => !v)}
              role="switch"
              aria-checked={enabled}
              style={{
                width: 40, height: 22, minHeight: 22, flexShrink: 0, borderRadius: 11,
                border: "none", boxSizing: "border-box",
                background: enabled ? "var(--moss)" : "var(--rule)",
                position: "relative", cursor: "pointer", transition: "background 0.15s",
                padding: 0,
              }}>
              <span style={{
                position: "absolute", top: 2, left: enabled ? 20 : 2,
                width: 18, height: 18, borderRadius: "50%",
                background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,0.35)",
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
              {hours.map((h, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <select value={h} onChange={e => setHourAt(i, parseInt(e.target.value, 10))}
                    style={{ ...s.input, maxWidth: 140 }}>
                    {Array.from({ length: 24 }, (_, hr) => (
                      <option key={hr} value={hr}>{String(hr).padStart(2, "0")}:00</option>
                    ))}
                  </select>
                  {hours.length > 1 && (
                    <button onClick={() => removeAt(i)} aria-label={t("push.remove_time")}
                      style={{
                        border: "none", background: "none", color: "var(--ink-3)",
                        cursor: "pointer", fontSize: 16, padding: "0 6px", lineHeight: 1,
                      }}>×</button>
                  )}
                </div>
              ))}
            </div>
            {hours.length < MAX_TIMES && (
              <button onClick={addTime}
                style={{ ...s.btnGhost, fontSize: 12, padding: "6px 12px", marginTop: 10 }}>
                {t("push.add_time")}
              </button>
            )}
            <div style={{ ...s.muted, fontSize: 11, marginTop: 10, lineHeight: 1.5 }}>
              {t("push.tz_note", { tz: detectedTz || pushTimezone || "—" })}
            </div>
          </div>

          <div style={{ ...s.muted, fontSize: 11, marginBottom: 14, lineHeight: 1.5 }}>
            {t("push.apk_note")}
          </div>

          {msg && (
            <div style={{
              color: msg.startsWith("✕") ? "var(--danger)" : "var(--moss-deep)",
              fontSize: 12, marginBottom: 12, lineHeight: 1.5,
            }}>{msg}</div>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
            <button onClick={onClose} style={s.btnGhost}>{t("common.cancel")}</button>
            <button onClick={save} disabled={busy}
              style={{ ...s.btn, opacity: busy ? 0.5 : 1 }}>
              {busy ? "…" : t("common.save")}
            </button>
          </div>
        </div>
      </div>
    </ModalRoot>
  );
}
