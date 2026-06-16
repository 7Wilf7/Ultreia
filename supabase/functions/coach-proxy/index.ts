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
    pricingCnyPerM: { input: 3.16, inputCacheHit: 0.026, output: 6.32 },
  },
  claude: {
    id: "claude",
    url: "https://gw.claudeapi.com/v1/messages",
    model: "claude-opus-4-8",
    keyEnv: "SHARED_CLAUDE_KEY",
    pricingCnyPerM: { input: 29.1, output: 145.5 },
  },
} as const;
type ProviderId = keyof typeof PROVIDERS;
const AI_MARKUP_RATE = 1.2;
const MIN_AI_CHARGE_CENTS = 1;

function resolveProvider(value: unknown): typeof PROVIDERS[ProviderId] {
  return value === "claude" ? PROVIDERS.claude : PROVIDERS.deepseek;
}

function tokenUsage(usage: unknown): {
  input: number;
  output: number;
  total: number;
  inputCacheHit: number;
  inputCacheMiss: number;
} {
  const u = (usage && typeof usage === "object") ? usage as Record<string, unknown> : {};
  const input = Number(u.input_tokens ?? u.prompt_tokens ?? u.inputTokens ?? u.promptTokens ?? 0);
  const output = Number(u.output_tokens ?? u.completion_tokens ?? u.outputTokens ?? u.completionTokens ?? 0);
  const total = Number(u.total_tokens ?? u.totalTokens ?? input + output);
  const inputCacheHit = Number(u.prompt_cache_hit_tokens ?? u.cache_read_input_tokens ?? 0);
  const inputCacheMiss = Number(u.prompt_cache_miss_tokens ?? 0);
  return {
    input: Number.isFinite(input) ? input : 0,
    output: Number.isFinite(output) ? output : 0,
    total: Number.isFinite(total) ? total : 0,
    inputCacheHit: Number.isFinite(inputCacheHit) ? inputCacheHit : 0,
    inputCacheMiss: Number.isFinite(inputCacheMiss) ? inputCacheMiss : 0,
  };
}

function calcChargeCents(provider: typeof PROVIDERS[ProviderId], usage: unknown): { actualCostCents: number; chargeCents: number } {
  const tokens = tokenUsage(usage);
  const hasInputCacheBreakdown = tokens.inputCacheHit > 0 || tokens.inputCacheMiss > 0;
  const inputCny = hasInputCacheBreakdown
    ? (tokens.inputCacheHit / 1_000_000) * (provider.pricingCnyPerM.inputCacheHit ?? provider.pricingCnyPerM.input)
      + (tokens.inputCacheMiss / 1_000_000) * provider.pricingCnyPerM.input
    : (tokens.input / 1_000_000) * provider.pricingCnyPerM.input;
  const actualCny = inputCny + (tokens.output / 1_000_000) * provider.pricingCnyPerM.output;
  const actualCostCents = Math.round(actualCny * 100);
  const chargeCents = Math.max(MIN_AI_CHARGE_CENTS, Math.round(actualCny * AI_MARKUP_RATE * 100));
  return { actualCostCents, chargeCents };
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
  if ((wallet?.balance_cents ?? 0) < MIN_AI_CHARGE_CENTS) return json({ error: "insufficient_balance" }, 402);

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

  const { actualCostCents, chargeCents } = calcChargeCents(provider, data.usage || null);

  const requestId = data.id ? `ai:${data.id}` : `ai:${uid}:${Date.now()}`;
  const { data: balanceAfter, error: debitErr } = await admin.rpc("wallet_debit", {
    p_user_id: uid,
    p_amount_cents: chargeCents,
    p_kind: "ai_charge",
    p_provider: provider.id,
    p_request_id: requestId,
    p_metadata: {
      provider: provider.id,
      model: provider.model,
      usage: data.usage || null,
      actual_cost_cents: actualCostCents,
      markup_rate: AI_MARKUP_RATE,
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
    wallet: {
      balance_cents: balanceAfter,
      charge_cents: chargeCents,
      actual_cost_cents: actualCostCents,
      markup_rate: AI_MARKUP_RATE,
    },
  });
});
