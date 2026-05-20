import { useState } from "react";
import { s } from "../../styles";

export function LoginScreen({ onClose, signIn }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    setError("");
    setSubmitting(true);
    try {
      await signIn(email, password);
      onClose();
    } catch (err) {
      setError(err?.message || "Sign in failed");
      setSubmitting(false);
    }
  }

  return (
    <div
      onClick={submitting ? undefined : onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        zIndex: 1000, padding: 20, overflowY: "auto",
      }}
    >
      <form
        onClick={e => e.stopPropagation()}
        onSubmit={handleSubmit}
        style={{
          background: "var(--bg-elevated)", borderRadius: 4, padding: 28,
          maxWidth: 380, width: "100%",
          boxShadow: "0 10px 40px rgba(0,0,0,0.2)",
          margin: "60px auto",
          border: "1px solid var(--rule)",
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
          Sign in
        </h2>
        <p style={{ ...s.muted, marginBottom: 22, lineHeight: 1.5 }}>
          Access your training data across devices.
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

        <div style={{ marginBottom: 18 }}>
          <div style={{ ...s.label, marginBottom: 6 }}>Password</div>
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
          disabled={submitting || !email || !password}
          style={{
            ...s.btn,
            width: "100%",
            padding: "11px 18px",
            opacity: submitting || !email || !password ? 0.55 : 1,
            cursor: submitting || !email || !password ? "default" : "pointer",
          }}
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>

        <div style={{
          marginTop: 18,
          paddingTop: 14,
          borderTop: "1px solid var(--rule)",
          textAlign: "center",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--ink-3)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}>
          Invite only — contact admin for access
        </div>
      </form>
    </div>
  );
}
