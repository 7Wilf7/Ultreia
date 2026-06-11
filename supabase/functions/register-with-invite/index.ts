// Invite-gated self-registration.
//
// The app is invite-only. Public Supabase signup stays DISABLED — instead a
// would-be user submits { email, password, code } here, and this function (with
// service_role, so it bypasses RLS) validates a one-time invite code, creates
// an unconfirmed auth user, burns the code, and sends the signup confirmation
// email. Atomicity: the code is only marked used
// AFTER the user is created, via a conditional UPDATE that loses the race if
// someone else used it first (in which case we delete the just-created user).
//
// Auth: runs with Verify JWT = OFF — a registrant has no session yet. Deploy:
//   npx supabase functions deploy register-with-invite --no-verify-jwt
//
// Auto-injected secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: { email?: string; password?: string; code?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_input" }, 400);
  }

  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";
  const code = (body.code || "").trim();

  if (!EMAIL_RE.test(email) || !code) return json({ error: "bad_input" }, 400);
  if (password.length < 6) return json({ error: "weak_password" }, 400);

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // 1. Look up the code for a friendly early error.
  const { data: codeRow, error: lookupErr } = await db
    .from("invite_codes")
    .select("code, used_by")
    .eq("code", code)
    .maybeSingle();
  if (lookupErr) return json({ error: "server_error", detail: lookupErr.message }, 500);
  if (!codeRow) return json({ error: "invalid_code" }, 400);
  if (codeRow.used_by) return json({ error: "code_used" }, 400);

  // 2. Create the auth user without confirming email. createUser() does not
  //    send the confirmation email, so we resend the signup confirmation after
  //    the invite code is safely burned below.
  const { data: created, error: createErr } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: false,
  });
  if (createErr) {
    const msg = (createErr.message || "").toLowerCase();
    if ((createErr as { code?: string }).code === "email_exists" || msg.includes("already")) {
      return json({ error: "email_taken" }, 400);
    }
    if (msg.includes("password")) return json({ error: "weak_password" }, 400);
    return json({ error: "server_error", detail: createErr.message }, 500);
  }
  const newUserId = created.user.id;

  // 3. Burn the code — conditional on still-unused. If we lost the race,
  //    roll back by deleting the user we just created.
  const { data: burned, error: burnErr } = await db
    .from("invite_codes")
    .update({ used_by: newUserId, used_at: new Date().toISOString(), used_email: email })
    .eq("code", code)
    .is("used_by", null)
    .select("code");
  if (burnErr || !burned || burned.length === 0) {
    await db.auth.admin.deleteUser(newUserId).catch(() => {});
    return json({ error: "code_used" }, 400);
  }

  // 4. Send the verification email. If this fails, keep the account + burned
  //    code: the login screen can resend the confirmation email for this user.
  const { error: resendErr } = await db.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: "https://www.ultreia.run/" },
  });
  if (resendErr) return json({ error: "confirmation_send_failed", detail: resendErr.message }, 500);

  return json({ ok: true, needsEmailVerification: true });
});
