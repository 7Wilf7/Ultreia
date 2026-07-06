import { useEffect, useState } from "react";
import { s } from "../styles";
import { useT } from "../i18n/LanguageContext";
import { ModalRoot } from "./ModalRoot";
import { invites } from "../lib/db";
import { useInstantPress } from "../hooks/useInstantPress";

// Admin-only: mint + review one-time invite codes. Centered blurred modal, same
// chrome as the other settings modals. List loads on mount; generating prepends
// the new code. Unused codes get a copy button.
export function InviteCodeModal({ onClose }) {
  const t = useT();
  const instantPress = useInstantPress();
  const [codes, setCodes] = useState(null); // null = loading
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState("");

  useEffect(() => {
    let active = true;
    invites.listMyInviteCodes()
      .then(rows => { if (active) setCodes(rows); })
      .catch(e => { if (active) { setErr(e?.message || String(e)); setCodes([]); } });
    return () => { active = false; };
  }, []);

  async function generate() {
    setBusy(true);
    setErr("");
    try {
      const row = await invites.createInviteCode();
      setCodes(prev => [row, ...(prev || [])]);
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(code) {
    setErr("");
    try {
      await invites.deleteInviteCode(code);
      setCodes(prev => (prev || []).filter(c => c.code !== code));
    } catch (e) {
      setErr(e?.message || String(e));
    }
  }

  async function copy(code) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      setTimeout(() => setCopied(c => (c === code ? "" : c)), 1500);
    } catch { /* clipboard blocked — user can long-press to copy */ }
  }

  return (
    <ModalRoot onClose={onClose}>
      <div onClick={onClose} className="ultreia-overlay-in" style={{
        position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
        background: "rgba(20,20,19,0.45)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 9999, padding: 16,
        overscrollBehavior: "contain",
      }}>
        <div onClick={e => e.stopPropagation()} className="ultreia-modal-in" style={{
          background: "var(--bg-elevated)",
          border: "1px solid var(--rule)",
          borderRadius: 4,
          boxShadow: "0 18px 50px rgba(0,0,0,0.25)",
          width: "100%", maxWidth: 460,
          maxHeight: "calc(100dvh - 32px)",
          overflowY: "auto",
          padding: "22px 24px 20px",
          boxSizing: "border-box",
          fontFamily: "var(--font-sans)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
            <h2 style={{ fontSize: 19, fontWeight: 500, margin: 0 }}>{t("invite.title")}</h2>
            <button {...instantPress("invite-code-close", onClose)} style={s.modalCloseBtn} aria-label="Close">×</button>
          </div>
          <p style={{ ...s.muted, marginBottom: 16, lineHeight: 1.6, fontSize: 12 }}>{t("invite.hint")}</p>

          <button onClick={generate} disabled={busy}
            style={{ ...s.btn, width: "100%", opacity: busy ? 0.6 : 1, marginBottom: 16 }}>
            {busy ? t("invite.generating") : t("invite.generate")}
          </button>

          {err && (
            <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 12, lineHeight: 1.5 }}>
              {t("invite.error")}{err}
            </div>
          )}

          {codes === null ? (
            <div style={{ ...s.muted, fontSize: 12, textAlign: "center", padding: "16px 0" }}>…</div>
          ) : codes.length === 0 ? (
            <div style={{ ...s.muted, fontSize: 12, textAlign: "center", padding: "16px 0" }}>{t("invite.empty")}</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {codes.map(c => {
                const used = !!c.usedBy;
                return (
                  <div key={c.code} style={{
                    display: "flex", alignItems: "center", gap: 8,
                    border: "1px solid var(--rule)", borderRadius: 4,
                    padding: "10px 12px",
                    background: used ? "var(--bg-sunken)" : "var(--bg-elevated)",
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 600,
                        color: used ? "var(--ink-3)" : "var(--ink-1)",
                        textDecoration: used ? "line-through" : "none",
                        wordBreak: "break-all",
                      }}>{c.code}</div>
                      {used && (
                        <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 3, wordBreak: "break-all" }}>
                          {t("invite.used")}
                          {c.usedEmail ? ` · ${c.usedEmail}` : ""}
                          {c.usedAt ? ` · ${c.usedAt.slice(0, 10)}` : ""}
                        </div>
                      )}
                    </div>
                    {!used && (
                      <button onClick={() => copy(c.code)}
                        style={{ ...s.btnGhost, fontSize: 12, padding: "5px 12px", minHeight: 0, flexShrink: 0 }}>
                        {copied === c.code ? t("invite.copied") : t("invite.copy")}
                      </button>
                    )}
                    <button onClick={() => remove(c.code)} aria-label={t("common.delete")}
                      title={t("common.delete")}
                      style={{
                        background: "none", border: "none", color: "var(--ink-3)",
                        fontSize: 18, lineHeight: 1, cursor: "pointer", padding: "2px 4px",
                        minHeight: 0, flexShrink: 0,
                      }}>×</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </ModalRoot>
  );
}
