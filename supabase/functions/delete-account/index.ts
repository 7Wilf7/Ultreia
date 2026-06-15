// Self-service account deletion.
//
// A logged-in user can permanently delete their own account + all their data.
// The JS client can't delete its own auth user (that needs service_role), so
// this function does it: it identifies the caller from their JWT, wipes their
// rows from every user-scoped table (belt-and-braces, in case any FK isn't ON
// DELETE CASCADE), then deletes the auth user.
//
// Auth: the caller must be logged in. The client's functions.invoke attaches
// their access token as the Authorization bearer; we validate it via getUser().
// Deploy (JWT verification can stay ON — only authenticated calls should reach
// this):
//   npx supabase functions deploy delete-account
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

// User-scoped tables keyed by user_id. push_log may not exist on every project —
// deletes are best-effort (errors ignored) so a missing table doesn't abort.
const USER_TABLES = [
  "workouts",
  "races",
  "coach_messages",
  "user_settings",
  "daily_notes",
  "push_subscriptions",
  "push_inbox",
  "push_log",
  "usage_quota",
  "wallet_ledger",
  "wallets",
  "app_admins",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "unauthorized" }, 401);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Identify the caller from their token. getUser validates it against the auth
  // server, so this is the authorization check — no one can delete another user.
  const { data: { user }, error: whoErr } = await admin.auth.getUser(jwt);
  if (whoErr || !user) return json({ error: "unauthorized" }, 401);
  const uid = user.id;

  // Wipe user-scoped rows first (ignore per-table errors: missing table/column).
  for (const tbl of USER_TABLES) {
    const { error } = await admin.from(tbl).delete().eq("user_id", uid);
    if (error) console.error(`delete ${tbl} for ${uid}:`, error.message);
  }
  // profiles is keyed by id (= auth.uid()), not user_id.
  const { error: profErr } = await admin.from("profiles").delete().eq("id", uid);
  if (profErr) console.error(`delete profiles for ${uid}:`, profErr.message);

  // Finally remove the auth user.
  const { error: delErr } = await admin.auth.admin.deleteUser(uid);
  if (delErr) return json({ error: "delete_failed", detail: delErr.message }, 500);

  return json({ ok: true });
});
