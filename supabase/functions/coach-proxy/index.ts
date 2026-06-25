// Wallet-backed AI coach proxy.
//
// The app owner's DeepSeek key stays in Edge Function secrets. Phase-1
// desktop_codex support never receives Codex credentials: it only writes an
// ai_jobs row and waits briefly for a local desktop runner to write back text.
// If the runner is offline/missing/slow, this function falls back to DeepSeek
// and debits the wallet only after a successful upstream reply.
//
// Auth: caller must be logged in (verify JWT can stay ON). Deploy:
//   npx supabase functions deploy coach-proxy
//
// Secrets: SHARED_DEEPSEEK_KEY (set in Dashboard → Edge Functions → Secrets).
// Optional tuning: DESKTOP_CODEX_WAIT_MS, DESKTOP_CODEX_PREFER_WAIT_MS.
// Auto-injected: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "npm:@supabase/supabase-js@2";

const DEEPSEEK = {
  id: "deepseek",
  url: "https://api.deepseek.com/anthropic/v1/messages",
  model: "deepseek-v4-pro",
  keyEnv: "SHARED_DEEPSEEK_KEY",
  pricingCnyPerM: { input: 3.16, inputCacheHit: 0.026, output: 6.32 },
} as const;
const MIN_AI_CHARGE_CENTS = 1;
const AI_CHARGE_POLICY = "actual_cost_min_1_cent";
const DESKTOP_CODEX = {
  id: "desktop_codex",
  model: "codex-cli",
  chargePolicy: "chatgpt_codex_subscription_no_wallet_debit",
} as const;
const DESKTOP_RUNNER_FRESH_MS = 60_000;
const DESKTOP_JOB_TTL_MS = 2 * 60_000;
const DESKTOP_POLL_MS = 1000;

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

function calcChargeCents(usage: unknown): {
  actualCostCents: number;
  chargeCents: number;
  billableUsage: ReturnType<typeof tokenUsage>;
} {
  const tokens = tokenUsage(usage);
  const pricing = DEEPSEEK.pricingCnyPerM;
  const inputCny = (tokens.inputCacheHit / 1_000_000) * pricing.inputCacheHit
    + (tokens.inputCacheMiss / 1_000_000) * pricing.input
    + (Math.max(0, tokens.input - tokens.inputCacheHit - tokens.inputCacheMiss) / 1_000_000) * pricing.input;
  const actualCny = inputCny + (tokens.output / 1_000_000) * pricing.output;
  const actualCostCents = Math.round(actualCny * 100);
  const chargeCents = Math.max(MIN_AI_CHARGE_CENTS, actualCostCents);
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

function numberEnv(name: string, fallback: number): number {
  const n = Number(Deno.env.get(name));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function publicErrorMessage(value: unknown): string | null {
  const text = stringValue(value);
  if (!text) return null;
  return text.replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]").slice(0, 240);
}

function ageMsFromIso(value: unknown): number | null {
  const text = stringValue(value);
  if (!text) return null;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? Math.max(0, Date.now() - ms) : null;
}

function runnerHeartbeatState(status: string, ageMs: number | null): "online" | "stale" | "offline" {
  if (status === "online" && ageMs !== null && ageMs <= DESKTOP_RUNNER_FRESH_MS) return "online";
  if (status === "online" && ageMs !== null && ageMs <= DESKTOP_RUNNER_FRESH_MS * 5) return "stale";
  return "offline";
}

function desktopWallet(balanceCents: number) {
  return {
    balance_cents: balanceCents,
    charge_cents: 0,
    actual_cost_cents: 0,
    charge_policy: DESKTOP_CODEX.chargePolicy,
    billable_usage: null,
  };
}

async function readProviderPreference(admin: any, uid: string): Promise<"auto" | "prefer_codex" | "deepseek_only"> {
  const { data, error } = await admin
    .from("user_settings")
    .select("ai_provider_preference")
    .eq("user_id", uid)
    .maybeSingle();
  if (error) return "auto";
  const pref = String(data?.ai_provider_preference || "auto");
  return pref === "prefer_codex" || pref === "deepseek_only" ? pref : "auto";
}

async function hasFreshDesktopRunner(admin: any): Promise<{ ok: true; runnerId: string } | { ok: false; reason: string }> {
  const cutoff = new Date(Date.now() - DESKTOP_RUNNER_FRESH_MS).toISOString();
  const { data, error } = await admin
    .from("ai_runners")
    .select("id, last_seen_at, metadata")
    .eq("provider", DESKTOP_CODEX.id)
    .eq("status", "online")
    .gte("last_seen_at", cutoff)
    .order("last_seen_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false, reason: "desktop_schema_unavailable" };
  if (!data?.id) return { ok: false, reason: "desktop_runner_offline" };
  const metadata = objectValue(data.metadata);
  const lastCodexStatus = stringValue(metadata.lastCodexStatus);
  const lastErrorAgeMs = ageMsFromIso(metadata.lastCodexErrorAt);
  if (lastCodexStatus === "error" && (lastErrorAgeMs === null || lastErrorAgeMs <= DESKTOP_RUNNER_FRESH_MS * 5)) {
    return { ok: false, reason: "desktop_codex_unhealthy" };
  }
  return { ok: true, runnerId: String(data.id) };
}

async function readDesktopRunnerStatus(admin: any) {
  const checkedAt = new Date().toISOString();
  const { data, error } = await admin
    .from("ai_runners")
    .select("id, provider, status, last_seen_at, metadata")
    .eq("provider", DESKTOP_CODEX.id)
    .order("last_seen_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return {
      provider: DESKTOP_CODEX.id,
      state: "error",
      runner_state: "offline",
      codex_status: "unknown",
      error: "desktop_schema_unavailable",
      fresh_ms: DESKTOP_RUNNER_FRESH_MS,
      checked_at: checkedAt,
    };
  }

  if (!data?.id) {
    return {
      provider: DESKTOP_CODEX.id,
      state: "offline",
      runner_state: "offline",
      codex_status: "unknown",
      reason: "no_runner",
      fresh_ms: DESKTOP_RUNNER_FRESH_MS,
      checked_at: checkedAt,
    };
  }

  const metadata = objectValue(data.metadata);
  const status = String(data.status || "offline");
  const ageMs = ageMsFromIso(data.last_seen_at);
  const runnerState = runnerHeartbeatState(status, ageMs);
  const rawCodexStatus = stringValue(metadata.lastCodexStatus);
  const codexStatus = rawCodexStatus === "error" || rawCodexStatus === "ok" ? rawCodexStatus : "unknown";
  const state = codexStatus === "error" ? "error" : runnerState;

  return {
    provider: DESKTOP_CODEX.id,
    state,
    runner_state: runnerState,
    codex_status: codexStatus,
    runner_id: String(data.id),
    status,
    last_seen_at: stringValue(data.last_seen_at),
    age_ms: ageMs,
    fresh_ms: DESKTOP_RUNNER_FRESH_MS,
    model: stringValue(metadata.codexModel) || DESKTOP_CODEX.model,
    reasoning_effort: stringValue(metadata.reasoningEffort),
    codex_package: stringValue(metadata.codexPackage),
    locked_down: metadata.lockedDown === true,
    booted_at: stringValue(metadata.bootedAt),
    last_ok_at: stringValue(metadata.lastCodexOkAt),
    last_error_at: stringValue(metadata.lastCodexErrorAt),
    last_error: publicErrorMessage(metadata.lastCodexError),
    checked_at: checkedAt,
  };
}

function desktopJobPayload(body: { system?: string; messages?: unknown; max_tokens?: number; stream?: boolean }) {
  return {
    source: "coach_proxy",
    system: typeof body.system === "string" ? body.system : "",
    messages: Array.isArray(body.messages) ? body.messages : [],
    max_tokens: Number(body.max_tokens || 8000),
    stream: body.stream === true,
  };
}

async function markDesktopFallback(admin: any, jobId: string, reason: string) {
  await admin
    .from("ai_jobs")
    .update({
      status: "fallback_used",
      fallback_provider: DEEPSEEK.id,
      fallback_reason: reason,
    })
    .eq("id", jobId)
    .in("status", ["queued", "claimed", "running"]);
}

async function tryDesktopCodex(opts: {
  admin: any;
  uid: string;
  body: { system?: string; messages?: unknown; max_tokens?: number; stream?: boolean };
  walletBalanceCents: number;
  preference: "auto" | "prefer_codex" | "deepseek_only";
}): Promise<{ response: Response | null; fallbackReason: string }> {
  if (opts.preference === "deepseek_only") {
    return { response: null, fallbackReason: "" };
  }

  const runner = await hasFreshDesktopRunner(opts.admin);
  if (!runner.ok) return { response: null, fallbackReason: runner.reason };

  const waitMs = opts.preference === "prefer_codex"
    ? numberEnv("DESKTOP_CODEX_PREFER_WAIT_MS", 90_000)
    : numberEnv("DESKTOP_CODEX_WAIT_MS", opts.body.stream ? 35_000 : 45_000);
  const expiresAt = new Date(Date.now() + Math.max(waitMs + 15_000, DESKTOP_JOB_TTL_MS)).toISOString();
  const { data: job, error: jobErr } = await opts.admin
    .from("ai_jobs")
    .insert({
      user_id: opts.uid,
      kind: "coach_chat",
      status: "queued",
      provider_requested: DESKTOP_CODEX.id,
      payload: desktopJobPayload(opts.body),
      expires_at: expiresAt,
    })
    .select("id")
    .single();
  if (jobErr || !job?.id) {
    return { response: null, fallbackReason: "desktop_job_create_failed" };
  }

  const jobId = String(job.id);
  const deadline = Date.now() + waitMs;
  let fallbackReason = "desktop_timeout";
  while (Date.now() < deadline) {
    await delay(DESKTOP_POLL_MS);
    const { data: row, error } = await opts.admin
      .from("ai_jobs")
      .select("status, result, error, provider_actual")
      .eq("id", jobId)
      .maybeSingle();
    if (error) {
      fallbackReason = "desktop_job_read_failed";
      break;
    }
    const status = String(row?.status || "");
    if (status === "completed") {
      const result = objectValue(row?.result);
      const text = typeof result.text === "string" ? result.text.trim() : "";
      if (!text) {
        fallbackReason = "desktop_empty_response";
        break;
      }
      const usage = objectValue(result.usage);
      return {
        response: json({
          id: `desktop:${jobId}`,
          content: [{ type: "text", text }],
          usage: Object.keys(usage).length ? usage : null,
          provider: DESKTOP_CODEX.id,
          model: typeof result.model === "string" ? result.model : DESKTOP_CODEX.model,
          wallet: desktopWallet(opts.walletBalanceCents),
          desktop_job: { id: jobId, runner_id: result.runner_id || null },
        }),
        fallbackReason: "",
      };
    }
    if (status === "failed" || status === "expired" || status === "fallback_used") {
      fallbackReason = status === "failed"
        ? `desktop_failed:${String(row?.error || "").slice(0, 120) || "unknown"}`
        : `desktop_${status}`;
      break;
    }
  }

  await markDesktopFallback(opts.admin, jobId, fallbackReason).catch(() => {});
  return { response: null, fallbackReason };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "unauthorized" }, 401);

  let body: { action?: string; system?: string; messages?: unknown; max_tokens?: number; stream?: boolean };
  try { body = await req.json(); } catch { return json({ error: "bad_input" }, 400); }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: { user }, error: whoErr } = await admin.auth.getUser(jwt);
  if (whoErr || !user) return json({ error: "unauthorized" }, 401);

  if (body.action === "runner_status") {
    return json(await readDesktopRunnerStatus(admin));
  }

  if (!Array.isArray(body.messages)) return json({ error: "bad_input" }, 400);
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
  const walletBalanceCents = Number(wallet?.balance_cents ?? 0);

  let fallback: Record<string, unknown> | null = null;
  // Phase 1 POC: only the AI Coach chat path calls coachProxyStream
  // (`stream:true`). Structured tasks such as Memory update, weekly reports,
  // plan extraction, and plan-deviation rescue stay on DeepSeek until they are
  // explicitly moved onto the provider router.
  if (body.stream === true) {
    const preference = await readProviderPreference(admin, uid);
    const desktop = await tryDesktopCodex({
      admin,
      uid,
      body,
      walletBalanceCents,
      preference,
    });
    if (desktop.response) return desktop.response;
    if (desktop.fallbackReason && desktop.fallbackReason !== "desktop_schema_unavailable") {
      fallback = {
        from: DESKTOP_CODEX.id,
        to: DEEPSEEK.id,
        reason: desktop.fallbackReason,
      };
    }
  }

  if (walletBalanceCents < MIN_AI_CHARGE_CENTS) return json({ error: "insufficient_balance", fallback }, 402);

  const key = Deno.env.get(DEEPSEEK.keyEnv);
  if (!key) return json({ error: "server_misconfigured", fallback }, 500);

  // Call DeepSeek with the shared key. Failures are NOT charged.
  let upstream: Response;
  try {
    upstream = await fetch(DEEPSEEK.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: DEEPSEEK.model,
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

          const { actualCostCents, chargeCents, billableUsage } = calcChargeCents(usage);
          const upstreamId = typeof finalMessage?.id === "string" ? finalMessage.id : "";
          const requestId = upstreamId ? `ai:${upstreamId}` : `ai:${uid}:${Date.now()}`;
          const { data: balanceAfter, error: debitErr } = await admin.rpc("wallet_debit", {
            p_user_id: uid,
            p_amount_cents: chargeCents,
            p_kind: "ai_charge",
            p_provider: DEEPSEEK.id,
            p_request_id: requestId,
            p_metadata: {
              provider: DEEPSEEK.id,
              model: DEEPSEEK.model,
              usage,
              billable_usage: billableUsage,
              actual_cost_cents: actualCostCents,
              charge_policy: AI_CHARGE_POLICY,
              fallback,
            },
          });
          if (debitErr) {
            const insufficient = String(debitErr.message || "").includes("insufficient_balance");
            finishWithError(insufficient ? "insufficient_balance" : "wallet_debit_failed");
            return;
          }

          streamEvent(controller, {
            type: "wallet",
            provider: DEEPSEEK.id,
            model: DEEPSEEK.model,
            usage,
            fallback,
            wallet: {
              balance_cents: balanceAfter,
              charge_cents: chargeCents,
              actual_cost_cents: actualCostCents,
              charge_policy: AI_CHARGE_POLICY,
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

  const { actualCostCents, chargeCents, billableUsage } = calcChargeCents(data.usage || null);

  const requestId = data.id ? `ai:${data.id}` : `ai:${uid}:${Date.now()}`;
  const { data: balanceAfter, error: debitErr } = await admin.rpc("wallet_debit", {
    p_user_id: uid,
    p_amount_cents: chargeCents,
    p_kind: "ai_charge",
    p_provider: DEEPSEEK.id,
    p_request_id: requestId,
    p_metadata: {
      provider: DEEPSEEK.id,
      model: DEEPSEEK.model,
      usage: data.usage || null,
      billable_usage: billableUsage,
      actual_cost_cents: actualCostCents,
      charge_policy: AI_CHARGE_POLICY,
      fallback,
    },
  });
  if (debitErr) {
    const insufficient = String(debitErr.message || "").includes("insufficient_balance");
    return json({ error: insufficient ? "insufficient_balance" : "wallet_debit_failed" }, insufficient ? 402 : 500);
  }

  return json({
    ...data,
    content: Array.isArray(data.content) ? data.content : [{ type: "text", text: extractText(data) }],
    provider: DEEPSEEK.id,
    model: DEEPSEEK.model,
    fallback,
    wallet: {
      balance_cents: balanceAfter,
      charge_cents: chargeCents,
      actual_cost_cents: actualCostCents,
      charge_policy: AI_CHARGE_POLICY,
      billable_usage: billableUsage,
    },
  });
});
