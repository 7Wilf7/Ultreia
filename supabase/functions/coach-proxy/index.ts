// Wallet-backed AI coach proxy.
//
// The app owner's provider keys stay in Edge Function secrets. This function
// identifies the caller from their JWT, ensures their wallet exists, calls the
// selected provider, then debits the wallet only after a successful upstream reply.
//
// Auth: caller must be logged in (verify JWT can stay ON). Deploy:
//   npx supabase functions deploy coach-proxy
//
// Secrets: SHARED_DEEPSEEK_KEY, SHARED_CLAUDE_KEY (set in Dashboard → Edge Functions → Secrets).
// Auto-injected: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "npm:@supabase/supabase-js@2";

const PROVIDERS = {
  deepseek: {
    id: "deepseek",
    url: "https://api.deepseek.com/anthropic/v1/messages",
    model: "deepseek-v4-pro",
    keyEnv: "SHARED_DEEPSEEK_KEY",
    chargeCents: 10,
  },
  claude: {
    id: "claude",
    url: "https://gw.claudeapi.com/v1/messages",
    model: "claude-opus-4-8",
    keyEnv: "SHARED_CLAUDE_KEY",
    chargeCents: 20,
  },
} as const;
type ProviderId = keyof typeof PROVIDERS;

function resolveProvider(value: unknown): typeof PROVIDERS[ProviderId] {
  return value === "claude" ? PROVIDERS.claude : PROVIDERS.deepseek;
}

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

  let body: { system?: string; messages?: unknown; max_tokens?: number; provider?: string };
  try { body = await req.json(); } catch { return json({ error: "bad_input" }, 400); }
  if (!Array.isArray(body.messages)) return json({ error: "bad_input" }, 400);

  const provider = resolveProvider(body.provider);
  const key = Deno.env.get(provider.keyEnv);
  if (!key) return json({ error: "server_misconfigured" }, 500);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: { user }, error: whoErr } = await admin.auth.getUser(jwt);
  if (whoErr || !user) return json({ error: "unauthorized" }, 401);
  const uid = user.id;

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
  if ((wallet?.balance_cents ?? 0) < provider.chargeCents) {
    return json({ error: "insufficient_balance" }, 402);
  }

  // Call the selected provider with the shared key. Failures are NOT charged.
  let upstream: Response;
  try {
    upstream = await fetch(provider.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: provider.model,
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
    p_amount_cents: provider.chargeCents,
    p_kind: "ai_charge",
    p_provider: provider.id,
    p_request_id: requestId,
    p_metadata: {
      provider: provider.id,
      model: provider.model,
      usage: data.usage || null,
    },
  });
  if (debitErr) {
    const insufficient = String(debitErr.message || "").includes("insufficient_balance");
    return json({ error: insufficient ? "insufficient_balance" : "wallet_debit_failed" }, insufficient ? 402 : 500);
  }

  return json({
    ...data,
    provider: provider.id,
    model: provider.model,
    wallet: { balance_cents: balanceAfter, charge_cents: provider.chargeCents },
  });
});
