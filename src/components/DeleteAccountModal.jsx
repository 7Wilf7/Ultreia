import { useState } from "react";
import { s } from "../styles";
import { useT } from "../i18n/LanguageContext";
import { ModalRoot } from "./ModalRoot";

// Permanent account deletion. Two password fields (must match + must be correct)
// act as the confirmation gate. deleteAccount(password) re-authenticates, wipes
// the account server-side, then signs out — so on success this modal's parent
// unmounts as the app returns to the login screen.
export function DeleteAccountModal({ deleteAccount, onExportBackup, onClose }) {
  const t = useT();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [confirmBackup, setConfirmBackup] = useState(false);

  async function submit() {
    setErrMsg("");
    if (!pw) { setErrMsg(t("del.wrong")); return; }
    if (pw !== pw2) { setErrMsg(t("del.mismatch")); return; }
    setBusy(true);
    try {
      await deleteAccount(pw);
      // On success the session is gone; the app swaps to the login screen and
      // this component unmounts — no further UI needed here.
    } catch (err) {
      if (err?.code === "current_password_invalid") {
        setErrMsg(t("del.wrong"));
      } else {
        setErrMsg(t("del.error") + (err?.message || String(err)));
      }
      setBusy(false);
    }
  }

  function exportBackup() {
    setConfirmBackup(false);
    onExportBackup?.();
  }

  return (
    <ModalRoot onClose={onClose}>
      <div onClick={onClose} style={{
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
            <h2 style={{ fontSize: 19, fontWeight: 500, margin: 0, color: "var(--danger)" }}>{t("del.title")}</h2>
            <button onClick={onClose} style={s.modalCloseBtn} aria-label="Close">×</button>
          </div>

          <div style={{
            border: "1px solid var(--danger)",
            background: "rgba(139,42,35,0.06)",
            color: "var(--danger)",
            padding: "10px 12px",
            fontSize: 12.5,
            borderRadius: 3,
            margin: "8px 0 18px",
            lineHeight: 1.6,
          }}>
            {t("del.warning")}
          </div>

          <div style={{
            border: "1px solid var(--rule-soft)",
            background: "var(--bg-sunken)",
            padding: "10px 12px",
            fontSize: 12,
            borderRadius: 3,
            margin: "-6px 0 16px",
            lineHeight: 1.5,
            color: "var(--ink-2)",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <span>{t("settings.export_backup_delete_hint")}</span>
              <button
                type="button"
                onClick={() => setConfirmBackup(true)}
                style={{ ...s.btnGhost, minHeight: 0, padding: "5px 8px", fontSize: 11, flexShrink: 0 }}
              >
                {t("settings.export_backup_short")}
              </button>
            </div>
          </div>

          {confirmBackup && (
            <div style={{
              border: "1px solid var(--moss)",
              background: "rgba(91,105,65,0.08)",
              padding: "12px",
              fontSize: 12.5,
              borderRadius: 3,
              margin: "-4px 0 16px",
              lineHeight: 1.55,
              color: "var(--ink-2)",
            }}>
              <div style={{ fontWeight: 600, color: "var(--ink-1)", marginBottom: 5 }}>
                {t("settings.export_backup_confirm_title")}
              </div>
              <div>{t("settings.export_backup_confirm_body")}</div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
                <button type="button" onClick={() => setConfirmBackup(false)}
                  style={{ ...s.btnGhost, minHeight: 0, padding: "6px 10px", fontSize: 12 }}>
                  {t("common.cancel")}
                </button>
                <button type="button" onClick={exportBackup}
                  style={{ ...s.btn, minHeight: 0, padding: "6px 10px", fontSize: 12 }}>
                  {t("settings.export_backup")}
                </button>
              </div>
            </div>
          )}

          <div style={{ ...s.label, marginBottom: 6 }}>{t("del.password")}</div>
          <input type="password" value={pw}
            autoComplete="current-password"
            onChange={e => setPw(e.target.value)}
            style={{ ...s.input, marginBottom: 12, fontFamily: "var(--font-mono)" }} />

          <div style={{ ...s.label, marginBottom: 6 }}>{t("del.confirm_password")}</div>
          <input type="password" value={pw2}
            autoComplete="current-password"
            onChange={e => setPw2(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !busy) submit(); }}
            style={{ ...s.input, marginBottom: 12, fontFamily: "var(--font-mono)" }} />

          {errMsg && (
            <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 12, lineHeight: 1.5 }}>
              {errMsg}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
            <button onClick={onClose} style={s.btnGhost}>{t("common.cancel")}</button>
            <button onClick={submit} disabled={busy || !pw || !pw2}
              style={{
                ...s.btn,
                background: "var(--danger)", borderColor: "var(--danger)",
                opacity: busy || !pw || !pw2 ? 0.5 : 1,
              }}>
              {busy ? t("del.deleting") : t("del.button")}
            </button>
          </div>
        </div>
      </div>
    </ModalRoot>
  );
}
