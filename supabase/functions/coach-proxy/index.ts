// Personal-mode AI coach proxy.
//
// The app owner's DeepSeek key stays in Edge Function secrets. Phase-1
// desktop_codex support never receives Codex credentials: it only writes an
// ai_jobs row and waits briefly for a local desktop runner to write back text.
// If the runner is offline/missing/slow, this function falls back to DeepSeek.
// AI calls do not check wallet balance or debit wallet records in personal mode.
//
// Auth: caller must be logged in (verify JWT can stay ON). Deploy:
//   npx supabase functions deploy coach-proxy
//
// Secrets: SHARED_DEEPSEEK_KEY (set in Dashboard → Edge Functions → Secrets).
// Optional tuning: DESKTOP_CODEX_WAIT_MS, DESKTOP_CODEX_CHAT_WAIT_MS,
// DESKTOP_CODEX_TASK_WAIT_MS, DESKTOP_CODEX_WEEKLY_WAIT_MS,
// DESKTOP_CODEX_PREFER_WAIT_MS.
// Auto-injected: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "npm:@supabase/supabase-js@2";

const DEEPSEEK = {
  id: "deepseek",
  url: "https://api.deepseek.com/anthropic/v1/messages",
  model: "deepseek-v4-pro",
  keyEnv: "SHARED_DEEPSEEK_KEY",
} as const;
const AI_CHARGE_POLICY = "personal_mode_no_wallet_debit";
const DESKTOP_CODEX = {
  id: "desktop_codex",
  model: "codex-cli",
} as const;
const DESKTOP_RUNNER_FRESH_MS = 20_000;
const DESKTOP_RUNNER_STALE_MS = 10_000;
const DESKTOP_CODEX_ERROR_COOLDOWN_MS = 5 * 60_000;
const DESKTOP_CODEX_AUTH_ERROR_COOLDOWN_MS = 24 * 60 * 60_000;
const DESKTOP_JOB_TTL_MS = 2 * 60_000;
const DESKTOP_POLL_MS = 1000;
const IMAGE_INPUT_CAPABILITY_KEYS = ["supportsImageInput", "imageInput"];
const AI_JOB_KINDS = new Set([
  "coach_chat",
  "weekly_report",
  "memory_update",
  "plan_extract",
  "plan_deviation_rescue",
  "daily_checkin",
]);
const MAX_IMAGE_ATTACHMENTS = 3;
const MAX_IMAGE_DATA_URL_CHARS = 2_500_000;

type ImageAttachment = {
  type: "image";
  name: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp";
  dataUrl: string;
};

type CoachRequestBody = {
  action?: string;
  kind?: string;
  system?: string;
  messages?: unknown;
  attachments?: unknown;
  max_tokens?: number;
  stream?: boolean;
};

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

function normalizeImageAttachments(value: unknown): ImageAttachment[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error("bad_image_attachments");
  if (value.length > MAX_IMAGE_ATTACHMENTS) throw new Error("too_many_image_attachments");

  return value.map((item, index) => {
    const obj = objectValue(item);
    if (obj.type !== "image") throw new Error("bad_image_attachment_type");
    const dataUrl = stringValue(obj.dataUrl);
    if (!dataUrl) throw new Error("bad_image_attachment");
    if (dataUrl.length > MAX_IMAGE_DATA_URL_CHARS) throw new Error("image_attachment_too_large");
    const match = dataUrl.match(/^data:(image\/(?:png|jpe?g|webp));base64,[A-Za-z0-9+/=]+$/);
    if (!match) throw new Error("bad_image_data_url");
    const normalizedMediaType = match[1] === "image/jpg" ? "image/jpeg" : match[1];
    if (normalizedMediaType !== "image/png" && normalizedMediaType !== "image/jpeg" && normalizedMediaType !== "image/webp") {
      throw new Error("unsupported_image_type");
    }
    const mediaType = normalizedMediaType as ImageAttachment["mediaType"];
    const declaredMediaType = stringValue(obj.mediaType);
    if (declaredMediaType && declaredMediaType !== mediaType && !(declaredMediaType === "image/jpg" && mediaType === "image/jpeg")) {
      throw new Error("image_media_type_mismatch");
    }
    return {
      type: "image" as const,
      name: (stringValue(obj.name) || `coach-image-${index + 1}.jpg`).slice(0, 100),
      mediaType,
      dataUrl,
    };
  });
}

function publicErrorMessage(value: unknown): string | null {
  const text = stringValue(value);
  if (!text) return null;
  return text.replace(/sk-[A-Za-z0-9_.*-]+/g, "[redacted]").slice(0, 240);
}

function ageMsFromIso(value: unknown): number | null {
  const text = stringValue(value);
  if (!text) return null;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? Math.max(0, Date.now() - ms) : null;
}

function runnerHeartbeatState(status: string, ageMs: number | null): "online" | "stale" | "offline" {
  if (status === "online" && ageMs !== null && ageMs <= DESKTOP_RUNNER_FRESH_MS) return "online";
  if (status === "online" && ageMs !== null && ageMs <= DESKTOP_RUNNER_FRESH_MS + DESKTOP_RUNNER_STALE_MS) return "stale";
  return "offline";
}

function codexStatusValue(value: unknown): "ok" | "error" | "auth_error" | "unknown" {
  const status = stringValue(value);
  if (status === "ok" || status === "error" || status === "auth_error") return status;
  return "unknown";
}

function codexErrorCooldownMs(status: string): number {
  return status === "auth_error" ? DESKTOP_CODEX_AUTH_ERROR_COOLDOWN_MS : DESKTOP_CODEX_ERROR_COOLDOWN_MS;
}

function runnerSupportsImageInput(metadata: Record<string, unknown>): boolean {
  if (IMAGE_INPUT_CAPABILITY_KEYS.some(key => metadata[key] === true)) return true;
  const capabilities = objectValue(metadata.capabilities);
  return capabilities.image_input === true || capabilities.imageInput === true;
}

function aiJobKind(value: unknown): string {
  const text = stringValue(value);
  return text && AI_JOB_KINDS.has(text) ? text : "coach_chat";
}

function noWalletCharge(usage: unknown = null) {
  return {
    balance_cents: null,
    charge_cents: 0,
    actual_cost_cents: 0,
    charge_policy: AI_CHARGE_POLICY,
    billable_usage: tokenUsage(usage),
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

async function hasFreshDesktopRunner(admin: any, requiresImageInput = false): Promise<{ ok: true; runnerId: string } | { ok: false; reason: string }> {
  const cutoff = new Date(Date.now() - DESKTOP_RUNNER_FRESH_MS).toISOString();
  const { data, error } = await admin
    .from("ai_runners")
    .select("id, last_seen_at, metadata")
    .eq("provider", DESKTOP_CODEX.id)
    .eq("status", "online")
    .gte("last_seen_at", cutoff)
    .order("last_seen_at", { ascending: false })
    .limit(5);
  if (error) return { ok: false, reason: "desktop_schema_unavailable" };
  if (!Array.isArray(data) || !data.length) return { ok: false, reason: "desktop_runner_offline" };
  const imageUnsupported = requiresImageInput && data.some(row => !runnerSupportsImageInput(objectValue(row.metadata)));
  if (imageUnsupported) return { ok: false, reason: "desktop_runner_image_input_unsupported" };
  const available = data.find(row => {
    const metadata = objectValue(row.metadata);
    const lastCodexStatus = codexStatusValue(metadata.lastCodexStatus);
    const lastErrorAgeMs = ageMsFromIso(metadata.lastCodexErrorAt);
    return !((lastCodexStatus === "error" || lastCodexStatus === "auth_error")
      && (lastErrorAgeMs === null || lastErrorAgeMs <= codexErrorCooldownMs(lastCodexStatus)));
  });
  if (!available?.id) {
    const latestMetadata = objectValue(data[0]?.metadata);
    const latestStatus = codexStatusValue(latestMetadata.lastCodexStatus);
    return { ok: false, reason: latestStatus === "auth_error" ? "desktop_codex_auth_error" : "desktop_codex_unhealthy" };
  }
  const metadata = objectValue(available.metadata);
  const lastCodexStatus = codexStatusValue(metadata.lastCodexStatus);
  const lastErrorAgeMs = ageMsFromIso(metadata.lastCodexErrorAt);
  if ((lastCodexStatus === "error" || lastCodexStatus === "auth_error")
    && (lastErrorAgeMs === null || lastErrorAgeMs <= codexErrorCooldownMs(lastCodexStatus))) {
    return { ok: false, reason: lastCodexStatus === "auth_error" ? "desktop_codex_auth_error" : "desktop_codex_unhealthy" };
  }
  return { ok: true, runnerId: String(available.id) };
}

async function readDesktopRunnerStatus(admin: any, uid: string) {
  const checkedAt = new Date().toISOString();
  const preference = await readProviderPreference(admin, uid);
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
      preference,
      expected_provider: DEEPSEEK.id,
      fresh_ms: DESKTOP_RUNNER_FRESH_MS,
      stale_ms: DESKTOP_RUNNER_STALE_MS,
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
      preference,
      expected_provider: DEEPSEEK.id,
      fresh_ms: DESKTOP_RUNNER_FRESH_MS,
      stale_ms: DESKTOP_RUNNER_STALE_MS,
      checked_at: checkedAt,
    };
  }

  const metadata = objectValue(data.metadata);
  const status = String(data.status || "offline");
  const ageMs = ageMsFromIso(data.last_seen_at);
  const runnerState = runnerHeartbeatState(status, ageMs);
  const codexStatus = codexStatusValue(metadata.lastCodexStatus);
  const state = codexStatus === "error" || codexStatus === "auth_error" ? "error" : runnerState;
  const expectedProvider = state === "online" && preference !== "deepseek_only" ? DESKTOP_CODEX.id : DEEPSEEK.id;

  return {
    provider: DESKTOP_CODEX.id,
    state,
    runner_state: runnerState,
    codex_status: codexStatus,
    preference,
    expected_provider: expectedProvider,
    runner_id: String(data.id),
    status,
    last_seen_at: stringValue(data.last_seen_at),
    age_ms: ageMs,
    fresh_ms: DESKTOP_RUNNER_FRESH_MS,
    stale_ms: DESKTOP_RUNNER_STALE_MS,
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

function desktopJobPayload(body: CoachRequestBody & { attachments?: ImageAttachment[] }) {
  const attachments = Array.isArray(body.attachments) ? body.attachments : [];
  return {
    source: "coach_proxy",
    system: typeof body.system === "string" ? body.system : "",
    messages: Array.isArray(body.messages) ? body.messages : [],
    attachments,
    max_tokens: Number(body.max_tokens || 8000),
    stream: body.stream === true,
  };
}

function redactedDesktopJobPayload(payload: ReturnType<typeof desktopJobPayload>) {
  return {
    ...payload,
    attachments: payload.attachments.map(attachment => ({
      type: attachment.type,
      name: attachment.name,
      mediaType: attachment.mediaType,
      redacted: true,
    })),
  };
}

async function markDesktopFallback(admin: any, jobId: string, reason: string, fallbackProvider: string | null = DEEPSEEK.id, redactedPayload?: unknown) {
  await admin
    .from("ai_jobs")
    .update({
      status: "fallback_used",
      fallback_provider: fallbackProvider,
      fallback_reason: reason,
    })
    .eq("id", jobId)
    .in("status", ["queued", "claimed", "running"]);
  if (redactedPayload) {
    await scrubDesktopJobPayload(admin, jobId, redactedPayload);
  }
}

async function scrubDesktopJobPayload(admin: any, jobId: string, redactedPayload: unknown) {
  await admin
    .from("ai_jobs")
    .update({ payload: redactedPayload })
    .eq("id", jobId);
}

function desktopWaitMs(kind: string, stream: boolean, preference: "auto" | "prefer_codex" | "deepseek_only"): number {
  if (preference === "prefer_codex") return numberEnv("DESKTOP_CODEX_PREFER_WAIT_MS", 90_000);
  if (kind === "coach_chat") return numberEnv("DESKTOP_CODEX_CHAT_WAIT_MS", 60_000);
  if (stream) return numberEnv("DESKTOP_CODEX_WAIT_MS", 35_000);
  if (kind === "weekly_report") return numberEnv("DESKTOP_CODEX_WEEKLY_WAIT_MS", 135_000);
  return numberEnv("DESKTOP_CODEX_TASK_WAIT_MS", 90_000);
}

async function tryDesktopCodex(opts: {
  admin: any;
  uid: string;
  body: CoachRequestBody & { attachments?: ImageAttachment[] };
  kind: string;
  preference: "auto" | "prefer_codex" | "deepseek_only";
  requiresDesktop?: boolean;
}): Promise<{ response: Response | null; fallbackReason: string }> {
  if (opts.preference === "deepseek_only" && !opts.requiresDesktop) {
    return { response: null, fallbackReason: "" };
  }

  const runner = await hasFreshDesktopRunner(opts.admin, opts.requiresDesktop === true);
  if (!runner.ok) return { response: null, fallbackReason: runner.reason };

  const waitPreference = opts.requiresDesktop ? "prefer_codex" : opts.preference;
  const waitMs = desktopWaitMs(opts.kind, opts.body.stream === true, waitPreference);
  const expiresAt = new Date(Date.now() + Math.max(waitMs + 15_000, DESKTOP_JOB_TTL_MS)).toISOString();
  const queuedPayload = desktopJobPayload(opts.body);
  const redactedPayload = redactedDesktopJobPayload(queuedPayload);
  const { data: job, error: jobErr } = await opts.admin
    .from("ai_jobs")
    .insert({
      user_id: opts.uid,
      kind: opts.kind,
      status: "queued",
      provider_requested: DESKTOP_CODEX.id,
      payload: queuedPayload,
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
      await scrubDesktopJobPayload(opts.admin, jobId, redactedPayload).catch(() => {});
      return {
        response: json({
          id: `desktop:${jobId}`,
          content: [{ type: "text", text }],
          usage: Object.keys(usage).length ? usage : null,
          provider: DESKTOP_CODEX.id,
          model: typeof result.model === "string" ? result.model : DESKTOP_CODEX.model,
          wallet: noWalletCharge(usage),
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

  await markDesktopFallback(opts.admin, jobId, fallbackReason, opts.requiresDesktop ? null : DEEPSEEK.id, redactedPayload).catch(() => {});
  return { response: null, fallbackReason };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "unauthorized" }, 401);

  let body: CoachRequestBody;
  try { body = await req.json(); } catch { return json({ error: "bad_input" }, 400); }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: { user }, error: whoErr } = await admin.auth.getUser(jwt);
  if (whoErr || !user) return json({ error: "unauthorized" }, 401);
  const uid = user.id;

  if (body.action === "runner_status") {
    return json(await readDesktopRunnerStatus(admin, uid));
  }

  if (!Array.isArray(body.messages)) return json({ error: "bad_input" }, 400);

  let imageAttachments: ImageAttachment[] = [];
  try {
    imageAttachments = normalizeImageAttachments(body.attachments);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 400);
  }
  const bodyForDesktop = { ...body, attachments: imageAttachments };

  let fallback: Record<string, unknown> | null = null;
  const kind = aiJobKind(body.kind);
  const preference = await readProviderPreference(admin, uid);
  const desktop = await tryDesktopCodex({
    admin,
    uid,
    body: bodyForDesktop,
    kind,
    preference,
    requiresDesktop: imageAttachments.length > 0,
  });
  if (desktop.response) return desktop.response;
  if (imageAttachments.length) {
    return json({
      error: "image_requires_codex",
      fallback: {
        from: DESKTOP_CODEX.id,
        to: null,
        reason: desktop.fallbackReason || "desktop_codex_unavailable",
      },
    }, 503);
  }
  if (desktop.fallbackReason && desktop.fallbackReason !== "desktop_schema_unavailable") {
    fallback = {
      from: DESKTOP_CODEX.id,
      to: DEEPSEEK.id,
      reason: desktop.fallbackReason,
    };
  }

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
                // Finalize after the upstream stream closes so the metadata event
                // is the last data frame the client needs to read.
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

          streamEvent(controller, {
            type: "wallet",
            provider: DEEPSEEK.id,
            model: DEEPSEEK.model,
            usage: usage || null,
            fallback,
            wallet: noWalletCharge(usage),
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

  return json({
    ...data,
    content: Array.isArray(data.content) ? data.content : [{ type: "text", text: extractText(data) }],
    provider: DEEPSEEK.id,
    model: DEEPSEEK.model,
    fallback,
    wallet: noWalletCharge(data.usage || null),
  });
});
