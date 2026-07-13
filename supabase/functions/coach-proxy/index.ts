// Personal-mode AI coach proxy.
//
// The app owner's DeepSeek key stays in Edge Function secrets. Phase-1
// desktop_codex support never receives Codex credentials: it only writes an
// ai_jobs row. Legacy callers wait briefly; start_async callers receive a job
// id immediately and the runner persists the final chat/report sink. If the
// runner is unavailable, text-only async jobs use DeepSeek against the same
// durable job and sink.
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

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

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
const DESKTOP_RUNNER_FRESH_MS = 12_000;
const DESKTOP_RUNNER_STALE_MS = 8_000;
const DESKTOP_CODEX_ERROR_COOLDOWN_MS = 5 * 60_000;
const DESKTOP_CODEX_AUTH_ERROR_COOLDOWN_MS = 24 * 60 * 60_000;
const DESKTOP_JOB_TTL_MS = 2 * 60_000;
const ASYNC_JOB_TTL_MS = 15 * 60_000;
const DEEPSEEK_ASYNC_TIMEOUT_MS = 2 * 60_000;
const ASYNC_JOB_SOURCE = "coach_proxy_async";
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
  request_id?: string;
  job_id?: string;
  runner_id?: string;
  failure_reason?: string;
  sink?: unknown;
  system?: string;
  messages?: unknown;
  attachments?: unknown;
  max_tokens?: number;
  stream?: boolean;
};

type AsyncSink = {
  type: "coach_message" | "coach_report";
  user_message_id?: string;
  report_id?: string;
  range?: {
    start: string;
    end: string;
    next_start: string | null;
    next_end: string | null;
    range_mode: string;
  };
};

type AsyncJobRow = {
  id: string;
  user_id: string;
  kind: string;
  status: string;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  provider_requested?: string | null;
  provider_actual?: string | null;
  fallback_provider?: string | null;
  fallback_reason?: string | null;
  error?: string | null;
  runner_id?: string | null;
  expires_at?: string | null;
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
  const text = stringValue(value) || stringValue(objectValue(value).message);
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
  const lastErrorAgeMs = ageMsFromIso(metadata.lastCodexErrorAt);
  const codexErrorActive = (codexStatus === "error" || codexStatus === "auth_error")
    && (lastErrorAgeMs === null || lastErrorAgeMs <= codexErrorCooldownMs(codexStatus));
  const state = codexErrorActive ? "error" : runnerState;
  const expectedProvider = state === "online" && preference !== "deepseek_only" ? DESKTOP_CODEX.id : DEEPSEEK.id;

  return {
    provider: DESKTOP_CODEX.id,
    state,
    runner_state: runnerState,
    codex_status: codexErrorActive ? codexStatus : (codexStatus === "ok" ? "ok" : "unknown"),
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

function redactedJobPayload(payload: unknown) {
  const value = objectValue(payload);
  const attachments = Array.isArray(value.attachments) ? value.attachments : [];
  return {
    ...value,
    attachments: attachments.map(item => {
      const attachment = objectValue(item);
      return {
        type: stringValue(attachment.type) || "image",
        name: (stringValue(attachment.name) || "coach-image").slice(0, 100),
        mediaType: stringValue(attachment.mediaType),
        redacted: true,
      };
    }),
  };
}

function uuidValue(value: unknown): string | null {
  const text = stringValue(value);
  return text && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)
    ? text.toLowerCase()
    : null;
}

function dateValue(value: unknown): string | null {
  const text = stringValue(value);
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const parsed = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === text ? text : null;
}

function normalizeAsyncSink(kind: string, value: unknown, jobId?: string): AsyncSink | null {
  const sink = objectValue(value);
  if (kind === "coach_chat") {
    const userMessageId = uuidValue(sink.user_message_id ?? sink.userMessageId);
    return userMessageId ? { type: "coach_message", user_message_id: userMessageId } : null;
  }
  if (kind !== "weekly_report") return null;

  const range = objectValue(sink.range);
  const start = dateValue(range.start ?? range.period_start);
  const end = dateValue(range.end ?? range.period_end);
  const nextStart = dateValue(range.next_start ?? range.nextStart);
  const nextEnd = dateValue(range.next_end ?? range.nextEnd);
  if (!start || !end || start > end || (!!nextStart !== !!nextEnd) || (nextStart && nextEnd && nextStart > nextEnd)) {
    return null;
  }
  const rangeModeValue = stringValue(range.range_mode ?? range.rangeMode) || "this";
  if (rangeModeValue !== "this" && rangeModeValue !== "last") return null;
  const rangeMode = rangeModeValue;
  return {
    type: "coach_report",
    ...(jobId ? { report_id: jobId } : {}),
    range: {
      start,
      end,
      next_start: nextStart,
      next_end: nextEnd,
      range_mode: rangeMode,
    },
  };
}

function appendCoachMeta(text: string, meta: Record<string, unknown>): string {
  return `${text.trim()}\n\n<!-- ultreia-meta:${JSON.stringify(meta)} -->`;
}

function coachUsageMeta(usage: unknown) {
  const normalized = tokenUsage(usage);
  if (normalized.input <= 0 && normalized.output <= 0 && normalized.total <= 0) return null;
  return {
    inputTokens: normalized.input,
    outputTokens: normalized.output,
    totalTokens: normalized.total,
    inputCacheHitTokens: normalized.inputCacheHit,
    inputCacheMissTokens: normalized.inputCacheMiss,
    inputCacheWriteTokens: normalized.inputCacheWrite,
  };
}

function asyncJobPayload(
  body: CoachRequestBody & { attachments?: ImageAttachment[] },
  requestId: string,
  sink: AsyncSink,
) {
  return {
    source: ASYNC_JOB_SOURCE,
    client_request_id: requestId,
    sink,
    system: typeof body.system === "string" ? body.system : "",
    messages: Array.isArray(body.messages) ? body.messages : [],
    attachments: Array.isArray(body.attachments) ? body.attachments : [],
    max_tokens: Number(body.max_tokens || 8000),
    stream: false,
  };
}

function asyncAccepted(job: AsyncJobRow, sink?: AsyncSink): Response {
  const result = objectValue(job.result);
  return json({
    accepted: true,
    job_id: String(job.id || ""),
    status: String(job.status || "queued"),
    provider: stringValue(job.provider_actual) || stringValue(job.provider_requested),
    fallback_provider: stringValue(job.fallback_provider),
    fallback_reason: stringValue(job.fallback_reason),
    error: publicErrorMessage(job.error),
    finalized: !!stringValue(result.finalized_at),
    sink: sink || objectValue(objectValue(job.payload).sink),
  }, 202);
}

async function callDeepSeekOnce(body: CoachRequestBody): Promise<Record<string, unknown>> {
  const key = Deno.env.get(DEEPSEEK.keyEnv);
  if (!key) throw new Error("server_misconfigured");

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
        stream: false,
      }),
      signal: AbortSignal.timeout(DEEPSEEK_ASYNC_TIMEOUT_MS),
    });
  } catch (e) {
    throw new Error(`upstream_failed:${publicErrorMessage(e) || "network_error"}`);
  }

  const data = await upstream.json().catch(() => null);
  if (!upstream.ok || !data) {
    const detail = (data as { error?: { message?: unknown } } | null)?.error?.message;
    throw new Error(`upstream_error:${publicErrorMessage(detail) || upstream.status}`);
  }
  const text = extractText(data).trim();
  if (!text) throw new Error("upstream_empty_response");
  return {
    text,
    usage: objectValue((data as { usage?: unknown }).usage),
    model: DEEPSEEK.model,
    provider: DEEPSEEK.id,
    upstream_id: stringValue((data as { id?: unknown }).id),
    completed_at: new Date().toISOString(),
  };
}

async function markAsyncSinkFailed(admin: any, job: AsyncJobRow, message: string) {
  const sink = objectValue(job.payload?.sink);
  if (sink.type !== "coach_report") return;
  const { error } = await admin
    .from("coach_reports")
    .update({ status: "failed", error: publicErrorMessage(message) || "generation_failed" })
    .eq("id", job.id)
    .eq("user_id", job.user_id)
    .eq("status", "running");
  if (error) throw new Error(`coach_report_fail:${error.message}`);
}

async function finalizeAsyncFailure(admin: any, job: AsyncJobRow, message: string): Promise<AsyncJobRow> {
  const result = objectValue(job.result);
  if (stringValue(result.failure_finalized_at)) return job;
  await markAsyncSinkFailed(admin, job, message);
  const { data, error } = await admin
    .from("ai_jobs")
    .update({
      payload: redactedJobPayload(job.payload),
      result: { ...result, failure_finalized_at: new Date().toISOString() },
    })
    .eq("id", job.id)
    .eq("user_id", job.user_id)
    .contains("payload", { source: ASYNC_JOB_SOURCE })
    .in("status", ["failed", "expired"])
    .select("id,user_id,kind,status,provider_requested,provider_actual,fallback_provider,fallback_reason,payload,result,error,runner_id,expires_at")
    .maybeSingle();
  if (error || !data?.id) throw new Error(`async_failure_marker:${error?.message || "job_not_terminal"}`);
  return data as AsyncJobRow;
}

async function expireAsyncJobIfNeeded(admin: any, job: AsyncJobRow): Promise<AsyncJobRow> {
  const expiresAt = Date.parse(stringValue(job.expires_at) || "");
  if (!["queued", "claimed", "running"].includes(job.status)
    || !Number.isFinite(expiresAt)
    || expiresAt > Date.now()) return job;
  const { data, error } = await admin
    .from("ai_jobs")
    .update({
      status: "expired",
      payload: redactedJobPayload(job.payload),
      error: "async_job_expired",
      fallback_reason: "async_job_expired",
      completed_at: new Date().toISOString(),
    })
    .eq("id", job.id)
    .eq("user_id", job.user_id)
    .in("status", ["queued", "claimed", "running"])
    .select("id,user_id,kind,status,provider_requested,provider_actual,fallback_provider,fallback_reason,payload,result,error,runner_id,expires_at")
    .maybeSingle();
  if (error) throw new Error(`async_expire:${error.message}`);
  return data?.id ? data as AsyncJobRow : job;
}

async function finalizeAsyncSink(admin: any, job: AsyncJobRow): Promise<void> {
  const payload = objectValue(job.payload);
  if (payload.source !== ASYNC_JOB_SOURCE) throw new Error("not_async_job");
  const sink = objectValue(payload.sink);
  const result = objectValue(job.result);
  const text = stringValue(result.text)?.trim();
  if (!text) throw new Error("async_result_text_required");
  const provider = stringValue(result.provider) || stringValue(job.provider_actual) || DESKTOP_CODEX.id;
  const model = stringValue(result.model) || (provider === DEEPSEEK.id ? DEEPSEEK.model : DESKTOP_CODEX.model);
  const usage = objectValue(result.usage);
  const fallback = job.fallback_provider
    ? { from: DESKTOP_CODEX.id, to: job.fallback_provider, reason: job.fallback_reason || "desktop_failed" }
    : null;
  const finalizedAt = new Date().toISOString();

  if (sink.type === "coach_message") {
    const content = appendCoachMeta(text, {
      provider,
      model,
      freeTier: false,
      usage: coachUsageMeta(usage),
      fallback,
      createdAt: stringValue(result.completed_at) || finalizedAt,
      jobId: job.id,
    });
    const { error } = await admin
      .from("coach_messages")
      .upsert({ id: job.id, user_id: job.user_id, role: "assistant", content }, { onConflict: "id" });
    if (error) throw new Error(`coach_message_finalize:${error.message}`);
    return;
  }

  if (sink.type === "coach_report") {
    const { data: current, error: readError } = await admin
      .from("coach_reports")
      .select("metadata")
      .eq("id", job.id)
      .eq("user_id", job.user_id)
      .maybeSingle();
    if (readError || !current) throw new Error(`coach_report_read:${readError?.message || "missing_report"}`);
    const metadata = objectValue(current.metadata);
    const { data, error } = await admin
      .from("coach_reports")
      .update({
        status: "ready",
        body: text,
        error: null,
        wallet_charge_cents: 0,
        model,
        metadata: {
          ...metadata,
          provider,
          fallback,
          usage: Object.keys(usage).length ? usage : null,
          finalized_at: finalizedAt,
        },
      })
      .eq("id", job.id)
      .eq("user_id", job.user_id)
      .eq("status", "running")
      .select("id")
      .maybeSingle();
    if (error) throw new Error(`coach_report_finalize:${error.message}`);
    if (!data?.id) {
      const { data: ready } = await admin
        .from("coach_reports")
        .select("id")
        .eq("id", job.id)
        .eq("user_id", job.user_id)
        .eq("status", "ready")
        .maybeSingle();
      if (!ready?.id) throw new Error("coach_report_not_active");
    }
    return;
  }

  throw new Error("unsupported_async_sink");
}

async function markAsyncFinalized(admin: any, job: AsyncJobRow): Promise<AsyncJobRow> {
  const finalizedAt = new Date().toISOString();
  const result = { ...objectValue(job.result), finalized_at: finalizedAt };
  const { data, error } = await admin
    .from("ai_jobs")
    .update({ result })
    .eq("id", job.id)
    .eq("user_id", job.user_id)
    .in("status", ["completed", "fallback_used"])
    .select("id,user_id,kind,status,payload,result,provider_actual,fallback_provider,fallback_reason,error,runner_id")
    .maybeSingle();
  if (error || !data?.id) throw new Error(`async_finalize_marker:${error?.message || "job_not_terminal"}`);
  return data as AsyncJobRow;
}

async function finalizeAsyncJob(admin: any, job: AsyncJobRow): Promise<AsyncJobRow> {
  if (stringValue(objectValue(job.result).finalized_at)) return job;
  await finalizeAsyncSink(admin, job);
  return await markAsyncFinalized(admin, job);
}

async function findAsyncJob(admin: any, uid: string, kind: string, requestId: string): Promise<AsyncJobRow | null> {
  const { data, error } = await admin
    .from("ai_jobs")
    .select("id,user_id,kind,status,provider_requested,provider_actual,fallback_provider,fallback_reason,payload,result,error,runner_id,expires_at")
    .eq("user_id", uid)
    .eq("kind", kind)
    .contains("payload", { source: ASYNC_JOB_SOURCE, client_request_id: requestId })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`async_job_lookup:${error.message}`);
  return data?.id ? data as AsyncJobRow : null;
}

async function readAsyncJobById(admin: any, uid: string, jobId: string): Promise<AsyncJobRow | null> {
  const { data, error } = await admin
    .from("ai_jobs")
    .select("id,user_id,kind,status,provider_requested,provider_actual,fallback_provider,fallback_reason,payload,result,error,runner_id,expires_at")
    .eq("id", jobId)
    .eq("user_id", uid)
    .maybeSingle();
  if (error) throw new Error(`async_job_read:${error.message}`);
  if (!data?.id || objectValue(data.payload).source !== ASYNC_JOB_SOURCE) return null;
  return data as AsyncJobRow;
}

async function handleAsyncStatus(admin: any, uid: string, body: CoachRequestBody): Promise<Response> {
  const jobId = uuidValue(body.job_id);
  if (!jobId) return json({ error: "bad_job_id" }, 400);
  let job: AsyncJobRow | null;
  try { job = await readAsyncJobById(admin, uid, jobId); } catch (e) {
    return json({ error: publicErrorMessage(e) || "async_job_read_failed" }, 500);
  }
  if (!job) return json({ error: "async_job_not_found" }, 404);
  try { job = await expireAsyncJobIfNeeded(admin, job); } catch { /* A later poll or runner reconciliation can retry. */ }
  if (["completed", "fallback_used"].includes(job.status)
    && stringValue(objectValue(job.result).text)
    && !stringValue(objectValue(job.result).finalized_at)) {
    try { job = await finalizeAsyncJob(admin, job); } catch { /* Runner reconciliation remains the fallback. */ }
  } else if (["failed", "expired"].includes(job.status)
    && !stringValue(objectValue(job.result).failure_finalized_at)) {
    try { job = await finalizeAsyncFailure(admin, job, job.error || job.status); } catch { /* A later poll can retry. */ }
  }
  return asyncAccepted(job, objectValue(job.payload).sink as AsyncSink);
}

async function handleCancelAsync(admin: any, uid: string, body: CoachRequestBody): Promise<Response> {
  const jobId = uuidValue(body.job_id);
  if (!jobId) return json({ error: "bad_job_id" }, 400);
  let job: AsyncJobRow | null;
  try { job = await readAsyncJobById(admin, uid, jobId); } catch (e) {
    return json({ error: publicErrorMessage(e) || "async_job_read_failed" }, 500);
  }
  if (!job) return json({ error: "async_job_not_found" }, 404);
  if (["queued", "claimed", "running"].includes(job.status)) {
    const { data, error } = await admin
      .from("ai_jobs")
      .update({
        status: "expired",
        payload: redactedJobPayload(job.payload),
        error: "user_cancelled",
        fallback_reason: "user_cancelled",
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .eq("user_id", uid)
      .in("status", ["queued", "claimed", "running"])
      .select("id,user_id,kind,status,provider_requested,provider_actual,fallback_provider,fallback_reason,payload,result,error,runner_id,expires_at")
      .maybeSingle();
    if (error) return json({ error: "async_cancel_failed" }, 500);
    if (data?.id) job = data as AsyncJobRow;
  }
  if (job.status === "expired" && job.error === "user_cancelled") {
    job = await finalizeAsyncFailure(admin, job, "user_cancelled").catch(() => job);
  }
  return asyncAccepted(job, objectValue(job.payload).sink as AsyncSink);
}

async function completeDeepSeekAsyncJob(
  admin: any,
  job: AsyncJobRow,
  body: CoachRequestBody,
  terminalStatus: "completed" | "fallback_used",
): Promise<void> {
  let result: Record<string, unknown>;
  try {
    result = await callDeepSeekOnce(body);
  } catch (e) {
    const message = publicErrorMessage(e) || "deepseek_failed";
    const { data, error } = await admin
      .from("ai_jobs")
      .update({
        status: "failed",
        provider_actual: DEEPSEEK.id,
        payload: redactedJobPayload(job.payload),
        error: message,
        completed_at: new Date().toISOString(),
      })
      .eq("id", job.id)
      .eq("user_id", job.user_id)
      .eq("status", "queued")
      .select("id,user_id,kind,status,provider_requested,provider_actual,fallback_provider,fallback_reason,payload,result,error,runner_id,expires_at")
      .maybeSingle();
    if (error) {
      console.error("async DeepSeek failure update failed", job.id, publicErrorMessage(error.message));
      return;
    }
    if (data?.id) await finalizeAsyncFailure(admin, data as AsyncJobRow, message).catch(() => {});
    return;
  }

  const { data, error } = await admin
    .from("ai_jobs")
    .update({
      status: terminalStatus,
      provider_actual: DEEPSEEK.id,
      payload: redactedJobPayload(job.payload),
      result,
      error: null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", job.id)
    .eq("user_id", job.user_id)
    .eq("status", "queued")
    .select("id,user_id,kind,status,provider_requested,provider_actual,fallback_provider,fallback_reason,payload,result,error,runner_id,expires_at")
    .maybeSingle();
  if (error) {
    console.error("async DeepSeek completion update failed", job.id, publicErrorMessage(error.message));
    return;
  }
  if (data?.id) {
    await finalizeAsyncJob(admin, data as AsyncJobRow)
      .catch(e => console.error("async DeepSeek sink finalize deferred", job.id, publicErrorMessage(e)));
  }
}

async function handleStartAsync(
  admin: any,
  uid: string,
  body: CoachRequestBody & { attachments?: ImageAttachment[] },
): Promise<Response> {
  const requestId = uuidValue(body.request_id);
  const kind = stringValue(body.kind);
  if (!requestId || (kind !== "coach_chat" && kind !== "weekly_report") || !Array.isArray(body.messages)) {
    return json({ error: "bad_async_input" }, 400);
  }
  const preliminarySink = normalizeAsyncSink(kind, body.sink);
  if (!preliminarySink) return json({ error: "bad_async_sink" }, 400);

  if (kind === "coach_chat") {
    const { data, error } = await admin
      .from("coach_messages")
      .select("id")
      .eq("id", preliminarySink.user_message_id)
      .eq("user_id", uid)
      .eq("role", "user")
      .maybeSingle();
    if (error) return json({ error: "async_sink_check_failed" }, 500);
    if (!data?.id) return json({ error: "async_sink_forbidden" }, 403);
  }

  let existing: AsyncJobRow | null;
  try {
    existing = await findAsyncJob(admin, uid, kind, requestId);
  } catch (e) {
    return json({ error: publicErrorMessage(e) || "async_job_lookup_failed" }, 500);
  }
  if (existing) {
    if (["completed", "fallback_used"].includes(existing.status)
      && stringValue(objectValue(existing.result).text)
      && !stringValue(objectValue(existing.result).finalized_at)) {
      try { existing = await finalizeAsyncJob(admin, existing); } catch { /* Reconciler or a later retry will finish it. */ }
    }
    return asyncAccepted(existing, objectValue(existing.payload).sink as AsyncSink);
  }

  // The client request id is also the database primary key, so concurrent or
  // retried submissions cannot create duplicate durable jobs.
  const jobId = requestId;
  const sink = normalizeAsyncSink(kind, body.sink, jobId)!;
  const preference = await readProviderPreference(admin, uid);
  const attachments = Array.isArray(body.attachments) ? body.attachments : [];
  const runner = preference === "deepseek_only"
    ? { ok: false as const, reason: "deepseek_only" }
    : await hasFreshDesktopRunner(admin, attachments.length > 0);
  const useDesktop = runner.ok;
  const fallbackReason = useDesktop ? null : runner.reason;
  const payload = asyncJobPayload(body, requestId, sink);

  if (kind === "weekly_report") {
    const range = sink.range!;
    const { error } = await admin.from("coach_reports").insert({
      id: jobId,
      user_id: uid,
      period_start: range.start,
      period_end: range.end,
      next_start: range.next_start,
      next_end: range.next_end,
      range_mode: range.range_mode,
      source: "manual",
      status: "running",
      title: "AI 周复盘",
      body: "",
      model: useDesktop ? DESKTOP_CODEX.model : DEEPSEEK.model,
      metadata: { trigger: "manual_async", job_id: jobId, client_request_id: requestId },
    });
    if (error && error.code !== "23505") {
      return json({ error: "coach_report_create_failed", detail: publicErrorMessage(error.message) }, 500);
    }
  }

  const { data: inserted, error: jobError } = await admin
    .from("ai_jobs")
    .insert({
      id: jobId,
      user_id: uid,
      kind,
      status: "queued",
      provider_requested: useDesktop ? DESKTOP_CODEX.id : DEEPSEEK.id,
      target_runner_id: useDesktop ? runner.runnerId : null,
      fallback_provider: !useDesktop && preference !== "deepseek_only" ? DEEPSEEK.id : null,
      fallback_reason: !useDesktop && preference !== "deepseek_only" ? fallbackReason : null,
      payload,
      expires_at: new Date(Date.now() + ASYNC_JOB_TTL_MS).toISOString(),
    })
    .select("id,user_id,kind,status,provider_requested,provider_actual,fallback_provider,fallback_reason,payload,result,error,runner_id,expires_at")
    .single();
  if (jobError || !inserted?.id) {
    if (jobError?.code === "23505") {
      const current = await findAsyncJob(admin, uid, kind, requestId).catch(() => null);
      if (current) return asyncAccepted(current, objectValue(current.payload).sink as AsyncSink);
    }
    if (kind === "weekly_report") {
      await admin.from("coach_reports").update({ status: "failed", error: "async_job_create_failed" }).eq("id", jobId);
    }
    return json({ error: "async_job_create_failed", detail: publicErrorMessage(jobError?.message) }, 500);
  }
  let job = inserted as AsyncJobRow;

  if (useDesktop) return asyncAccepted(job, sink);
  if (attachments.length) {
    const reason = fallbackReason || "image_requires_codex";
    const { data } = await admin
      .from("ai_jobs")
      .update({
        status: "failed",
        payload: redactedJobPayload(job.payload),
        error: reason,
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .eq("status", "queued")
      .select("id,user_id,kind,status,payload,result,provider_actual,fallback_provider,fallback_reason,error,runner_id,expires_at")
      .maybeSingle();
    if (data?.id) job = data as AsyncJobRow;
    job = await finalizeAsyncFailure(admin, job, reason).catch(() => job);
    return asyncAccepted(job, sink);
  }

  const terminalStatus = preference === "deepseek_only" ? "completed" : "fallback_used";
  EdgeRuntime.waitUntil(completeDeepSeekAsyncJob(admin, job, body, terminalStatus));
  return asyncAccepted(job, sink);
}

async function handleRunnerDeepSeekFallback(admin: any, body: CoachRequestBody): Promise<Response> {
  const jobId = uuidValue(body.job_id);
  const runnerId = stringValue(body.runner_id);
  if (!jobId || !runnerId) return json({ error: "bad_runner_fallback_input" }, 400);
  const { data, error } = await admin
    .from("ai_jobs")
    .select("id,user_id,kind,status,payload,result,provider_actual,fallback_provider,fallback_reason,error,runner_id")
    .eq("id", jobId)
    .eq("runner_id", runnerId)
    .in("status", ["claimed", "running"])
    .maybeSingle();
  if (error) return json({ error: "runner_fallback_job_read_failed" }, 500);
  if (!data?.id) return json({ error: "runner_fallback_job_not_active" }, 409);
  const payload = objectValue(data.payload);
  if (payload.source !== ASYNC_JOB_SOURCE || !Array.isArray(payload.messages)) {
    return json({ error: "runner_fallback_not_allowed" }, 403);
  }
  if (Array.isArray(payload.attachments) && payload.attachments.length) {
    return json({ error: "image_requires_codex" }, 409);
  }
  try {
    const result = await callDeepSeekOnce({
      system: stringValue(payload.system) || "",
      messages: payload.messages,
      max_tokens: Number(payload.max_tokens || 8000),
    });
    return json({
      result,
      fallback: {
        from: DESKTOP_CODEX.id,
        to: DEEPSEEK.id,
        reason: publicErrorMessage(body.failure_reason) || "desktop_failed",
      },
    });
  } catch (e) {
    return json({ error: publicErrorMessage(e) || "runner_deepseek_fallback_failed" }, 502);
  }
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
  const redactedPayload = redactedJobPayload(queuedPayload);
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

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceRoleKey);
  if (body.action === "runner_deepseek_fallback") {
    if (jwt !== serviceRoleKey) return json({ error: "unauthorized" }, 401);
    return await handleRunnerDeepSeekFallback(admin, body);
  }

  const { data: { user }, error: whoErr } = await admin.auth.getUser(jwt);
  if (whoErr || !user) return json({ error: "unauthorized" }, 401);
  const uid = user.id;

  if (body.action === "runner_status") {
    return json(await readDesktopRunnerStatus(admin, uid));
  }
  if (body.action === "job_status") {
    return await handleAsyncStatus(admin, uid, body);
  }
  if (body.action === "cancel_async") {
    return await handleCancelAsync(admin, uid, body);
  }

  if (!Array.isArray(body.messages)) return json({ error: "bad_input" }, 400);

  let imageAttachments: ImageAttachment[] = [];
  try {
    imageAttachments = normalizeImageAttachments(body.attachments);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 400);
  }
  const bodyForDesktop = { ...body, attachments: imageAttachments };

  if (body.action === "start_async") {
    return await handleStartAsync(admin, uid, bodyForDesktop);
  }

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
