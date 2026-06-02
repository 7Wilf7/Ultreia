import { useState } from "react";
import { s } from "../../styles";
import { useIsMobile } from "../../hooks/useMediaQuery";
import { ModalRoot } from "../ModalRoot";

// Map the Edge Function's error ids to friendly copy. Kept English to match the
// rest of this (pre-auth, English-only) screen.
function registerErrorText(code) {
  switch (code) {
    case "invalid_code":  return "Invalid invite code.";
    case "code_used":     return "This invite code has already been used.";
    case "email_taken":   return "This email is already registered — try signing in instead.";
    case "weak_password": return "Password must be at least 6 characters.";
    case "bad_input":     return "Please check your email and invite code.";
    default:              return "Registration failed. Please try again.";
  }
}

export function LoginScreen({ onClose, signIn, register }) {
  const isMobile = useIsMobile();
  const [mode, setMode] = useState("signin"); // "signin" | "register"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [invite, setInvite] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const isRegister = mode === "register";

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
      if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
      if (password !== password2) { setError("The two passwords don't match."); return; }
      if (!invite.trim()) { setError("An invite code is required."); return; }
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
        : (err?.message || "Sign in failed"));
      setSubmitting(false);
    }
  }

  const canSubmit = isRegister
    ? email && password && password2 && invite
    : email && password;

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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--moss)", fontWeight: 600 }}>
            ▲ Training Studio
          </div>
          {!submitting && (
            <button type="button" onClick={onClose}
              style={{ background: "none", border: "none", fontSize: 22, color: "var(--ink-3)", cursor: "pointer", padding: 0, lineHeight: 1 }}>
              ×
            </button>
          )}
        </div>

        <h2 style={{ fontFamily: "var(--font-sans)", fontSize: 22, fontWeight: 500, margin: "10px 0 4px", color: "var(--ink-1)", letterSpacing: "-0.01em" }}>
          {isRegister ? "Create account" : "Sign in"}
        </h2>
        <p style={{ ...s.muted, marginBottom: 22, lineHeight: 1.5 }}>
          {isRegister
            ? "Register with an invite code from the admin."
            : "Access your training data across devices."}
        </p>

        <div style={{ marginBottom: 14 }}>
          <div style={{ ...s.label, marginBottom: 6 }}>Email</div>
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
          <div style={{ ...s.label, marginBottom: 6 }}>Password</div>
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
              <div style={{ ...s.label, marginBottom: 6 }}>Confirm password</div>
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
              <div style={{ ...s.label, marginBottom: 6 }}>Invite code</div>
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
            ? (isRegister ? "Creating…" : "Signing in…")
            : (isRegister ? "Create account" : "Sign in")}
        </button>

        <div style={{
          marginTop: 18,
          paddingTop: 14,
          borderTop: "1px solid var(--rule)",
          textAlign: "center",
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          color: "var(--ink-3)",
        }}>
          {isRegister ? (
            <>
              Already have an account?{" "}
              <button type="button" onClick={() => switchMode("signin")}
                style={{ background: "none", border: "none", padding: 0, color: "var(--moss-deep)", cursor: "pointer", fontFamily: "inherit", fontSize: "inherit", textDecoration: "underline" }}>
                Sign in
              </button>
            </>
          ) : (
            <>
              Have an invite code?{" "}
              <button type="button" onClick={() => switchMode("register")}
                style={{ background: "none", border: "none", padding: 0, color: "var(--moss-deep)", cursor: "pointer", fontFamily: "inherit", fontSize: "inherit", textDecoration: "underline" }}>
                Register
              </button>
            </>
          )}
        </div>
      </form>
    </div>
    </ModalRoot>
  );
}
