import { useState } from "react";
import { s } from "../../styles";
import { useIsMobile } from "../../hooks/useMediaQuery";
import { ModalRoot } from "../ModalRoot";
import { translate } from "../../i18n/translations";
import productLogoUrl from "../../../resources/original-ui.png";

const LANG_KEY = "ts-lang";
const SAVED_LOGINS_KEY = "ts-saved-logins";
const MAX_SAVED_LOGINS = 8;

function initialLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === "zh" || saved === "en") return saved;
  } catch { /* private mode */ }
  try {
    return (navigator.language || "").toLowerCase().startsWith("zh") ? "zh" : "en";
  } catch { return "en"; }
}

function normalizeEmail(value) {
  return value.trim().toLowerCase();
}

function loadSavedLogins() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SAVED_LOGINS_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(item => item && typeof item.email === "string" && typeof item.password === "string")
      .map(item => ({
        email: normalizeEmail(item.email),
        password: item.password,
        updatedAt: Number(item.updatedAt) || 0,
      }))
      .filter(item => item.email && item.password)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_SAVED_LOGINS);
  } catch {
    return [];
  }
}

function saveLoginCredential(email, password) {
  const normalized = normalizeEmail(email);
  if (!normalized || !password) return loadSavedLogins();
  const next = [
    { email: normalized, password, updatedAt: Date.now() },
    ...loadSavedLogins().filter(item => item.email !== normalized),
  ].slice(0, MAX_SAVED_LOGINS);
  try { localStorage.setItem(SAVED_LOGINS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  return next;
}

function removeLoginCredential(email) {
  const normalized = normalizeEmail(email);
  const next = loadSavedLogins().filter(item => item.email !== normalized);
  try { localStorage.setItem(SAVED_LOGINS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  return next;
}

// Pre-auth screen: no LanguageProvider in scope (it lives inside the authed
// app), so we translate directly via translate(key, lang) and keep the chosen
// language in localStorage. The authed app reads that same key on first load so
// a brand-new user's UI + onboarding tour open in the language they picked here.
function textButtonStyle({ align = "left", tone = "moss" } = {}) {
  return {
    background: "none",
    border: "none",
    padding: 0,
    minHeight: 0,
    height: "auto",
    color: tone === "moss" ? "var(--moss-deep)" : "var(--ink-2)",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: "inherit",
    lineHeight: 1.25,
    textAlign: align,
    textDecoration: "underline",
  };
}

function SecondaryAuthModal({ title, description, isMobile, onClose, dismissible = true, children }) {
  const close = dismissible ? onClose : undefined;
  return (
    <ModalRoot onClose={close}>
      <div
        onClick={close}
        style={s.modalOverlay(isMobile, { float: true })}
      >
        <div
          onClick={e => e.stopPropagation()}
          style={{
            ...s.modalCard(isMobile, { maxWidth: 360, float: true }),
            padding: isMobile ? "22px 20px 20px" : 24,
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 18 }}>
            <div>
              <h3 style={{ margin: 0, fontFamily: "var(--font-sans)", fontSize: 19, fontWeight: 500, color: "var(--ink-1)" }}>
                {title}
              </h3>
              {description && (
                <p style={{ ...s.muted, margin: "8px 0 0", lineHeight: 1.5 }}>
                  {description}
                </p>
              )}
            </div>
            <button type="button" onClick={onClose} disabled={!dismissible} style={{ ...s.modalCloseBtn, opacity: dismissible ? 1 : 0.4 }} aria-label="Close">
              ×
            </button>
          </div>
          {children}
        </div>
      </div>
    </ModalRoot>
  );
}

function CreateAccountModal({ initialEmail, register, tt, isMobile, onClose, onRegistered }) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [invite, setInvite] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleRegister(e) {
    e.preventDefault();
    if (submitting) return;
    setError("");
    if (password.length < 6) { setError(tt("login.err_pw_short")); return; }
    if (password !== password2) { setError(tt("login.err_mismatch")); return; }
    if (!invite.trim()) { setError(tt("login.err_invite_required")); return; }

    setSubmitting(true);
    try {
      const normalizedEmail = normalizeEmail(email);
      await register(normalizedEmail, password, invite.trim());
      onRegistered(normalizedEmail);
    } catch (err) {
      switch (err?.code) {
        case "invalid_code":  setError(tt("login.err_invalid_code")); break;
        case "code_used":     setError(tt("login.err_code_used")); break;
        case "email_taken":   setError(tt("login.err_email_taken")); break;
        case "weak_password": setError(tt("login.err_pw_short")); break;
        case "confirmation_send_failed": setError(tt("login.err_confirmation_send")); break;
        default:              setError(tt("login.err_register"));
      }
      setSubmitting(false);
    }
  }

  return (
    <SecondaryAuthModal
      title={tt("login.create")}
      description={tt("login.register_desc")}
      isMobile={isMobile}
      onClose={onClose}
      dismissible={!submitting}
    >
      <form onSubmit={handleRegister}>
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
        <div style={{ marginBottom: 14 }}>
          <div style={{ ...s.label, marginBottom: 6 }}>{tt("login.password")}</div>
          <input
            type="password"
            required
            autoComplete="new-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            disabled={submitting}
            style={{ ...s.input, fontFamily: "var(--font-mono)", fontSize: 13 }}
          />
        </div>
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
          disabled={submitting || !email || !password || !password2 || !invite}
          style={{
            ...s.btn,
            width: "100%",
            padding: "11px 18px",
            opacity: submitting || !email || !password || !password2 || !invite ? 0.55 : 1,
            cursor: submitting || !email || !password || !password2 || !invite ? "default" : "pointer",
          }}
        >
          {submitting ? tt("login.creating") : tt("login.create")}
        </button>
      </form>
    </SecondaryAuthModal>
  );
}

function ForgotPasswordModal({ initialEmail, sendPasswordReset, tt, isMobile, onClose, onSent }) {
  const [email, setEmail] = useState(initialEmail);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleReset(e) {
    e.preventDefault();
    if (submitting) return;
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) { setError(tt("login.err_email_required")); return; }
    setError("");
    setSubmitting(true);
    try {
      await sendPasswordReset(normalizedEmail);
      onSent(normalizedEmail);
    } catch {
      setError(tt("login.err_reset"));
      setSubmitting(false);
    }
  }

  return (
    <SecondaryAuthModal
      title={tt("login.forgot_password_title")}
      description={tt("login.forgot_password_desc")}
      isMobile={isMobile}
      onClose={onClose}
      dismissible={!submitting}
    >
      <form onSubmit={handleReset}>
        <div style={{ marginBottom: 18 }}>
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
          }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || !email}
          style={{
            ...s.btn,
            width: "100%",
            padding: "11px 18px",
            opacity: submitting || !email ? 0.55 : 1,
            cursor: submitting || !email ? "default" : "pointer",
          }}
        >
          {submitting ? tt("login.sending") : tt("login.send_reset")}
        </button>
      </form>
    </SecondaryAuthModal>
  );
}

export function LoginScreen({ onClose, signIn, register, sendPasswordReset }) {
  const isMobile = useIsMobile();
  const [lang, setLang] = useState(initialLang);
  const tt = (k) => translate(k, lang);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [activeDialog, setActiveDialog] = useState(null);
  const [savedLogins, setSavedLogins] = useState(loadSavedLogins);
  const [rememberLogin, setRememberLogin] = useState(false);

  function changeLang(next) {
    setLang(next);
    try { localStorage.setItem(LANG_KEY, next); } catch { /* private mode */ }
  }

  function chooseSavedLogin(nextEmail) {
    const picked = savedLogins.find(item => item.email === nextEmail);
    if (!picked) return;
    setEmail(picked.email);
    setPassword(picked.password);
    setRememberLogin(true);
    setError("");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    setError("");
    setNotice("");

    setSubmitting(true);
    try {
      const normalizedEmail = normalizeEmail(email);
      await signIn(normalizedEmail, password);
      setSavedLogins(rememberLogin
        ? saveLoginCredential(normalizedEmail, password)
        : removeLoginCredential(normalizedEmail));
      onClose();
    } catch (err) {
      setError(err?.code === "email_not_confirmed" ? tt("login.err_email_unverified") : tt("login.err_signin"));
      setSubmitting(false);
    }
  }

  function openDialog(name) {
    setError("");
    setNotice("");
    setActiveDialog(name);
  }

  function handleRegistered(normalizedEmail) {
    setEmail(normalizedEmail);
    setPassword("");
    setRememberLogin(false);
    setNotice(tt("login.verify_sent"));
    setActiveDialog(null);
  }

  function handleResetSent(normalizedEmail) {
    setEmail(normalizedEmail);
    setNotice(tt("login.reset_sent"));
    setActiveDialog(null);
  }

  const canSubmit = email && password;

  function langSeg(active) {
    return {
      background: active ? "var(--ink-1)" : "transparent",
      color: active ? "var(--ink-inv)" : "var(--ink-3)",
      border: "none", borderRadius: 0,
      padding: "0 10px", height: 26, minHeight: 0,
      fontSize: active ? 13 : 11,
      fontFamily: active ? "var(--font-sans)" : "var(--font-mono)",
      fontWeight: 600, cursor: "pointer",
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      lineHeight: 1,
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
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "start", marginBottom: 14 }}>
          <div />
          <img
            src={productLogoUrl}
            alt="Training Studio"
            style={{
              width: 72,
              height: 72,
              borderRadius: 16,
              objectFit: "cover",
              border: "1px solid var(--rule)",
              boxShadow: "0 8px 20px rgba(20,20,19,0.08)",
            }}
          />
          {/* Language pill — lets a brand-new user read the screen + tour in
              their language before any account exists. */}
          <div style={{
            justifySelf: "end",
            display: "flex", overflow: "hidden",
            border: "1px solid var(--rule)", borderRadius: 13, height: 26,
          }}>
            <button type="button" onClick={() => changeLang("zh")} style={langSeg(lang === "zh")} aria-label="中文">中</button>
            <button type="button" onClick={() => changeLang("en")} style={langSeg(lang === "en")} aria-label="English">EN</button>
          </div>
        </div>

        <h2 style={{ fontFamily: "var(--font-sans)", fontSize: 22, fontWeight: 500, margin: "8px 0 4px", color: "var(--ink-1)", letterSpacing: "-0.01em" }}>
          {tt("login.signin")}
        </h2>
        <p style={{ ...s.muted, marginBottom: 22, lineHeight: 1.5 }}>
          {tt("login.signin_desc")}
        </p>

        <div style={{ marginBottom: 14 }}>
          <div style={{ ...s.label, marginBottom: 6 }}>{tt("login.email")}</div>
          {savedLogins.length > 0 && (
            <select
              value=""
              onChange={e => chooseSavedLogin(e.target.value)}
              disabled={submitting}
              aria-label={tt("login.saved_accounts")}
              style={{
                ...s.input,
                minHeight: 42,
                marginBottom: 8,
                fontFamily: "var(--font-mono)",
                fontSize: 13,
                "--mobile-input-fs": "13px",
                color: "var(--ink-2)",
                background: "var(--paper)",
              }}
            >
              <option value="">{tt("login.saved_accounts")}</option>
              {savedLogins.map(item => (
                <option key={item.email} value={item.email}>{item.email}</option>
              ))}
            </select>
          )}
          <input
            type="email"
            required
            autoFocus
            autoComplete="email"
            value={email}
            onChange={e => {
              setEmail(e.target.value);
              const normalized = normalizeEmail(e.target.value);
              const matched = savedLogins.find(item => item.email === normalized);
              if (matched) {
                setPassword(matched.password);
                setRememberLogin(true);
              }
            }}
            disabled={submitting}
            style={{ ...s.input, fontFamily: "var(--font-mono)", fontSize: 13 }}
          />
        </div>

        <div style={{ marginBottom: 18 }}>
          <div style={{ ...s.label, marginBottom: 6 }}>{tt("login.password")}</div>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            disabled={submitting}
            style={{ ...s.input, fontFamily: "var(--font-mono)", fontSize: 13 }}
          />
        </div>

        <label style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 8,
          margin: "-6px 0 14px",
          fontFamily: "var(--font-sans)",
          fontSize: 12.5,
          lineHeight: 1.45,
          color: "var(--ink-3)",
          cursor: submitting ? "default" : "pointer",
        }}>
          <input
            type="checkbox"
            checked={rememberLogin}
            onChange={e => setRememberLogin(e.target.checked)}
            disabled={submitting}
            style={{ marginTop: 2, accentColor: "var(--moss)" }}
          />
          <span>{tt("login.remember_password")}</span>
        </label>

        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          margin: "0 0 18px",
          fontFamily: "var(--font-sans)",
          fontSize: 12.5,
        }}>
          <button type="button" onClick={() => openDialog("create")} disabled={submitting} style={textButtonStyle()}>
            {tt("login.create")}
          </button>
          <button type="button" onClick={() => openDialog("forgot")} disabled={submitting} style={textButtonStyle({ align: "right", tone: "ink" })}>
            {tt("login.forgot_password")}
          </button>
        </div>

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
        {notice && (
          <div style={{
            border: "1px solid rgba(72,93,57,0.35)",
            background: "rgba(72,93,57,0.08)",
            color: "var(--moss-deep)",
            padding: "8px 12px",
            fontSize: 12,
            fontFamily: "var(--font-sans)",
            borderRadius: 2,
            marginBottom: 16,
            lineHeight: 1.5,
          }}>
            {notice}
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
          {submitting ? tt("login.signing") : tt("login.signin")}
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
          <a
            href="https://www.aitrainstudio.com/"
            target="_blank"
            rel="noreferrer"
            style={{
              color: "var(--moss-deep)",
              textDecoration: "underline",
            }}
          >
            {tt("login.web_link")}
          </a>
        </div>
      </form>
    </div>
    {activeDialog === "create" && (
      <CreateAccountModal
        initialEmail={email}
        register={register}
        tt={tt}
        isMobile={isMobile}
        onClose={() => setActiveDialog(null)}
        onRegistered={handleRegistered}
      />
    )}
    {activeDialog === "forgot" && (
      <ForgotPasswordModal
        initialEmail={email}
        sendPasswordReset={sendPasswordReset}
        tt={tt}
        isMobile={isMobile}
        onClose={() => setActiveDialog(null)}
        onSent={handleResetSent}
      />
    )}
    </ModalRoot>
  );
}
