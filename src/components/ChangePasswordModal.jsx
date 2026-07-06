import { useState } from "react";
import { s } from "../styles";
import { useT } from "../i18n/LanguageContext";
import { ModalRoot } from "./ModalRoot";
import { Spinner } from "./Spinner";
import { useInstantPress } from "../hooks/useInstantPress";

// Centered, blurred-backdrop modal — same chrome on mobile and desktop, so the
// password change always feels like an inline confirmation step, not a
// separate page. Caller passes changePassword(current, next) which throws
// `current_password_invalid` when the old password is wrong (handled here
// with a friendly hint that points to the administrator reset path).
export function ChangePasswordModal({ changePassword, onClose }) {
  const t = useT();
  const instantPress = useInstantPress();
  const [oldPw, setOldPw] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [okMsg, setOkMsg] = useState("");
  // Sticks the "forgot password?" hint after a wrong-current-password attempt
  // so the user always sees the recovery path once it becomes relevant.
  const [showForgotHint, setShowForgotHint] = useState(false);

  async function submit() {
    setErrMsg("");
    setOkMsg("");
    if (!oldPw) {
      setErrMsg(t("pwd.current_invalid"));
      return;
    }
    if (pw.length < 6) {
      setErrMsg(t("pwd.too_short"));
      return;
    }
    if (pw !== pw2) {
      setErrMsg(t("pwd.mismatch"));
      return;
    }
    setBusy(true);
    try {
      await changePassword(oldPw, pw);
      setOkMsg(t("pwd.success"));
      setOldPw("");
      setPw("");
      setPw2("");
      // Auto-close shortly after success so the user sees the confirmation
      // without having to hunt for the X.
      setTimeout(() => { onClose(); }, 1200);
    } catch (err) {
      if (err?.code === "current_password_invalid") {
        setErrMsg(t("pwd.current_invalid"));
        setShowForgotHint(true);
      } else {
        setErrMsg(t("pwd.error") + (err?.message || String(err)));
      }
    } finally {
      setBusy(false);
    }
  }
  const closeIfIdle = () => {
    if (!busy) onClose();
  };

  // Always-centered card with a blurred backdrop. The blur is set on the
  // overlay layer (backdrop-filter) so the page behind reads as "frozen" —
  // emphasizes that the modal is the only thing the user can interact with.
  return (
    <ModalRoot onClose={closeIfIdle}>
      <div onClick={closeIfIdle} style={{
        position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
        background: "rgba(20,20,19,0.45)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 9999, padding: 16,
        overscrollBehavior: "contain",
      }}>
        <div onClick={e => e.stopPropagation()}
          style={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--rule)",
            borderRadius: 4,
            boxShadow: "0 18px 50px rgba(0,0,0,0.25)",
            width: "100%", maxWidth: 440,
            maxHeight: "calc(100dvh - 32px)",
            overflowY: "auto",
            padding: "22px 24px 20px",
            boxSizing: "border-box",
            fontFamily: "var(--font-sans)",
          }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
            <h2 style={{ fontSize: 19, fontWeight: 500, margin: 0 }}>{t("pwd.title")}</h2>
            <button {...instantPress("change-password-close", closeIfIdle)} disabled={busy} style={{ ...s.modalCloseBtn, opacity: busy ? 0.45 : 1, touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }} aria-label="Close">×</button>
          </div>
          <p style={{ ...s.muted, marginBottom: 18, lineHeight: 1.6, fontSize: 12 }}>{t("pwd.hint")}</p>

          <div style={{ ...s.label, marginBottom: 6 }}>{t("pwd.current")}</div>
          <input type="password" value={oldPw}
            autoComplete="current-password"
            onChange={e => { setOldPw(e.target.value); setShowForgotHint(false); }}
            style={{ ...s.input, marginBottom: 12, fontFamily: "var(--font-mono)" }} />

          <div style={{ ...s.label, marginBottom: 6 }}>{t("pwd.new")}</div>
          <input type="password" value={pw}
            autoComplete="new-password"
            onChange={e => setPw(e.target.value)}
            style={{ ...s.input, marginBottom: 12, fontFamily: "var(--font-mono)" }} />

          <div style={{ ...s.label, marginBottom: 6 }}>{t("pwd.confirm")}</div>
          <input type="password" value={pw2}
            autoComplete="new-password"
            onChange={e => setPw2(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !busy) submit(); }}
            style={{ ...s.input, marginBottom: 12, fontFamily: "var(--font-mono)" }} />

          {errMsg && (
            <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: showForgotHint ? 6 : 12, lineHeight: 1.5 }}>
              {errMsg}
            </div>
          )}
          {showForgotHint && (
            <div style={{
              color: "var(--ink-3)", fontSize: 12, marginBottom: 12, lineHeight: 1.5,
              padding: "8px 10px", border: "1px solid var(--rule)",
              background: "var(--bg)", borderRadius: 2,
            }}>
              {t("pwd.forgot")}
            </div>
          )}
          {okMsg && (
            <div style={{ color: "var(--moss-deep)", fontSize: 12, marginBottom: 12, lineHeight: 1.5 }}>
              {okMsg}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
            <button {...instantPress("change-password-cancel", closeIfIdle)} disabled={busy} style={{ ...s.btnGhost, opacity: busy ? 0.55 : 1, touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}>{t("common.cancel")}</button>
            <button
              onClick={submit}
              disabled={busy || !oldPw || !pw || !pw2}
              aria-busy={busy ? "true" : undefined}
              style={{ ...s.btn, opacity: busy || !oldPw || !pw || !pw2 ? 0.5 : 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7 }}
            >
              {busy && <Spinner size={13} thickness={1.6} color="currentColor" />}
              {busy ? t("common.saving") : t("pwd.save")}
            </button>
          </div>
        </div>
      </div>
    </ModalRoot>
  );
}
