import { useState } from "react";
import { s } from "../../styles";
import { useIsMobile } from "../../hooks/useMediaQuery";
import { ModalRoot } from "../ModalRoot";
import { translate } from "../../i18n/translations";

const LANG_KEY = "ts-lang";

function initialLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === "zh" || saved === "en") return saved;
  } catch { /* private mode */ }
  try {
    return (navigator.language || "").toLowerCase().startsWith("zh") ? "zh" : "en";
  } catch { return "en"; }
}

// Pre-auth screen: no LanguageProvider in scope (it lives inside the authed
// app), so we translate directly via translate(key, lang) and keep the chosen
// language in localStorage. The authed app reads that same key on first load so
// a brand-new user's UI + onboarding tour open in the language they picked here.
export function LoginScreen({ onClose, signIn, register }) {
  const isMobile = useIsMobile();
  const [lang, setLang] = useState(initialLang);
  const tt = (k) => translate(k, lang);

  const [mode, setMode] = useState("signin"); // "signin" | "register"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [invite, setInvite] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const isRegister = mode === "register";

  function changeLang(next) {
    setLang(next);
    try { localStorage.setItem(LANG_KEY, next); } catch { /* private mode */ }
  }

  function registerErrorText(code) {
    switch (code) {
      case "invalid_code":  return tt("login.err_invalid_code");
      case "code_used":     return tt("login.err_code_used");
      case "email_taken":   return tt("login.err_email_taken");
      case "weak_password": return tt("login.err_pw_short");
      default:              return tt("login.err_register");
    }
  }

  function switchMode(next) {
    setMode(next);
    setError("");
    setPassword2("");
    setInvite("");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    setError("");

    if (isRegister) {
      if (password.length < 6) { setError(tt("login.err_pw_short")); return; }
      if (password !== password2) { setError(tt("login.err_mismatch")); return; }
      if (!invite.trim()) { setError(tt("login.err_invite_required")); return; }
    }

    setSubmitting(true);
    try {
      if (isRegister) {
        await register(email.trim(), password, invite.trim());
      } else {
        await signIn(email, password);
      }
      onClose();
    } catch (err) {
      setError(isRegister
        ? registerErrorText(err?.code)
        : (err?.message || tt("login.err_signin")));
      setSubmitting(false);
    }
  }

  const canSubmit = isRegister
    ? email && password && password2 && invite
    : email && password;

  function langSeg(active) {
    return {
      background: active ? "var(--ink-1)" : "transparent",
      color: active ? "var(--ink-inv)" : "var(--ink-3)",
      border: "none", borderRadius: 0,
      padding: "0 10px", height: 26, minHeight: 0,
      fontSize: active ? 13 : 11,
      fontFamily: active ? "var(--font-sans)" : "var(--font-mono)",
      fontWeight: 600, cursor: "pointer",
      transition: "background 160ms, color 160ms",
    };
  }

  return (
    <ModalRoot>
    <div
      onClick={submitting ? undefined : onClose}
      style={s.modalOverlay(isMobile)}
    >
      <form
        onClick={e => e.stopPropagation()}
        onSubmit={handleSubmit}
        style={{
          ...s.modalCard(isMobile, { maxWidth: 380 }),
          margin: isMobile ? 0 : "60px auto",
          padding: isMobile ? "calc(env(safe-area-inset-top) + 28px) 22px calc(env(safe-area-inset-bottom) + 24px)" : 28,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--moss)", fontWeight: 600 }}>
            ▲ Training Studio
          </div>
          {/* Language pill — lets a brand-new user read the screen + tour in
              their language before any account exists. */}
          <div style={{
            display: "flex", overflow: "hidden",
            border: "1px solid var(--rule)", borderRadius: 13, height: 26,
          }}>
            <button type="button" onClick={() => changeLang("zh")} style={langSeg(lang === "zh")} aria-label="中文">中</button>
            <button type="button" onClick={() => changeLang("en")} style={langSeg(lang === "en")} aria-label="English">EN</button>
          </div>
        </div>

        <h2 style={{ fontFamily: "var(--font-sans)", fontSize: 22, fontWeight: 500, margin: "10px 0 4px", color: "var(--ink-1)", letterSpacing: "-0.01em" }}>
          {isRegister ? tt("login.create") : tt("login.signin")}
        </h2>
        <p style={{ ...s.muted, marginBottom: 22, lineHeight: 1.5 }}>
          {isRegister ? tt("login.register_desc") : tt("login.signin_desc")}
        </p>

        <div style={{ marginBottom: 14 }}>
          <div style={{ ...s.label, marginBottom: 6 }}>{tt("login.email")}</div>
          <input
            type="email"
            required
            autoFocus
            autoComplete="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            disabled={submitting}
            style={{ ...s.input, fontFamily: "var(--font-mono)", fontSize: 13 }}
          />
        </div>

        <div style={{ marginBottom: isRegister ? 14 : 18 }}>
          <div style={{ ...s.label, marginBottom: 6 }}>{tt("login.password")}</div>
          <input
            type="password"
            required
            autoComplete={isRegister ? "new-password" : "current-password"}
            value={password}
            onChange={e => setPassword(e.target.value)}
            disabled={submitting}
            style={{ ...s.input, fontFamily: "var(--font-mono)", fontSize: 13 }}
          />
        </div>

        {isRegister && (
          <>
            <div style={{ marginBottom: 14 }}>
              <div style={{ ...s.label, marginBottom: 6 }}>{tt("login.confirm")}</div>
              <input
                type="password"
                required
                autoComplete="new-password"
                value={password2}
                onChange={e => setPassword2(e.target.value)}
                disabled={submitting}
                style={{ ...s.input, fontFamily: "var(--font-mono)", fontSize: 13 }}
              />
            </div>
            <div style={{ marginBottom: 18 }}>
              <div style={{ ...s.label, marginBottom: 6 }}>{tt("login.invite")}</div>
              <input
                type="text"
                required
                autoCapitalize="characters"
                value={invite}
                onChange={e => setInvite(e.target.value)}
                disabled={submitting}
                placeholder="TS-XXXXXXXX"
                style={{ ...s.input, fontFamily: "var(--font-mono)", fontSize: 13 }}
              />
            </div>
          </>
        )}

        {error && (
          <div style={{
            border: "1px solid var(--danger)",
            background: "rgba(139,42,35,0.06)",
            color: "var(--danger)",
            padding: "8px 12px",
            fontSize: 12,
            fontFamily: "var(--font-mono)",
            borderRadius: 2,
            marginBottom: 16,
            lineHeight: 1.5,
            wordBreak: "break-word",
          }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || !canSubmit}
          style={{
            ...s.btn,
            width: "100%",
            padding: "11px 18px",
            opacity: submitting || !canSubmit ? 0.55 : 1,
            cursor: submitting || !canSubmit ? "default" : "pointer",
          }}
        >
          {submitting
            ? (isRegister ? tt("login.creating") : tt("login.signing"))
            : (isRegister ? tt("login.create") : tt("login.signin"))}
        </button>

        <div style={{
          marginTop: 18,
          paddingTop: 14,
          borderTop: "1px solid var(--rule)",
          textAlign: "center",
          fontFamily: "var(--font-sans)",
          fontSize: 12.5,
          color: "var(--ink-3)",
        }}>
          {isRegister ? (
            <>
              {tt("login.have_account")}{" "}
              <button type="button" onClick={() => switchMode("signin")}
                style={{ background: "none", border: "none", padding: 0, color: "var(--moss-deep)", cursor: "pointer", fontFamily: "inherit", fontSize: "inherit", textDecoration: "underline" }}>
                {tt("login.signin")}
              </button>
            </>
          ) : (
            <>
              {tt("login.have_invite")}{" "}
              <button type="button" onClick={() => switchMode("register")}
                style={{ background: "none", border: "none", padding: 0, color: "var(--moss-deep)", cursor: "pointer", fontFamily: "inherit", fontSize: "inherit", textDecoration: "underline" }}>
                {tt("login.create")}
              </button>
            </>
          )}
        </div>
      </form>
    </div>
    </ModalRoot>
  );
}
