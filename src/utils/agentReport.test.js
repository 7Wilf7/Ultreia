import { describe, expect, it } from "vitest";
import {
  REPORT_CATALOG,
  REPORT_DETECTORS,
  REPORT_TYPE,
  SIGNAL_KIND,
  buildReportEnvelope,
  buildTrainingStateCandidate,
  canonicalJson,
  classifyIngressResult,
  containsForbiddenReportData,
  decideCandidateAction,
  decideOutboxRun,
  discoverReportCandidates,
  extractReportFeatures,
  isShadowJournalDue,
  localDateEndInstant,
  localDateKey,
  localDateStartInstant,
  shadowJournalEntry,
  shiftDateKey,
  validateCandidateAgainstCatalog,
  validateStoredPendingEnvelope,
} from "./agentReport";

const NOW = new Date("2026-07-12T04:00:00.000Z");
const INCIDENT_NOW = new Date("2026-07-14T16:30:00.000Z"); // 2026-07-15 00:30 Asia/Shanghai
const plan = (id, date, extra = {}) => ({
  id, date, type: "Road Run", sub_types: ["Easy Run"], distance: 10,
  is_planned: true, plan_status: null, plan_detail: {}, updated_at: `${date}T01:00:00Z`, ...extra,
});
const actual = (id, date, distance = 10, extra = {}) => ({
  id, date, type: "Road Run", sub_types: ["Easy Run"], distance,
  duration: 60, is_planned: false, updated_at: `${date}T12:00:00Z`, ...extra,
});

describe("shadow training state candidate", () => {
  it("triggers for two deviations but not one", async () => {
    const two = await buildTrainingStateCandidate([plan("p1", "2026-07-01"), plan("p2", "2026-07-02")], { now: NOW });
    const one = await buildTrainingStateCandidate([plan("p1", "2026-07-01")], { now: NOW });
    expect(two.triggered).toBe(true);
    expect(one.triggered).toBe(false);
  });

  it("a missed key session triggers alone", async () => {
    const candidate = await buildTrainingStateCandidate([
      plan("p1", "2026-07-01", { plan_detail: { keySession: true } }),
    ], { now: NOW });
    expect(candidate.triggered).toBe(true);
    expect(candidate.typedPayload.counts.missed_key_sessions).toBe(1);
  });

  it("excludes today and future, preserves manual done, and matches one-to-one", async () => {
    const candidate = await buildTrainingStateCandidate([
      plan("done", "2026-07-01", { plan_status: "done" }),
      plan("p1", "2026-07-02"), plan("p2", "2026-07-02"), actual("a1", "2026-07-02"),
      plan("today", "2026-07-12"), plan("future", "2026-07-13"),
    ], { now: NOW });
    expect(candidate.source.counts).toEqual({ planned: 3, done: 2, partial: 0, missed: 1, affected: 1, missed_key_sessions: 0 });
    expect(candidate.triggered).toBe(false);
  });

  it("source/key order does not change hashes or deterministic identity", async () => {
    const rows = [plan("p1", "2026-07-01"), plan("p2", "2026-07-02")];
    const first = await buildTrainingStateCandidate(rows, { now: NOW });
    const second = await buildTrainingStateCandidate(rows.reverse().map(row => Object.fromEntries(Object.entries(row).reverse())), { now: NOW });
    const e1 = await buildReportEnvelope(first, { reportedAt: NOW });
    const e2 = await buildReportEnvelope(second, { reportedAt: new Date("2026-07-12T05:00:00Z") });
    expect(first.sourceFingerprint).toBe(second.sourceFingerprint);
    expect(first.contentHash).toBe(second.contentHash);
    expect([e1.id, e1.source_ref, e1.root_lineage_id]).toEqual([e2.id, e2.source_ref, e2.root_lineage_id]);
    expect(canonicalJson(first.typedPayload)).toBe(canonicalJson(second.typedPayload));
  });

  it("outbound envelope contains no private source keys or values", async () => {
    const privateId = "123e4567-e89b-42d3-a456-426614174000";
    const candidate = await buildTrainingStateCandidate([
      plan(privateId, "2026-07-01"), plan("private-plan-2", "2026-07-02"),
    ], { now: NOW });
    const envelope = await buildReportEnvelope(candidate, { reportedAt: NOW });
    expect(containsForbiddenReportData(envelope.typed_payload, [privateId, "private-plan-2"])).toBe(false);
  });
});

describe("occurred_at timezone semantics", () => {
  async function incidentEnvelope(reportedAt) {
    const today = localDateKey(reportedAt, "Asia/Shanghai");
    const candidate = await buildTrainingStateCandidate([
      plan("p1", shiftDateKey(today, -3)), plan("p2", shiftDateKey(today, -2)),
    ], { now: reportedAt, timeZone: "Asia/Shanghai" });
    return buildReportEnvelope(candidate, { reportedAt, timeZone: "Asia/Shanghai" });
  }

  it("reproduces the production 00:30 incident with a real UTC boundary", async () => {
    const envelope = await incidentEnvelope(INCIDENT_NOW);
    expect(envelope.typed_payload.window.end_date).toBe("2026-07-14");
    expect(envelope.occurred_at).toBe("2026-07-14T15:59:59.999Z");
    expect(Date.parse(envelope.occurred_at)).toBeLessThanOrEqual(Date.parse(envelope.reported_at));
    expect(envelope.occurred_at).not.toContain("T23:59:59.000Z");
  });

  it.each([
    ["ordinary cross-day", "2026-07-15T16:30:00.000Z", "2026-07-15T15:59:59.999Z"],
    ["month start", "2026-07-31T16:30:00.000Z", "2026-07-31T15:59:59.999Z"],
    ["year start", "2025-12-31T16:30:00.000Z", "2025-12-31T15:59:59.999Z"],
  ])("handles local 00:30 at %s", async (_label, reportedIso, expectedOccurred) => {
    const envelope = await incidentEnvelope(new Date(reportedIso));
    expect(envelope.occurred_at).toBe(expectedOccurred);
    expect(Date.parse(envelope.occurred_at)).toBeLessThanOrEqual(Date.parse(envelope.reported_at));
  });

  it("converts local day boundaries without labelling local time as UTC", () => {
    expect(localDateStartInstant("2026-07-15", "Asia/Shanghai").toISOString()).toBe("2026-07-14T16:00:00.000Z");
    expect(localDateEndInstant("2026-07-15", "Asia/Shanghai").toISOString()).toBe("2026-07-15T15:59:59.999Z");
  });

  it("fails closed by clamping occurred_at to an unusually early reported_at", async () => {
    const candidate = await buildTrainingStateCandidate([
      plan("p1", "2026-07-01"), plan("p2", "2026-07-02"),
    ], { now: INCIDENT_NOW, timeZone: "Asia/Shanghai" });
    const early = new Date("2026-07-14T15:00:00.000Z");
    const envelope = await buildReportEnvelope(candidate, { reportedAt: early, timeZone: "Asia/Shanghai" });
    expect(envelope.occurred_at).toBe(early.toISOString());
  });
});

describe("registered detector pipeline", () => {
  const domainSnapshot = {
    workouts: [
      plan("private-plan-1", "2026-07-01"), plan("private-plan-2", "2026-07-02"),
      plan("private-plan-3", "2026-07-03"), plan("private-plan-4", "2026-07-04"),
      actual("base-1", "2026-07-05", 10, { duration: 40 }),
      actual("base-2", "2026-07-06", 10, { duration: 40 }),
      actual("base-3", "2026-07-07", 10, { duration: 40 }),
      actual("recent-1", "2026-07-10", 25, { duration: 120, rpe: 9, note: "private knee pain detail" }),
      actual("recent-2", "2026-07-11", 12, { duration: 120, rpe: 8, note: "private sore achilles detail" }),
      actual("recent-3", "2026-07-12", 12, { duration: 120, rpe: 6 }),
      actual("old-1", "2026-05-01", 8, { duration: 50, ascent: 200 }),
      actual("old-2", "2026-05-08", 9, { duration: 55, ascent: 250 }),
      actual("old-3", "2026-05-15", 10, { duration: 60, ascent: 300 }),
      actual("old-4", "2026-05-22", 10, { duration: 60, ascent: 300 }),
    ],
    dailyNotes: [
      { date: "2026-07-10", tags: [], readiness_sleep: 1, readiness_legs: 1, readiness_energy: 2 },
      { date: "2026-07-11", tags: ["sick"], readiness_sleep: 1, readiness_legs: 1, readiness_energy: 1 },
      { date: "2026-07-12", tags: [], readiness_sleep: 1, readiness_legs: 2, readiness_energy: 1 },
    ],
    races: [{ date: "2026-09-01", is_target: true, priority: "A", updated_at: "2026-07-14T02:00:00.000Z" }],
    memoryFacts: [{ category: "training_preferences", status: "active", updated_at: "2026-07-14T03:00:00.000Z" }],
  };

  it("uses a catalog and keeps only the production pair live", () => {
    expect(REPORT_CATALOG).toHaveLength(8);
    expect(REPORT_CATALOG.filter(entry => entry.runtime === "live")).toEqual([
      expect.objectContaining({ reportType: REPORT_TYPE, signalKind: SIGNAL_KIND }),
    ]);
    expect(new Set(REPORT_CATALOG.map(entry => entry.detectorId)).size).toBe(REPORT_CATALOG.length);
    expect(REPORT_DETECTORS.map(detector => detector.id)).toEqual(REPORT_CATALOG.map(entry => entry.detectorId));
  });

  it("discovers multiple minimized candidates without changing the scheduler", async () => {
    const result = await discoverReportCandidates(domainSnapshot, { now: INCIDENT_NOW, timeZone: "Asia/Shanghai" });
    const signals = result.candidates.map(candidate => candidate.signalKind);
    expect(signals).toContain(SIGNAL_KIND);
    expect(signals).toContain("training_adherence_pattern_change");
    expect(signals).toContain("rapid_training_load_change");
    expect(signals).toContain("recovery_risk_trend");
    expect(signals).toContain("target_race_context_change");
    expect(signals).toContain("stable_preference_or_constraint_change");
    expect(signals).toContain("notable_progress_or_milestone");
    expect(signals).toContain("recurring_injury_or_health_risk_pattern");
    for (const candidate of result.candidates) {
      expect(validateCandidateAgainstCatalog(candidate).ok).toBe(true);
    }
  });

  it("never exposes raw rows, ids, notes, or health details in candidates or shadow journal", async () => {
    const result = await discoverReportCandidates(domainSnapshot, { now: INCIDENT_NOW, timeZone: "Asia/Shanghai" });
    const secrets = ["private-plan-1", "recent-1", "private knee pain detail", "private sore achilles detail"];
    for (const candidate of result.candidates) {
      expect(containsForbiddenReportData(candidate.typedPayload, secrets)).toBe(false);
      const journal = shadowJournalEntry(candidate, { observedAt: INCIDENT_NOW });
      if (candidate.catalog.runtime === "live") expect(journal).toBeNull();
      else {
        expect(journal.model_used).toBe(false);
        expect(journal.novelty).toBe("aggregate_changed");
        expect(journal.retention_ceiling_at).toBeTruthy();
        expect(containsForbiddenReportData(journal, secrets)).toBe(false);
      }
    }
  });

  it("ignores malformed external dates instead of failing the whole discovery run", () => {
    const features = extractReportFeatures({
      races: [{ date: "2026-99-99", is_target: true, updated_at: "invalid" }],
      memoryFacts: [{ category: "training_preferences", status: "active", updated_at: "invalid" }],
    }, { now: INCIDENT_NOW, timeZone: "Asia/Shanghai" });
    expect(features.goalContext.nearestTargetDays).toBeNull();
    expect(features.goalContext.changedCount).toBe(0);
    expect(features.preference.changedCount).toBe(0);
  });

  it("rate-limits each shadow signal to its catalog frequency slot", () => {
    const entry = REPORT_CATALOG.find(item => item.maxFrequencyDays === 14 && item.runtime !== "live");
    const candidate = { reportType: entry.reportType, signalKind: entry.signalKind, catalog: entry };
    const dueDays = Array.from({ length: 28 }, (_, offset) => new Date(INCIDENT_NOW.getTime() + offset * 86400000))
      .filter(observedAt => isShadowJournalDue(candidate, { observedAt, timeZone: "Asia/Shanghai" }));
    expect(dueDays).toHaveLength(2);
    expect((dueDays[1] - dueDays[0]) / 86400000).toBe(14);
  });

  it("rejects invented types, fields, and confidence below the catalog floor", () => {
    expect(validateCandidateAgainstCatalog({ reportType: "invented", signalKind: "invented" }).reason).toBe("unregistered_report_type");
    const entry = REPORT_CATALOG[0];
    const base = {
      reportType: entry.reportType, signalKind: entry.signalKind, confidence: 0.95,
      typedPayload: { type: entry.reportType, signal_kind: entry.signalKind, schema_version: entry.schemaVersion },
    };
    expect(validateCandidateAgainstCatalog({ ...base, typedPayload: { ...base.typedPayload, new_scope: "all" } }).reason).toBe("unregistered_payload_field");
    expect(validateCandidateAgainstCatalog({ ...base, confidence: 0.1 }).reason).toBe("confidence_below_floor");
    expect(validateCandidateAgainstCatalog({
      ...base,
      typedPayload: {
        ...base.typedPayload,
        window: { start_date: "2026-07-01", end_date: "not-a-date", lookback_days: 14 },
        counts: { planned: 1, done: 0, partial: 0, missed: 1, affected: 1, missed_key_sessions: 0 },
        affected_ratio: 1,
        state: "active",
      },
    }).reason).toBe("invalid_payload_schema");
  });
});

describe("outbox retry and concurrency state machine", () => {
  const pendingEnvelope = {
    id: "report-1", content_hash: "content-hash", typed_payload: { safe: true },
  };
  const pending = {
    status: "pending", pending_envelope: pendingEnvelope,
    pending_report_id: "report-1", pending_content_hash: "content-hash",
    attempt_count: 0,
  };
  const now = new Date("2026-07-15T00:00:00.000Z");

  it("never replaces an existing pending envelope", () => {
    const candidate = { sourceFingerprint: "new-source", triggered: true, contentHash: "new-content" };
    expect(decideCandidateAction(pending, candidate)).toBe("preserve_pending");
  });

  it("respects paused_until and resumes only after expiry", () => {
    expect(decideOutboxRun({ ...pending, status: "paused", paused_until: "2026-07-15T01:00:00Z" }, { now, candidateWindow: true }))
      .toEqual({ action: "skip", reason: "paused_not_due" });
    expect(decideOutboxRun({ ...pending, status: "paused", paused_until: "2026-07-14T23:59:59Z" }, { now, candidateWindow: false }))
      .toEqual({ action: "retry", reason: "pause_expired" });
  });

  it("blocks deterministic failures and malformed pending states", () => {
    expect(decideOutboxRun({ ...pending, status: "blocked" }, { now, candidateWindow: true }).reason).toBe("permanent_failure");
    expect(decideOutboxRun({ ...pending, status: "paused", paused_until: null }, { now }).reason).toBe("invalid_pause_state");
    expect(decideOutboxRun({ status: "retry_wait", pending_envelope: null }, { now, candidateWindow: true }).reason).toBe("missing_pending_envelope");
  });

  it("runs retry_wait only when due", () => {
    expect(decideOutboxRun({ ...pending, status: "retry_wait", next_attempt_at: "2026-07-15T01:00:00Z" }, { now }).reason).toBe("retry_not_due");
    expect(decideOutboxRun({ ...pending, status: "retry_wait", next_attempt_at: "2026-07-14T23:00:00Z" }, { now }))
      .toEqual({ action: "retry", reason: "retry_due" });
    expect(decideOutboxRun({ ...pending, status: "retry_wait", next_attempt_at: "invalid" }, { now }).reason)
      .toBe("invalid_retry_state");
  });

  it("makes duplicate Cron calls and concurrent workers lose to an active lease", () => {
    const leased = { status: "idle", pending_envelope: null, lease_token: "worker-1", lease_expires_at: "2026-07-15T00:01:00Z" };
    expect(decideOutboxRun(leased, { now, candidateWindow: true })).toEqual({ action: "skip", reason: "concurrent_claim" });
    expect(decideOutboxRun({ ...leased, lease_expires_at: "2026-07-14T23:59:00Z" }, { now, candidateWindow: true }))
      .toEqual({ action: "discover", reason: "candidate_window" });
  });

  it("retries only network and 5xx, then pauses; all 4xx are permanent", () => {
    expect(classifyIngressResult({ status: 0, attemptCount: 0 })).toMatchObject({ kind: "retry", delaySeconds: 1800, attemptCount: 1 });
    expect(classifyIngressResult({ status: 503, attemptCount: 1 })).toMatchObject({ kind: "retry", delaySeconds: 7200, attemptCount: 2 });
    expect(classifyIngressResult({ status: 500, attemptCount: 2 })).toMatchObject({ kind: "paused", delaySeconds: 86400, attemptCount: 3 });
    for (const status of [400, 401, 409, 413, 422, 429]) {
      expect(classifyIngressResult({ status, attemptCount: 0 })).toMatchObject({ kind: "blocked", attemptCount: 1 });
    }
  });

  it("accepts all idempotent success receipts", () => {
    for (const status of ["recorded", "replayed", "duplicate"]) {
      expect(classifyIngressResult({ status: 200, receipt: { status } }).kind).toBe("delivered");
    }
  });

  it("binds retries to the original report id, content hash, payload, and idempotency key", async () => {
    const typedPayload = { safe: true };
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(typedPayload)))
      .then(bytes => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join(""));
    const valid = {
      ...pending,
      pending_content_hash: hash,
      pending_envelope: { ...pendingEnvelope, content_hash: hash, typed_payload: typedPayload },
    };
    await expect(validateStoredPendingEnvelope(valid)).resolves.toEqual({ ok: true, idempotencyKey: "report-1" });
    await expect(validateStoredPendingEnvelope({ ...valid, pending_report_id: "different" }))
      .resolves.toEqual({ ok: false, reason: "report_id_mismatch" });
    await expect(validateStoredPendingEnvelope({ ...valid, pending_envelope: { ...valid.pending_envelope, typed_payload: { changed: true } } }))
      .resolves.toEqual({ ok: false, reason: "payload_hash_mismatch" });
  });
});
