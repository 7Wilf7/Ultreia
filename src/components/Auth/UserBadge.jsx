import { useState, useEffect, useRef } from "react";
import { useT } from "../../i18n/LanguageContext";
import { useInstantPress } from "../../hooks/useInstantPress";

const cellBase = {
  border: "1px solid var(--rule)",
  background: "var(--bg-elevated)",
  height: 32,
  padding: "0 12px",
  fontSize: 13,
  color: "var(--ink-2)",
  fontFamily: "var(--font-sans)",
  borderRadius: 0,
  transition: "none",
};

function emailPrefix(email) {
  if (!email) return "";
  const i = email.indexOf("@");
  return i > 0 ? email.slice(0, i) : email;
}

// Email cell is a dropdown trigger — opens a small menu with Change password
// + Sign out. Both actions live INSIDE the dropdown so the email becomes the
// single anchor for account-level operations, matching the mobile "tap
// email → menu" pattern.
export function UserBadge({ user, signOut, onChangePassword, onDeleteAccount, isAdmin, publicFeatures = false, onGenerateInvite }) {
  const t = useT();
  const instantPress = useInstantPress();
  const [signingOut, setSigningOut] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e) {
      if (!wrapRef.current?.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
    } catch {
      // Surfaced silently — Supabase only fails here on network errors, and
      // the user can retry. Keeping UI quiet matches the rest of this app.
    } finally {
      setSigningOut(false);
    }
  }

  const prefix = emailPrefix(user.email);

  return (
    <>
      <span ref={wrapRef} style={{ position: "relative", display: "inline-flex" }}>
        <button
          type="button"
          {...instantPress("user-badge-menu", () => setMenuOpen(o => !o))}
          title={user.email}
          style={{
            ...cellBase,
            borderRight: "none",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            maxWidth: 200,
            overflow: "hidden",
            whiteSpace: "nowrap",
            cursor: "pointer",
            touchAction: "manipulation",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          <span style={{ width: 6, height: 6, background: "var(--moss)", borderRadius: 0, flexShrink: 0 }} />
          <span style={{
            fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-1)",
            overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {prefix}
          </span>
          <span style={{ color: "var(--ink-3)", fontSize: 10, marginLeft: 2 }}>
            {menuOpen ? "▴" : "▾"}
          </span>
        </button>
        {menuOpen && (
          <div style={{
            position: "absolute", top: "calc(100% + 4px)", right: 0,
            background: "var(--bg-elevated)",
            border: "1px solid var(--rule)",
            minWidth: 180,
            zIndex: 50,
            boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
          }}>
            <button
              type="button"
              {...instantPress("user-badge-change-password", () => { setMenuOpen(false); onChangePassword?.(); })}
              style={{
                display: "block", width: "100%", textAlign: "left",
                padding: "10px 14px", fontSize: 13, fontFamily: "var(--font-sans)",
                color: "var(--ink-1)",
                background: "transparent", border: "none",
                borderBottom: "1px solid var(--rule-soft)",
                borderRadius: 0, cursor: "pointer",
                touchAction: "manipulation",
                WebkitTapHighlightColor: "transparent",
                transition: "none",
              }}
            >
              {t("settings.change_password")}
            </button>
            {publicFeatures && isAdmin && (
              <button
                type="button"
                {...instantPress("user-badge-generate-invite", () => { setMenuOpen(false); onGenerateInvite?.(); })}
                style={{
                  display: "block", width: "100%", textAlign: "left",
                  padding: "10px 14px", fontSize: 13, fontFamily: "var(--font-sans)",
                  color: "var(--ink-1)",
                  background: "transparent", border: "none",
                  borderBottom: "1px solid var(--rule-soft)",
                  borderRadius: 0, cursor: "pointer",
                  touchAction: "manipulation",
                  WebkitTapHighlightColor: "transparent",
                  transition: "none",
                }}
              >
                {t("settings.generate_invite")}
              </button>
            )}
            <button
              type="button"
              onClick={() => { setMenuOpen(false); handleSignOut(); }}
              disabled={signingOut}
              style={{
                display: "block", width: "100%", textAlign: "left",
                padding: "10px 14px", fontSize: 13, fontFamily: "var(--font-sans)",
                color: signingOut ? "var(--ink-3)" : "var(--danger)",
                background: "transparent", border: "none",
                borderRadius: 0,
                cursor: signingOut ? "default" : "pointer",
                transition: "none",
              }}
            >
              {signingOut
                ? <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <span className="ultreia-spinner" style={{ width: 12, height: 12, borderWidth: 2 }} />
                    {t("settings.signing_out")}
                  </span>
                : t("settings.sign_out")}
            </button>
            <button
              type="button"
              onClick={() => { setMenuOpen(false); onDeleteAccount?.(); }}
              style={{
                display: "block", width: "100%", textAlign: "left",
                padding: "10px 14px", fontSize: 13, fontFamily: "var(--font-sans)",
                color: "var(--danger)",
                background: "transparent", border: "none",
                borderTop: "1px solid var(--rule-soft)",
                borderRadius: 0, cursor: "pointer",
                transition: "none",
              }}
            >
              {t("settings.delete_account")}
            </button>
          </div>
        )}
      </span>
    </>
  );
}
