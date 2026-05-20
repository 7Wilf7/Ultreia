import { useState } from "react";
import { LoginScreen } from "./LoginScreen";

const cellBase = {
  border: "1px solid var(--rule)",
  background: "var(--bg-elevated)",
  height: 32,
  padding: "0 12px",
  fontSize: 13,
  color: "var(--ink-2)",
  fontFamily: "var(--font-sans)",
  borderRadius: 0,
};

function emailPrefix(email) {
  if (!email) return "";
  const i = email.indexOf("@");
  return i > 0 ? email.slice(0, i) : email;
}

export function UserBadge({ user, loading, signIn, signOut }) {
  const [showLogin, setShowLogin] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

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

  if (loading) {
    return (
      <button disabled
        style={{ ...cellBase, color: "var(--ink-3)", cursor: "default", fontFamily: "var(--font-mono)", fontSize: 11 }}>
        …
      </button>
    );
  }

  if (!user) {
    return (
      <>
        <button
          onClick={() => setShowLogin(true)}
          title="Sign in to sync across devices"
          style={cellBase}
        >
          Sign in
        </button>
        {showLogin && (
          <LoginScreen
            onClose={() => setShowLogin(false)}
            signIn={signIn}
          />
        )}
      </>
    );
  }

  const prefix = emailPrefix(user.email);

  return (
    <>
      <span
        title={user.email}
        style={{
          ...cellBase,
          borderRight: "none",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          maxWidth: 180,
          overflow: "hidden",
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ width: 6, height: 6, background: "var(--moss)", borderRadius: 0, flexShrink: 0 }} />
        <span style={{
          fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-1)",
          overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {prefix}
        </span>
      </span>
      <button
        onClick={handleSignOut}
        disabled={signingOut}
        title="Sign out"
        style={{
          ...cellBase,
          color: signingOut ? "var(--ink-3)" : "var(--ink-2)",
          cursor: signingOut ? "default" : "pointer",
        }}
      >
        {signingOut ? "…" : "Sign out"}
      </button>
    </>
  );
}
