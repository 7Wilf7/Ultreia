import { useState } from "react";
import { s } from "../../styles";
import { translate } from "../../i18n/translations";
import { ModalRoot } from "../ModalRoot";

function initialLang() {
  try {
    const saved = localStorage.getItem("ultreia.lang");
    if (saved === "zh" || saved === "en") return saved;
  } catch { /* private mode */ }
  try {
    return (navigator.language || "").toLowerCase().startsWith("zh") ? "zh" : "en";
  } catch { return "en"; }
}

export function PasswordRecoveryModal({ completePasswordRecovery, onClose }) {
  const [lang] = useState(initialLang);
  const t = (key) => translate(key, lang);
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setError("");
    if (password.length < 6) { setError(t("pwd.too_short")); return; }
    if (password !== password2) { setError(t("pwd.mismatch")); return; }
    setBusy(true);
    try {
      await completePasswordRecovery(password);
      onClose();
    } catch (err) {
      setError(t("pwd.error") + (err?.message || String(err)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalRoot>
      <div style={{
        position: "fixed", inset: 0, zIndex: 10000,
        background: "rgba(20,20,19,0.45)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
      }}>
        <form onSubmit={submit} style={{
          background: "var(--bg-elevated)",
          border: "1px solid var(--rule)",
          borderRadius: 4,
          boxShadow: "0 18px 50px rgba(0,0,0,0.25)",
          width: "100%", maxWidth: 420,
          padding: "22px 24px 20px",
          boxSizing: "border-box",
          fontFamily: "var(--font-sans)",
        }}>
          <h2 style={{ fontSize: 19, fontWeight: 500, margin: "0 0 4px" }}>{t("pwd.recovery_title")}</h2>
          <p style={{ ...s.muted, marginBottom: 18, lineHeight: 1.6, fontSize: 12 }}>{t("pwd.recovery_hint")}</p>

          <div style={{ ...s.label, marginBottom: 6 }}>{t("pwd.new")}</div>
          <input
            type="password"
            value={password}
            autoComplete="new-password"
            onChange={e => setPassword(e.target.value)}
            style={{ ...s.input, marginBottom: 12, fontFamily: "var(--font-mono)" }}
          />

          <div style={{ ...s.label, marginBottom: 6 }}>{t("pwd.confirm")}</div>
          <input
            type="password"
            value={password2}
            autoComplete="new-password"
            onChange={e => setPassword2(e.target.value)}
            style={{ ...s.input, marginBottom: 12, fontFamily: "var(--font-mono)" }}
          />

          {error && (
            <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 12, lineHeight: 1.5 }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={busy || !password || !password2}
            style={{ ...s.btn, width: "100%", opacity: busy || !password || !password2 ? 0.5 : 1 }}>
            {busy ? t("common.saving") : t("pwd.recovery_save")}
          </button>
        </form>
      </div>
    </ModalRoot>
  );
}
