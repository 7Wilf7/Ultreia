import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  REPORT_CATALOG,
  buildReportEnvelope,
  canonicalJson,
  catalogKey,
  classifyIngressResult,
  decideCandidateAction,
  decideOutboxRun,
  discoverReportCandidates,
  isShadowJournalDue,
  localDateKey,
  shadowJournalEntry,
  sha256Hex,
  shiftDateKey,
  validateStoredPendingEnvelope,
} from "../../../src/utils/agentReport.js";

const FUNCTION_PATH = "/functions/v1/aevum-agent-report-ingress";
const WORKOUT_COLUMNS = "id,date,type,sub_types,distance,duration,ascent,rpe,note,started_at,is_planned,plan_status,plan_detail,updated_at";
const DAILY_NOTE_COLUMNS = "date,tags,readiness_sleep,readiness_legs,readiness_energy";
const RACE_COLUMNS = "date,is_target,priority,updated_at";
const MEMORY_COLUMNS = "category,status,updated_at";
const UNOBSERVED_FINGERPRINT = "0".repeat(64);
const LEASE_MS = 2 * 60 * 1000;

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
    try { receipt = await response.json(); } catch { /* recorded as a deterministic contract error */ }
    return { status: response.status, receipt };
  } catch (error) {
    return { status: 0, receipt: null, error: String(error) };
  } finally {
    clearTimeout(timer);
  }
}

async function loadDomainSnapshot(db: ReturnType<typeof createClient>, userId: string, now: Date, timeZone: string) {
  const today = localDateKey(now, timeZone);
  const startDate = shiftDateKey(today, -120);
  const endDate = shiftDateKey(today, -1);
  const [workouts, dailyNotes, races, memoryFacts] = await Promise.all([
    db.from("workouts").select(WORKOUT_COLUMNS).eq("user_id", userId)
      .gte("date", startDate).lte("date", endDate),
    db.from("daily_notes").select(DAILY_NOTE_COLUMNS).eq("user_id", userId)
      .gte("date", shiftDateKey(today, -28)).lte("date", endDate),
    db.from("races").select(RACE_COLUMNS).eq("user_id", userId).eq("is_target", true),
    db.from("coach_memory_facts").select(MEMORY_COLUMNS).eq("user_id", userId)
      .eq("category", "training_preferences").in("status", ["active", "archived"])
      .gte("updated_at", new Date(now.getTime() - 2 * 86400000).toISOString()),
  ]);
  const failure = [workouts, dailyNotes, races, memoryFacts].find(result => result.error);
  if (failure?.error) throw new Error(`domain_snapshot_failed:${failure.error.message}`);
  return {
    workouts: workouts.data || [],
    dailyNotes: dailyNotes.data || [],
    races: races.data || [],
    memoryFacts: memoryFacts.data || [],
  };
}

async function acquireLease(db: ReturnType<typeof createClient>, outbox: Record<string, any>, leaseToken: string, leaseUntil: string, now: Date) {
  let query = db.from("agent_report_outbox")
    .update({ lease_token: leaseToken, lease_expires_at: leaseUntil })
    .eq("id", outbox.id)
    .eq("status", outbox.status)
    .or(`lease_expires_at.is.null,lease_expires_at.lt.${now.toISOString()}`);
  if (outbox.pending_envelope) {
    query = query.eq("pending_report_id", outbox.pending_report_id);
  } else {
    query = query.is("pending_envelope", null)
      .eq("observed_source_fingerprint", outbox.observed_source_fingerprint);
  }
  const { data, error } = await query.select("*").maybeSingle();
  if (error) throw new Error(`outbox_claim_failed:${error.message}`);
  return data;
}

async function deliverClaimedEnvelope({ db, outbox, envelope, leaseToken, now, hmacSecret, ingressUrl }: Record<string, any>) {
  const integrity = await validateStoredPendingEnvelope(outbox);
  if (!integrity.ok) {
    const { error } = await db.from("agent_report_outbox").update({
      status: "blocked", next_attempt_at: null, paused_until: null,
      last_error: compactError({ error: integrity.reason }),
    }).eq("id", outbox.id).eq("lease_token", leaseToken);
    if (error) return json({ error: "pending_integrity_block_failed", detail: error.message }, 500);
    return json({ delivery: "blocked", error: integrity.reason }, 422);
  }

  const delivery = await sendEnvelope(envelope, hmacSecret, ingressUrl);
  const classification = classifyIngressResult({
    status: delivery.status,
    receipt: delivery.receipt,
    attemptCount: outbox.attempt_count || 0,
  });
  if (classification.kind === "delivered") {
    const { error } = await db.from("agent_report_outbox").update({
      status: "delivered", last_delivered_content_hash: outbox.pending_content_hash,
      last_delivered_report_id: outbox.pending_report_id, last_receipt: delivery.receipt,
      delivered_at: now.toISOString(),
      pending_envelope: null, pending_report_id: null, pending_content_hash: null,
      pending_created_at: null, attempt_count: 0, next_attempt_at: null,
      paused_until: null, last_error: null,
    }).eq("id", outbox.id).eq("lease_token", leaseToken);
    if (error) return json({ error: "delivery_watermark_failed", detail: error.message }, 500);
    return json({ delivered: delivery.receipt?.status, report_id: envelope.id });
  }

  const delay = classification.delaySeconds || 0;
  const patch = classification.kind === "retry"
    ? {
      status: "retry_wait", attempt_count: classification.attemptCount,
      next_attempt_at: new Date(now.getTime() + delay * 1000).toISOString(),
      last_error: compactError(delivery),
    }
    : classification.kind === "paused"
      ? {
        status: "paused", attempt_count: classification.attemptCount, next_attempt_at: null,
        paused_until: new Date(now.getTime() + delay * 1000).toISOString(),
        last_error: compactError(delivery),
      }
      : {
        status: "blocked", attempt_count: classification.attemptCount,
        next_attempt_at: null, paused_until: null, last_error: compactError(delivery),
      };
  const { error } = await db.from("agent_report_outbox").update(patch)
    .eq("id", outbox.id).eq("lease_token", leaseToken);
  if (error) return json({ error: "delivery_state_write_failed", detail: error.message }, 500);
  return json({
    delivery: classification.kind,
    status: delivery.status,
    error: delivery.receipt || delivery.error,
  }, classification.kind === "blocked" ? 422 : 503);
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
  let clock;
  try {
    clock = localClock(now, timeZone);
  } catch {
    return json({ error: "invalid_target_timezone" }, 503);
  }
  const candidateWindow = body.force === true || (clock.hour === 0 && clock.minute >= 30 && clock.minute < 60);
  const liveCatalog = REPORT_CATALOG.filter(entry => entry.runtime === "live");

  for (const entry of liveCatalog) {
    const { error } = await db.from("agent_report_outbox").upsert({
      user_id: userId, report_type: entry.reportType, signal_kind: entry.signalKind,
      observed_source_fingerprint: UNOBSERVED_FINGERPRINT, status: "idle",
    }, { onConflict: "user_id,report_type,signal_kind", ignoreDuplicates: true });
    if (error) return json({ error: "outbox_seed_failed", detail: error.message }, 500);
  }

  const { data: rows, error: outboxError } = await db.from("agent_report_outbox")
    .select("*").eq("user_id", userId)
    .in("report_type", [...new Set(liveCatalog.map(entry => entry.reportType))]);
  if (outboxError) return json({ error: "outbox_read_failed", detail: outboxError.message }, 500);
  const outboxByKey = new Map((rows || []).map(row => [catalogKey(row.report_type, row.signal_kind), row]));
  const scheduled = liveCatalog.map(entry => ({ entry, outbox: outboxByKey.get(catalogKey(entry.reportType, entry.signalKind)) }))
    .filter(item => item.outbox)
    .map(item => ({ ...item, run: decideOutboxRun(item.outbox, { now, candidateWindow }) }));
  const selected = scheduled.find(item => item.run.action === "retry")
    || scheduled.find(item => item.run.action === "discover")
    || (candidateWindow ? scheduled.find(item => item.run.reason === "permanent_failure") : null);
  if (!selected) {
    return json({ skipped: scheduled.map(item => ({ signal_kind: item.entry.signalKind, reason: item.run.reason })) });
  }

  const leaseToken = crypto.randomUUID();
  const leaseUntil = new Date(now.getTime() + LEASE_MS).toISOString();
  let claimed = null;
  try {
    claimed = await acquireLease(db, selected.outbox, leaseToken, leaseUntil, now);
    if (!claimed) return json({ skipped: "concurrent_claim" });

    if (selected.run.action === "retry") {
      return await deliverClaimedEnvelope({
        db, outbox: claimed, envelope: claimed.pending_envelope,
        leaseToken, now, hmacSecret, ingressUrl,
      });
    }

    let domainSnapshot;
    try {
      domainSnapshot = await loadDomainSnapshot(db, userId, now, timeZone);
    } catch (error) {
      return json({ error: "domain_snapshot_failed", detail: String(error).slice(0, 256) }, 500);
    }
    const discovery = await discoverReportCandidates(domainSnapshot, { now, timeZone });
    for (const candidate of discovery.candidates) {
      const journal = shadowJournalEntry(candidate, { observedAt: now });
      if (journal && isShadowJournalDue(candidate, { observedAt: now, timeZone })) console.info(JSON.stringify(journal));
    }
    if (selected.run.reason === "permanent_failure") {
      return json({
        skipped: "live_outbox_blocked",
        shadow_candidates: discovery.candidates.filter(item => item.catalog.runtime !== "live").length,
      });
    }
    const candidate = discovery.candidates.find(item => item.reportType === selected.entry.reportType && item.signalKind === selected.entry.signalKind)
      || discovery.observations.find(item => item.reportType === selected.entry.reportType && item.signalKind === selected.entry.signalKind);
    if (!candidate) return json({ error: "live_detector_missing" }, 500);
    const decision = decideCandidateAction(claimed, candidate);
    if (decision !== "persist_pending") {
      const { error } = await db.from("agent_report_outbox").update({
        observed_source_fingerprint: candidate.sourceFingerprint,
      }).eq("id", claimed.id).eq("lease_token", leaseToken).is("pending_envelope", null);
      if (error) return json({ error: "watermark_write_failed", detail: error.message }, 500);
      return json({ skipped: decision, counts: candidate.source.counts, shadow_candidates: discovery.candidates.filter(item => item.catalog.runtime !== "live").length });
    }

    const envelope = await buildReportEnvelope(candidate, { reportedAt: now, timeZone });
    const { data: pending, error: persistError } = await db.from("agent_report_outbox").update({
      observed_source_fingerprint: candidate.sourceFingerprint,
      pending_envelope: envelope,
      pending_report_id: envelope.id,
      pending_content_hash: candidate.contentHash,
      pending_created_at: now.toISOString(),
      status: "pending", attempt_count: 0, next_attempt_at: null,
      last_error: null, paused_until: null,
    }).eq("id", claimed.id).eq("lease_token", leaseToken).is("pending_envelope", null)
      .select("*").maybeSingle();
    if (persistError) return json({ error: "pending_persist_failed", detail: persistError.message }, 500);
    if (!pending) return json({ skipped: "pending_changed_during_discovery" });
    claimed = pending;
    return await deliverClaimedEnvelope({
      db, outbox: pending, envelope, leaseToken, now, hmacSecret, ingressUrl,
    });
  } catch (error) {
    return json({ error: "reporter_failed", detail: String(error).slice(0, 256) }, 500);
  } finally {
    if (claimed) {
      await db.from("agent_report_outbox").update({ lease_token: null, lease_expires_at: null })
        .eq("id", claimed.id).eq("lease_token", leaseToken);
    }
  }
});
