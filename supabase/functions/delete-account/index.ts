// Self-service Aevum account deletion.
//
// A logged-in user can permanently delete their own Aevum account.
// The JS client can't delete its own auth user (that needs service_role), so
// this function identifies the caller from their JWT and deletes the auth user.
// Product data in Aevum / Ultreia / Viatica is cleaned by database-level
// ON DELETE CASCADE constraints from each user-owned table to auth.users.
//
// Do not manually enumerate product tables here. Aevum account deletion is a
// shared account boundary; adding product-specific cleanup in this function can
// create partial deletion if table deletes succeed but auth deletion fails.
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

  // Remove the Aevum auth user. Database FK cascades clean product rows.
  const { error: delErr } = await admin.auth.admin.deleteUser(uid);
  if (delErr) return json({ error: "delete_failed", detail: delErr.message }, 500);

  return json({ ok: true });
});
