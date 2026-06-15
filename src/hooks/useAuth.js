import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { registerWithInvite } from "../lib/db/invites";
import { clearPushRegistrationForCurrentUser } from "../lib/push";

const AUTH_REDIRECT_TO = "https://www.ultreia.run/";

export function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [recoveryMode, setRecoveryMode] = useState(false);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setUser(data.session?.user ?? null);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") setRecoveryMode(true);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      const msg = (error.message || "").toLowerCase();
      if (msg.includes("confirm") || msg.includes("verified")) error.code = "email_not_confirmed";
      throw error;
    }
    return data;
  }

  async function sendPasswordReset(email) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: AUTH_REDIRECT_TO,
    });
    if (error) throw error;
  }

  async function resendSignupConfirmation(email) {
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: AUTH_REDIRECT_TO },
    });
    if (error) throw error;
  }

  async function completePasswordRecovery(newPassword) {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
    setRecoveryMode(false);
  }

  async function signOut() {
    await clearPushRegistrationForCurrentUser();
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }

  // Invite-gated registration: the Edge Function validates the code + creates
  // the unconfirmed account, then sends the signup confirmation email. The
  // user can sign in only after clicking the email link.
  // registerWithInvite throws an Error with `.code` set to the server error id.
  async function register(email, password, code) {
    return await registerWithInvite(email, password, code);
  }

  // Verify-then-update flow: Supabase's updateUser does NOT require the old
  // password (the session token alone authorizes the change), so a casual
  // attacker who walks up to an unlocked device could reset the password
  // without knowing the current one. We re-authenticate via signInWithPassword
  // first as a possession check. On failure we surface a distinct error so
  // the modal can render the "wrong current password" hint. On success the
  // user's session is refreshed (signIn returns a new token) — no side effect
  // visible to the caller.
  async function changePassword(currentPassword, newPassword) {
    const email = user?.email;
    if (!email) throw new Error("no_active_session");
    const { error: verifyErr } = await supabase.auth.signInWithPassword({
      email, password: currentPassword,
    });
    if (verifyErr) {
      const e = new Error("current_password_invalid");
      e.code = "current_password_invalid";
      throw e;
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
  }

  // Permanent account deletion. Re-authenticates first as a possession check
  // (same rationale as changePassword), then calls the delete-account Edge
  // Function (service_role wipes the user's data + auth row), then signs out so
  // the now-invalid session is cleared and the UI returns to the login screen.
  async function deleteAccount(currentPassword) {
    const email = user?.email;
    if (!email) throw new Error("no_active_session");
    const { error: verifyErr } = await supabase.auth.signInWithPassword({
      email, password: currentPassword,
    });
    if (verifyErr) {
      const e = new Error("current_password_invalid");
      e.code = "current_password_invalid";
      throw e;
    }
    const { data, error } = await supabase.functions.invoke("delete-account", { body: {} });
    if (error) throw new Error(error.message || "delete_failed");
    if (data && data.error) throw new Error(data.detail || data.error);
    await supabase.auth.signOut();
  }

  return {
    user,
    loading,
    recoveryMode,
    signIn,
    signOut,
    changePassword,
    register,
    deleteAccount,
    sendPasswordReset,
    resendSignupConfirmation,
    completePasswordRecovery,
    clearRecoveryMode: () => setRecoveryMode(false),
  };
}
