import { useState } from "react";
import { s } from "../styles";
import { useT } from "../i18n/LanguageContext";
import { ModalRoot } from "./ModalRoot";
import { TutorialModal } from "./TutorialModal";
import { TUTORIALS } from "../data/tutorials";
import { FREE_WEATHER_LIMIT } from "../constants";

// Caiyun Weather API token settings — lets the user paste their own free
// developer token from dashboard.caiyunapp.com. Empty = falls back to the
// app's shared server-side token (best-effort, limited daily quota).
//
// Persistence lives in user_settings.caiyun_api_key (synced across devices
// via Supabase) — the caller (App.jsx) wires `caiyunApiKey` + `setCaiyunApiKey`
// to the same DAL writer the rest of user_settings uses.
export function WeatherApiSettingsModal({ caiyunApiKey, setCaiyunApiKey, freeWeatherLeft, onClose }) {
  const t = useT();
  // Mask the existing key on first render so it doesn't leak when the user
  // hands their phone over; "draft" tracks the new value being typed.
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [showTut, setShowTut] = useState(false);

  async function save() {
    setBusy(true);
    setMsg("");
    try {
      await setCaiyunApiKey(draft.trim());
      setMsg(t("weather_api.saved"));
      setDraft("");
      setTimeout(() => onClose(), 900);
    } catch (e) {
      setMsg(t("weather_api.save_failed", { msg: e?.message || String(e) }));
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    setMsg("");
    try {
      await setCaiyunApiKey("");
      setDraft("");
      setMsg(t("weather_api.cleared"));
    } catch (e) {
      setMsg(t("weather_api.save_failed", { msg: e?.message || String(e) }));
    } finally {
      setBusy(false);
    }
  }

  const hasKey = !!caiyunApiKey;

  return (
    <ModalRoot onClose={onClose}>
      <div onClick={onClose} className="ts-overlay-in" style={{
        position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
        background: "rgba(20,20,19,0.45)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 9999, padding: 16,
        overscrollBehavior: "contain",
      }}>
        <div onClick={e => e.stopPropagation()} className="ts-modal-in" style={{
          background: "var(--bg-elevated)",
          border: "1px solid var(--rule)",
          borderRadius: 4,
          boxShadow: "0 18px 50px rgba(0,0,0,0.25)",
          width: "100%", maxWidth: 480,
          maxHeight: "calc(100dvh - 32px)",
          overflowY: "auto",
          padding: "22px 24px 20px",
          boxSizing: "border-box",
          fontFamily: "var(--font-sans)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
            <h2 style={{ fontSize: 19, fontWeight: 500, margin: 0 }}>{t("weather_api.title")}</h2>
            <button onClick={onClose} style={s.modalCloseBtn} aria-label="Close">×</button>
          </div>
          <p style={{ ...s.muted, marginBottom: 16, lineHeight: 1.6, fontSize: 12 }}>
            {t("weather_api.hint")}
          </p>
          {!hasKey && typeof freeWeatherLeft === "number" && (
            <div style={{
              border: "1px solid var(--rule)", borderRadius: 6,
              padding: "9px 12px", marginBottom: 14,
              background: freeWeatherLeft > 0 ? "var(--moss-bg)" : "var(--bg-sunken)",
              fontSize: 12.5, lineHeight: 1.55,
              color: freeWeatherLeft > 0 ? "var(--moss-deep)" : "var(--ink-2)",
            }}>
              {freeWeatherLeft > 0
                ? t("quota.weather_left", { n: String(freeWeatherLeft), total: String(FREE_WEATHER_LIMIT) })
                : t("quota.weather_used")}
            </div>
          )}
          <button type="button" onClick={() => setShowTut(true)} style={{ ...s.btnGhost, marginBottom: 18 }}>
            {t("tutorial.view")}
          </button>

          <div style={{ ...s.label, marginBottom: 6 }}>
            {hasKey ? t("weather_api.replace_label") : t("weather_api.token_label")}
          </div>
          <input
            type="password"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder={t("weather_api.token_placeholder")}
            style={{ ...s.input, marginBottom: 8, fontFamily: "var(--font-mono)" }} />

          {hasKey && (
            <div style={{ ...s.muted, fontSize: 11, marginBottom: 14 }}>
              {t("weather_api.current_set")}
            </div>
          )}

          {msg && (
            <div style={{
              color: msg.startsWith("✕") ? "var(--danger)" : "var(--moss-deep)",
              fontSize: 12, marginBottom: 12, lineHeight: 1.5,
            }}>{msg}</div>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
            {hasKey && (
              <button onClick={clear} disabled={busy} style={{ ...s.btnGhost, color: "var(--danger)" }}>
                {t("weather_api.clear")}
              </button>
            )}
            <button onClick={onClose} style={s.btnGhost}>{t("common.cancel")}</button>
            <button onClick={save} disabled={busy || !draft.trim()}
              style={{ ...s.btn, opacity: busy || !draft.trim() ? 0.5 : 1 }}>
              {busy ? "…" : t("weather_api.save")}
            </button>
          </div>
        </div>
      </div>
      {showTut && <TutorialModal tutorial={TUTORIALS.caiyun} onClose={() => setShowTut(false)} />}
    </ModalRoot>
  );
}
