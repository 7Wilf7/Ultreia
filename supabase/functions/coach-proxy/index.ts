// Free-tier AI coach proxy (DeepSeek only).
//
// New users get a one-time free allowance of DeepSeek messages served from the
// app owner's key, so they can try the coach without registering their own API
// key. This function: identifies the caller from their JWT, checks their
// per-user quota in usage_quota, calls DeepSeek with the SHARED_DEEPSEEK_KEY,
// counts the call, and returns the Anthropic-shaped reply. When the quota is
// spent it returns 402 so the client prompts the user to add their own key.
//
// Auth: caller must be logged in (verify JWT can stay ON). Deploy:
//   npx supabase functions deploy coach-proxy
//
// Secrets: SHARED_DEEPSEEK_KEY (set in Dashboard → Edge Functions → Secrets).
// Auto-injected: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "npm:@supabase/supabase-js@2";

const DEEPSEEK_LIMIT = 10;
const DEEPSEEK_URL = "https://api.deepseek.com/anthropic/v1/messages";
const DEEPSEEK_MODEL = "deepseek-v4-pro";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "unauthorized" }, 401);

  const key = Deno.env.get("SHARED_DEEPSEEK_KEY");
  if (!key) return json({ error: "server_misconfigured" }, 500);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: { user }, error: whoErr } = await admin.auth.getUser(jwt);
  if (whoErr || !user) return json({ error: "unauthorized" }, 401);
  const uid = user.id;

  let body: { system?: string; messages?: unknown; max_tokens?: number };
  try { body = await req.json(); } catch { return json({ error: "bad_input" }, 400); }
  if (!Array.isArray(body.messages)) return json({ error: "bad_input" }, 400);

  // Ensure a quota row exists, then read current usage.
  await admin.from("usage_quota").upsert({ user_id: uid }, { onConflict: "user_id", ignoreDuplicates: true });
  const { data: q } = await admin.from("usage_quota").select("deepseek_used").eq("user_id", uid).single();
  const used = q?.deepseek_used ?? 0;
  if (used >= DEEPSEEK_LIMIT) return json({ error: "quota_exceeded", remaining: 0 }, 402);

  // Call DeepSeek with the shared key. Failures are NOT counted against quota.
  let upstream: Response;
  try {
    upstream = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        max_tokens: body.max_tokens || 8000,
        system: body.system || "",
        messages: body.messages,
      }),
    });
  } catch (e) {
    return json({ error: "upstream_failed", detail: String(e) }, 502);
  }
  const data = await upstream.json().catch(() => null);
  if (!upstream.ok || !data) {
    return json({ error: (data as { error?: { message?: string } })?.error?.message || "upstream_error", detail: data }, upstream.status || 502);
  }

  // Count the successful call.
  const next = used + 1;
  await admin.from("usage_quota").update({ deepseek_used: next, updated_at: new Date().toISOString() }).eq("user_id", uid);

  return json({ ...data, remaining: DEEPSEEK_LIMIT - next });
});
