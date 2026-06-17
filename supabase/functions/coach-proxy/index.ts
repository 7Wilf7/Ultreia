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
    pricingCnyPerM: { input: 29.1, inputCacheHit: 2.91, inputCacheWrite: 36.375, output: 145.5 },
  },
} as const;
type ProviderId = keyof typeof PROVIDERS;
type Pricing = {
  input: number;
  inputCacheHit?: number;
  inputCacheWrite?: number;
  output: number;
};
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
  inputCacheWrite: number;
} {
  const u = (usage && typeof usage === "object") ? usage as Record<string, unknown> : {};
  const input = Number(u.input_tokens ?? u.prompt_tokens ?? u.inputTokens ?? u.promptTokens ?? 0);
  const output = Number(u.output_tokens ?? u.completion_tokens ?? u.outputTokens ?? u.completionTokens ?? 0);
  const deepseekCacheHit = Number(u.prompt_cache_hit_tokens ?? 0);
  const deepseekCacheMiss = Number(u.prompt_cache_miss_tokens ?? 0);
  const anthropicCacheRead = Number(u.cache_read_input_tokens ?? 0);
  const anthropicCacheWrite = Number(u.cache_creation_input_tokens ?? 0);
  const inputCacheHit = Number.isFinite(deepseekCacheHit) && deepseekCacheHit > 0 ? deepseekCacheHit
    : Number.isFinite(anthropicCacheRead) ? anthropicCacheRead
    : 0;
  const inputCacheMiss = Number.isFinite(deepseekCacheMiss) ? deepseekCacheMiss : 0;
  const inputCacheWrite = Number.isFinite(anthropicCacheWrite) ? anthropicCacheWrite : 0;
  const hasDeepseekBreakdown = Number.isFinite(deepseekCacheHit) && deepseekCacheHit > 0
    || Number.isFinite(deepseekCacheMiss) && deepseekCacheMiss > 0;
  const totalInput = hasDeepseekBreakdown
    ? Math.max(input, inputCacheHit + inputCacheMiss)
    : input + inputCacheHit + inputCacheWrite;
  const total = Number(u.total_tokens ?? u.totalTokens ?? totalInput + output);
  return {
    input: Number.isFinite(input) ? input : 0,
    output: Number.isFinite(output) ? output : 0,
    total: Number.isFinite(total) ? Math.max(total, totalInput + output) : 0,
    inputCacheHit: Number.isFinite(inputCacheHit) ? inputCacheHit : 0,
    inputCacheMiss: Number.isFinite(inputCacheMiss) ? inputCacheMiss : 0,
    inputCacheWrite: Number.isFinite(inputCacheWrite) ? inputCacheWrite : 0,
  };
}

function calcChargeCents(provider: typeof PROVIDERS[ProviderId], usage: unknown): {
  actualCostCents: number;
  chargeCents: number;
  billableUsage: ReturnType<typeof tokenUsage>;
} {
  const tokens = tokenUsage(usage);
  const pricing = provider.pricingCnyPerM as Pricing;
  const cacheHitPrice = pricing.inputCacheHit ?? pricing.input;
  const cacheWritePrice = pricing.inputCacheWrite ?? pricing.input;
  const inputCny = provider.id === "deepseek" && (tokens.inputCacheHit > 0 || tokens.inputCacheMiss > 0)
    ? (tokens.inputCacheHit / 1_000_000) * cacheHitPrice
      + (tokens.inputCacheMiss / 1_000_000) * pricing.input
      + (Math.max(0, tokens.input - tokens.inputCacheHit - tokens.inputCacheMiss) / 1_000_000) * pricing.input
    : (tokens.input / 1_000_000) * pricing.input
      + (tokens.inputCacheHit / 1_000_000) * cacheHitPrice
      + (tokens.inputCacheWrite / 1_000_000) * cacheWritePrice;
  const actualCny = inputCny + (tokens.output / 1_000_000) * pricing.output;
  const actualCostCents = Math.round(actualCny * 100);
  const chargeCents = Math.max(MIN_AI_CHARGE_CENTS, Math.round(actualCny * AI_MARKUP_RATE * 100));
  return { actualCostCents, chargeCents, billableUsage: tokens };
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

const STREAM_HEADERS = {
  ...CORS,
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  "Connection": "keep-alive",
};

function streamEvent(controller: ReadableStreamDefaultController<Uint8Array>, event: unknown) {
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
}

function extractText(data: unknown): string {
  const content = (data && typeof data === "object" ? (data as { content?: unknown }).content : null);
  return Array.isArray(content)
    ? content
      .filter((block): block is { type: string; text: string } => {
        return !!block && typeof block === "object"
          && (block as { type?: unknown }).type === "text"
          && typeof (block as { text?: unknown }).text === "string";
      })
      .map(block => block.text)
      .join("")
    : "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "unauthorized" }, 401);

  let body: { system?: string; messages?: unknown; max_tokens?: number; provider?: string; stream?: boolean };
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
        stream: body.stream === true,
      }),
    });
  } catch (e) {
    return json({ error: "upstream_failed", detail: String(e) }, 502);
  }
  if (body.stream) {
    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.json().catch(() => null);
      return json({ error: (detail as { error?: { message?: string } })?.error?.message || "upstream_error", detail }, upstream.status || 502);
    }

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = upstream.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let finalMessage: Record<string, unknown> | null = null;
        let usage: unknown = null;
        let upstreamError = "";

        const mergeUsage = (next: unknown) => {
          if (!next || typeof next !== "object") return;
          usage = { ...((usage && typeof usage === "object") ? usage as Record<string, unknown> : {}), ...next as Record<string, unknown> };
        };

        const finishWithError = (message: string) => {
          streamEvent(controller, { type: "error", error: { message } });
          controller.close();
        };

        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let nl;
            while ((nl = buffer.indexOf("\n")) >= 0) {
              const line = buffer.slice(0, nl).trim();
              buffer = buffer.slice(nl + 1);
              if (!line.startsWith("data:")) continue;
              const payload = line.slice(5).trim();
              if (!payload || payload === "[DONE]") continue;
              let evt: Record<string, unknown>;
              try { evt = JSON.parse(payload); } catch { continue; }

              if (evt.type === "message_start") {
                const message = evt.message as Record<string, unknown> | undefined;
                if (message) {
                  finalMessage = { ...message };
                  mergeUsage(message.usage);
                }
              } else if (evt.type === "message_delta") {
                mergeUsage(evt.usage);
              } else if (evt.type === "message_stop") {
                // Finalize after the upstream stream closes so the wallet event is
                // the last data frame the client needs to read.
              } else if (evt.type === "error") {
                const err = evt.error as { message?: unknown } | undefined;
                upstreamError = typeof err?.message === "string" ? err.message : "stream error";
              }

              streamEvent(controller, evt);
            }
          }

          if (upstreamError) {
            finishWithError(upstreamError);
            return;
          }

          if (!usage) {
            finishWithError("missing_usage");
            return;
          }

          const { actualCostCents, chargeCents, billableUsage } = calcChargeCents(provider, usage);
          const upstreamId = typeof finalMessage?.id === "string" ? finalMessage.id : "";
          const requestId = upstreamId ? `ai:${upstreamId}` : `ai:${uid}:${Date.now()}`;
          const { data: balanceAfter, error: debitErr } = await admin.rpc("wallet_debit", {
            p_user_id: uid,
            p_amount_cents: chargeCents,
            p_kind: "ai_charge",
            p_provider: provider.id,
            p_request_id: requestId,
            p_metadata: {
              provider: provider.id,
              model: provider.model,
              usage,
              billable_usage: billableUsage,
              actual_cost_cents: actualCostCents,
              markup_rate: AI_MARKUP_RATE,
            },
          });
          if (debitErr) {
            const insufficient = String(debitErr.message || "").includes("insufficient_balance");
            finishWithError(insufficient ? "insufficient_balance" : "wallet_debit_failed");
            return;
          }

          streamEvent(controller, {
            type: "wallet",
            provider: provider.id,
            model: provider.model,
            usage,
            wallet: {
              balance_cents: balanceAfter,
              charge_cents: chargeCents,
              actual_cost_cents: actualCostCents,
              markup_rate: AI_MARKUP_RATE,
              billable_usage: billableUsage,
            },
          });
          controller.close();
        } catch (e) {
          finishWithError(String(e));
        }
      },
      cancel() {
        upstream.body?.cancel().catch(() => {});
      },
    });

    return new Response(stream, { headers: STREAM_HEADERS });
  }

  const data = await upstream.json().catch(() => null);
  if (!upstream.ok || !data) {
    return json({ error: (data as { error?: { message?: string } })?.error?.message || "upstream_error", detail: data }, upstream.status || 502);
  }

  const { actualCostCents, chargeCents, billableUsage } = calcChargeCents(provider, data.usage || null);

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
      billable_usage: billableUsage,
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
    content: Array.isArray(data.content) ? data.content : [{ type: "text", text: extractText(data) }],
    provider: provider.id,
    model: provider.model,
    wallet: {
      balance_cents: balanceAfter,
      charge_cents: chargeCents,
      actual_cost_cents: actualCostCents,
      markup_rate: AI_MARKUP_RATE,
      billable_usage: billableUsage,
    },
  });
});
