// Wallet-backed AI coach proxy (DeepSeek only).
//
// The app owner's DeepSeek key stays in Edge Function secrets. This function
// identifies the caller from their JWT, ensures their wallet exists, calls
// DeepSeek, then debits the wallet only after a successful upstream reply.
//
// Auth: caller must be logged in (verify JWT can stay ON). Deploy:
//   npx supabase functions deploy coach-proxy
//
// Secrets: SHARED_DEEPSEEK_KEY (set in Dashboard → Edge Functions → Secrets).
// Auto-injected: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "npm:@supabase/supabase-js@2";

const DEEPSEEK_URL = "https://api.deepseek.com/anthropic/v1/messages";
const DEEPSEEK_MODEL = "deepseek-v4-pro";
const AI_CHARGE_CENTS = 10;

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

  const { error: ensureErr } = await admin.rpc("wallet_ensure", {
    p_user_id: uid,
    p_initial_cents: 500,
  });
  if (ensureErr) return json({ error: "wallet_ensure_failed" }, 500);

  const { data: wallet } = await admin
    .from("wallets")
    .select("balance_cents")
    .eq("user_id", uid)
    .single();
  if ((wallet?.balance_cents ?? 0) < AI_CHARGE_CENTS) {
    return json({ error: "insufficient_balance" }, 402);
  }

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

  const requestId = data.id ? `ai:${data.id}` : `ai:${uid}:${Date.now()}`;
  const { data: balanceAfter, error: debitErr } = await admin.rpc("wallet_debit", {
    p_user_id: uid,
    p_amount_cents: AI_CHARGE_CENTS,
    p_kind: "ai_charge",
    p_provider: "deepseek",
    p_request_id: requestId,
    p_metadata: {
      model: DEEPSEEK_MODEL,
      usage: data.usage || null,
    },
  });
  if (debitErr) {
    const insufficient = String(debitErr.message || "").includes("insufficient_balance");
    return json({ error: insufficient ? "insufficient_balance" : "wallet_debit_failed" }, insufficient ? 402 : 500);
  }

  return json({ ...data, wallet: { balance_cents: balanceAfter } });
});
