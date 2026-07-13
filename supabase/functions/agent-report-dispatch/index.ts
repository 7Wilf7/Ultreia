import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  REPORT_TYPE, SIGNAL_KIND, buildReportEnvelope, buildTrainingStateCandidate,
  canonicalJson, classifyIngressResult, decideCandidateAction, sha256Hex,
} from "../../../src/utils/agentReport.js";

const FUNCTION_PATH = "/functions/v1/aevum-agent-report-ingress";
const WORKOUT_COLUMNS = "id,date,type,sub_types,distance,duration,ascent,started_at,is_planned,plan_status,plan_detail,updated_at";
const UNOBSERVED_FINGERPRINT = "0".repeat(64);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function compactError(value: unknown) {
  return canonicalJson(value).slice(0, 256);
}

function localClock(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  return {
    hour: Number(parts.find(part => part.type === "hour")?.value),
    minute: Number(parts.find(part => part.type === "minute")?.value),
  };
}

async function hmac(secret: string, message: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function sendEnvelope(envelope: Record<string, unknown>, secret: string, ingressUrl: string) {
  const rawBody = canonicalJson(envelope);
  const timestamp = Math.floor(Date.now() / 1000);
  const rawBodyHash = await sha256Hex(rawBody);
  const signature = await hmac(secret, ["POST", FUNCTION_PATH, "ultreia", timestamp, rawBodyHash].join("\n"));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(ingressUrl, {
      method: "POST", body: rawBody, signal: controller.signal,
      headers: {
        "content-type": "application/json", "x-aevum-source": "ultreia",
        "x-aevum-timestamp": String(timestamp), "x-aevum-signature": signature,
      },
    });
    let receipt = null;
    try { receipt = await response.json(); } catch { /* contract error is recorded below */ }
    return { status: response.status, receipt };
  } catch (error) {
    return { status: 0, receipt: null, error: String(error) };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async req => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) return json({ error: "unauthorized" }, 401);
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const userId = Deno.env.get("AEVUM_ULTREIA_USER_ID") || "";
  const hmacSecret = Deno.env.get("AEVUM_ULTREIA_REPORT_HMAC_SECRET") || "";
  if (!supabaseUrl || !serviceKey || !userId || !hmacSecret) return json({ error: "reporter_not_configured" }, 503);
  const ingressUrl = `${supabaseUrl}${FUNCTION_PATH}`;
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const now = new Date();
  let body: { force?: boolean } = {};
  try { body = await req.json(); } catch { /* cron may send an empty body */ }

  const { data: settings, error: settingsError } = await db.from("user_settings")
    .select("push_timezone").eq("user_id", userId).maybeSingle();
  if (settingsError || !settings?.push_timezone) return json({ error: "target_user_not_configured" }, 503);
  const timeZone = settings.push_timezone;
  const clock = localClock(now, timeZone);
  let candidateWindow = body.force === true || (clock.hour === 0 && clock.minute >= 30 && clock.minute < 60);

  const { error: seedError } = await db.from("agent_report_outbox").upsert({
    user_id: userId, report_type: REPORT_TYPE, signal_kind: SIGNAL_KIND,
    observed_source_fingerprint: UNOBSERVED_FINGERPRINT, status: "idle",
  }, { onConflict: "user_id,report_type,signal_kind", ignoreDuplicates: true });
  if (seedError) return json({ error: "outbox_seed_failed", detail: seedError.message }, 500);
  const { data: outbox, error: outboxError } = await db.from("agent_report_outbox")
    .select("*").eq("user_id", userId).eq("report_type", REPORT_TYPE)
    .eq("signal_kind", SIGNAL_KIND).single();
  if (outboxError) return json({ error: "outbox_read_failed", detail: outboxError.message }, 500);
  // One fail-closed rollout canary is allowed for a brand-new watermark. Once
  // observed, ordinary candidate generation returns to the local 00:30 slot.
  if (outbox.observed_source_fingerprint === UNOBSERVED_FINGERPRINT) candidateWindow = true;
  const leaseToken = crypto.randomUUID();
  const leaseUntil = new Date(now.getTime() + 2 * 60 * 1000).toISOString();
  let leaseAcquired = false;
  try {
    const retryDue = outbox.pending_envelope
      && ["pending", "retry_wait"].includes(outbox.status)
      && (!outbox.next_attempt_at || Date.parse(outbox.next_attempt_at) <= now.getTime());
    if (!candidateWindow && !retryDue) return json({ skipped: "outside_candidate_window" });

    const { data: rows, error: workoutError } = await db.from("workouts").select(WORKOUT_COLUMNS)
      .eq("user_id", userId).gte("date", new Date(now.getTime() - 16 * 86400000).toISOString().slice(0, 10))
      .lte("date", new Date(now.getTime() + 86400000).toISOString().slice(0, 10));
    if (workoutError) return json({ error: "workout_read_failed", detail: workoutError.message }, 500);
    const candidate = await buildTrainingStateCandidate(rows || [], { now, timeZone });
    const decision = decideCandidateAction(outbox, candidate);

    let envelope = outbox.pending_envelope;
    let current = outbox;
    if (candidateWindow || (retryDue && candidate.sourceFingerprint !== outbox.observed_source_fingerprint)) {
      if (decision !== "persist_pending") {
        const { error } = await db.from("agent_report_outbox").update({
          observed_source_fingerprint: candidate.sourceFingerprint,
          status: outbox.pending_envelope ? outbox.status : "idle",
        }).eq("id", outbox.id);
        if (error) return json({ error: "watermark_write_failed", detail: error.message }, 500);
        if (!retryDue || decision !== "source_unchanged") return json({ skipped: decision, counts: candidate.source.counts });
      } else {
        envelope = await buildReportEnvelope(candidate, { reportedAt: now });
        const { data, error } = await db.from("agent_report_outbox").update({
          observed_source_fingerprint: candidate.sourceFingerprint,
          pending_envelope: envelope,
          pending_report_id: envelope.id,
          pending_content_hash: candidate.contentHash,
          pending_created_at: now.toISOString(),
          status: "pending", attempt_count: 0, next_attempt_at: null,
          last_error: null, paused_until: null,
          lease_token: leaseToken, lease_expires_at: leaseUntil,
        }).eq("id", outbox.id)
          .or(`lease_expires_at.is.null,lease_expires_at.lt.${now.toISOString()}`)
          .select("*").maybeSingle();
        if (error) return json({ error: "pending_persist_failed", detail: error.message }, 500);
        if (!data) return json({ skipped: "concurrent_claim" });
        leaseAcquired = true;
        current = data;
      }
    }
    if (!envelope) return json({ skipped: decision, counts: candidate.source.counts });
    if (!leaseAcquired) {
      const { data, error } = await db.from("agent_report_outbox")
        .update({ lease_token: leaseToken, lease_expires_at: leaseUntil })
        .eq("id", outbox.id).in("status", ["pending", "retry_wait"])
        .or(`lease_expires_at.is.null,lease_expires_at.lt.${now.toISOString()}`)
        .select("*").maybeSingle();
      if (error) return json({ error: "outbox_claim_failed", detail: error.message }, 500);
      if (!data) return json({ skipped: "concurrent_claim" });
      leaseAcquired = true;
      current = data;
      envelope = data.pending_envelope;
    }

    const delivery = await sendEnvelope(envelope, hmacSecret, ingressUrl);
    const classification = classifyIngressResult({ status: delivery.status, receipt: delivery.receipt, attemptCount: current.attempt_count || 0 });
    if (classification.kind === "delivered") {
      const { error } = await db.from("agent_report_outbox").update({
        status: "delivered", last_delivered_content_hash: current.pending_content_hash,
        last_delivered_report_id: current.pending_report_id, last_receipt: delivery.receipt,
        delivered_at: now.toISOString(),
        pending_envelope: null, pending_report_id: null, pending_content_hash: null,
        pending_created_at: null,
        attempt_count: 0, next_attempt_at: null, paused_until: null, last_error: null,
        lease_token: null, lease_expires_at: null,
      }).eq("id", outbox.id).eq("lease_token", leaseToken);
      if (error) return json({ error: "delivery_watermark_failed", detail: error.message }, 500);
      return json({ delivered: delivery.receipt?.status, report_id: envelope.id, counts: candidate.source.counts });
    }
    const delay = classification.delaySeconds || 0;
    const patch = classification.kind === "retry"
      ? { status: "retry_wait", attempt_count: classification.attemptCount, next_attempt_at: new Date(now.getTime() + delay * 1000).toISOString(), last_error: compactError(delivery) }
      : classification.kind === "paused"
        ? { status: "paused", attempt_count: classification.attemptCount, next_attempt_at: null, paused_until: new Date(now.getTime() + delay * 1000).toISOString(), last_error: compactError(delivery), lease_token: null, lease_expires_at: null }
        : { status: "blocked", attempt_count: classification.attemptCount, next_attempt_at: null, last_error: compactError(delivery), lease_token: null, lease_expires_at: null };
    await db.from("agent_report_outbox").update(patch).eq("id", outbox.id).eq("lease_token", leaseToken);
    return json({ delivery: classification.kind, status: delivery.status, error: delivery.receipt || delivery.error }, classification.kind === "blocked" ? 422 : 503);
  } finally {
    if (leaseAcquired) {
      await db.from("agent_report_outbox").update({ lease_token: null, lease_expires_at: null })
        .eq("id", outbox.id).eq("lease_token", leaseToken);
    }
  }
});
