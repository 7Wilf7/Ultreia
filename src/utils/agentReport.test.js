import { describe, expect, it } from "vitest";
import {
  REPORT_CATALOG,
  REPORT_DETECTORS,
  buildReportEnvelope,
  buildReportSignatureMessage,
  buildTrainingStateCandidate,
  canonicalJson,
  classifyIngressResult,
  containsForbiddenReportData,
  decideCandidateAction,
  decideOutboxRun,
  discoverReportCandidates,
  extractReportFeatures,
  isLiveCadenceDue,
  localDateEndInstant,
  localDateKey,
  localDateStartInstant,
  scheduleLiveOutboxRuns,
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

const AEVUM_B2_FIXTURES = [
  {
    type: "training_state_change", signal_kind: "repeated_plan_deviation", schema_version: "training_state_change.v1",
    window: { start_date: "2026-06-28", end_date: "2026-07-11", lookback_days: 14 },
    counts: { planned: 6, done: 3, partial: 1, missed: 2, affected: 3, missed_key_sessions: 1 },
    affected_ratio: 0.5, state: "active",
  },
  {
    type: "training_load_change", signal_kind: "rapid_training_load_change", schema_version: "training_load_change.v1",
    window: { start_date: "2026-06-28", end_date: "2026-07-11", comparison_days: 7 },
    direction: "rapid_increase", duration_change_ratio: 1.75, session_counts: { recent: 5, previous: 3 },
  },
  {
    type: "recovery_state_change", signal_kind: "recovery_risk_trend", schema_version: "recovery_state_change.v1",
    window: { start_date: "2026-07-05", end_date: "2026-07-11", lookback_days: 7 },
    risk_level: "elevated", poor_readiness_days: 2, high_rpe_sessions: 1, sample_days: 5,
  },
  {
    type: "goal_context_change", signal_kind: "target_race_context_change", schema_version: "goal_context_change.v1",
    change_window: "2026-07-11", target_count: 2, nearest_target_days: 45,
    priority_counts: { A: 1, B: 1, C: 0, unset: 0 },
  },
  {
    type: "training_preference_change", signal_kind: "preference_context_invalidated", schema_version: "training_preference_invalidation.v1",
    change_window: "2026-07-11", change_count: 2, operations: { updated: 1, removed: 1 }, context_version: "a".repeat(64),
  },
  {
    type: "training_progress_change", signal_kind: "notable_progress_or_milestone", schema_version: "training_progress_change.v1",
    window: { start_date: "2026-07-05", end_date: "2026-07-11", lookback_days: 7 },
    metric: "distance", improvement_ratio: 1.2, baseline_days: 90,
  },
  {
    type: "health_risk_change", signal_kind: "recurring_injury_or_health_risk_pattern", schema_version: "health_risk_change.v1",
    window: { start_date: "2026-06-14", end_date: "2026-07-11", lookback_days: 28 },
    signal_days: 3, signal_sources: { workout_text_days: 2, sick_tag_days: 1 }, recurrence: "repeated_days",
  },
];

describe("training state candidate", () => {
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

  it("rejects a future occurred_at instead of hiding it", async () => {
    const candidate = await buildTrainingStateCandidate([
      plan("p1", "2026-07-01"), plan("p2", "2026-07-02"),
    ], { now: INCIDENT_NOW, timeZone: "Asia/Shanghai" });
    const early = new Date("2026-07-14T15:00:00.000Z");
    await expect(buildReportEnvelope(candidate, { reportedAt: early, timeZone: "Asia/Shanghai" }))
      .rejects.toThrow("report_occurred_at_in_future");
  });
});

describe("registered detector pipeline", () => {
  const activePreferenceId = "123e4567-e89b-42d3-a456-426614174111";
  const removedPreferenceId = "123e4567-e89b-42d3-a456-426614174222";
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
    memoryFacts: [
      { id: activePreferenceId, category: "training_preferences", status: "active", updated_at: "2026-07-14T03:00:00.000Z" },
      { id: removedPreferenceId, category: "training_preferences", status: "archived", updated_at: "2026-07-14T04:00:00.000Z" },
    ],
  };

  it("matches the seven-entry Aevum B2 catalog and removes adherence", () => {
    expect(REPORT_CATALOG).toHaveLength(7);
    expect(REPORT_CATALOG.every(entry => entry.runtime === "live")).toBe(true);
    expect(REPORT_CATALOG.map(entry => [entry.reportType, entry.signalKind])).toEqual([
      ["training_state_change", "repeated_plan_deviation"],
      ["training_load_change", "rapid_training_load_change"],
      ["recovery_state_change", "recovery_risk_trend"],
      ["goal_context_change", "target_race_context_change"],
      ["training_preference_change", "preference_context_invalidated"],
      ["training_progress_change", "notable_progress_or_milestone"],
      ["health_risk_change", "recurring_injury_or_health_risk_pattern"],
    ]);
    expect(REPORT_CATALOG.map(entry => entry.confidenceFloor)).toEqual([0.9, 0.85, 0.9, 0.95, 0.9, 0.9, 0.95]);
    expect(REPORT_CATALOG.map(entry => entry.sensitivity)).toEqual(["normal", "normal", "sensitive", "normal", "normal", "normal", "sensitive"]);
    expect(REPORT_CATALOG.map(entry => entry.retentionCeilingDays)).toEqual([7, 21, 14, 90, 180, 90, 14]);
    expect(REPORT_CATALOG.map(entry => entry.maxFrequencyDays)).toEqual([1, 7, 7, 1, 7, 14, 14]);
    expect(REPORT_CATALOG.map(entry => entry.modelParticipation)).toEqual([
      "forbidden", "allowed_minimized", "forbidden", "allowed_minimized",
      "allowed_minimized", "allowed_minimized", "forbidden",
    ]);
    expect(REPORT_CATALOG.some(entry => entry.signalKind === "training_adherence_pattern_change")).toBe(false);
    expect(new Set(REPORT_CATALOG.map(entry => entry.detectorId)).size).toBe(REPORT_CATALOG.length);
    expect(REPORT_DETECTORS.map(detector => detector.id)).toEqual(REPORT_CATALOG.map(entry => entry.detectorId));
  });

  it("accepts all seven Aevum B2 fixtures without translation", () => {
    for (const payload of AEVUM_B2_FIXTURES) {
      const entry = REPORT_CATALOG.find(value => value.reportType === payload.type && value.signalKind === payload.signal_kind);
      expect(validateCandidateAgainstCatalog({
        reportType: payload.type,
        signalKind: payload.signal_kind,
        confidence: entry.confidenceFloor,
        typedPayload: payload,
      })).toMatchObject({ ok: true, entry });
    }
  });

  it("emits all seven exact B2 payload schemas", async () => {
    const result = await discoverReportCandidates(domainSnapshot, { now: INCIDENT_NOW, timeZone: "Asia/Shanghai" });
    const contextVersion = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson([
      { id: activePreferenceId, updated_at: "2026-07-14T03:00:00.000Z" },
    ]))).then(bytes => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join(""));
    expect(result.candidates.map(candidate => candidate.typedPayload)).toEqual([
      {
        type: "training_state_change", signal_kind: "repeated_plan_deviation", schema_version: "training_state_change.v1",
        window: { start_date: "2026-07-01", end_date: "2026-07-14", lookback_days: 14 },
        counts: { planned: 4, done: 0, partial: 0, missed: 4, affected: 4, missed_key_sessions: 0 },
        affected_ratio: 1, state: "active",
      },
      {
        type: "training_load_change", signal_kind: "rapid_training_load_change", schema_version: "training_load_change.v1",
        window: { start_date: "2026-07-01", end_date: "2026-07-14", comparison_days: 7 },
        direction: "rapid_increase", duration_change_ratio: 3, session_counts: { recent: 3, previous: 3 },
      },
      {
        type: "recovery_state_change", signal_kind: "recovery_risk_trend", schema_version: "recovery_state_change.v1",
        window: { start_date: "2026-07-08", end_date: "2026-07-14", lookback_days: 7 },
        risk_level: "high", poor_readiness_days: 3, high_rpe_sessions: 2, sample_days: 3,
      },
      {
        type: "goal_context_change", signal_kind: "target_race_context_change", schema_version: "goal_context_change.v1",
        change_window: "2026-07-14", target_count: 1, nearest_target_days: 48,
        priority_counts: { A: 1, B: 0, C: 0, unset: 0 },
      },
      {
        type: "training_preference_change", signal_kind: "preference_context_invalidated", schema_version: "training_preference_invalidation.v1",
        change_window: "2026-07-14", change_count: 2, operations: { updated: 1, removed: 1 }, context_version: contextVersion,
      },
      {
        type: "training_progress_change", signal_kind: "notable_progress_or_milestone", schema_version: "training_progress_change.v1",
        window: { start_date: "2026-07-08", end_date: "2026-07-14", lookback_days: 7 },
        metric: "distance", improvement_ratio: 2.5, baseline_days: 90,
      },
      {
        type: "health_risk_change", signal_kind: "recurring_injury_or_health_risk_pattern", schema_version: "health_risk_change.v1",
        window: { start_date: "2026-06-17", end_date: "2026-07-14", lookback_days: 28 },
        signal_days: 2, signal_sources: { workout_text_days: 2, sick_tag_days: 1 }, recurrence: "repeated_days",
      },
    ]);
    for (const candidate of result.candidates) {
      expect(validateCandidateAgainstCatalog(candidate).ok).toBe(true);
    }
  });

  it("keeps preference hashing stable and every envelope free of raw text and internal ids", async () => {
    const result = await discoverReportCandidates(domainSnapshot, { now: INCIDENT_NOW, timeZone: "Asia/Shanghai" });
    const reordered = await discoverReportCandidates({
      ...domainSnapshot,
      memoryFacts: [...domainSnapshot.memoryFacts].reverse().map(row => Object.fromEntries(Object.entries(row).reverse())),
    }, { now: INCIDENT_NOW, timeZone: "Asia/Shanghai" });
    const firstPreference = result.candidates.find(candidate => candidate.signalKind === "preference_context_invalidated");
    const secondPreference = reordered.candidates.find(candidate => candidate.signalKind === "preference_context_invalidated");
    expect(firstPreference.typedPayload.context_version).toBe(secondPreference.typedPayload.context_version);
    expect(firstPreference.typedPayload.change_count).toBe(
      firstPreference.typedPayload.operations.updated + firstPreference.typedPayload.operations.removed,
    );
    const secrets = [
      "private-plan-1", "recent-1", "private knee pain detail", "private sore achilles detail",
      activePreferenceId, removedPreferenceId,
    ];
    for (const candidate of result.candidates) {
      expect(containsForbiddenReportData(candidate.typedPayload, secrets)).toBe(false);
      const envelope = await buildReportEnvelope(candidate, { reportedAt: INCIDENT_NOW, timeZone: "Asia/Shanghai" });
      expect(containsForbiddenReportData(envelope, secrets)).toBe(false);
      expect(envelope.source_ref.length).toBeLessThanOrEqual(64);
      expect(envelope.root_lineage_id.length).toBeLessThanOrEqual(64);
      expect(envelope.evidence_refs[0].ref.length).toBeLessThanOrEqual(64);
      expect(canonicalJson(envelope)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
    }
  });

  it("supports high-RPE recovery risk with sample_days=0", async () => {
    const result = await discoverReportCandidates({
      workouts: [
        actual("rpe-1", "2026-07-10", 10, { rpe: 9 }),
        actual("rpe-2", "2026-07-11", 10, { rpe: 8 }),
      ],
      dailyNotes: [], races: [], memoryFacts: [],
    }, { now: INCIDENT_NOW, timeZone: "Asia/Shanghai" });
    const payload = result.candidates.find(candidate => candidate.signalKind === "recovery_risk_trend")?.typedPayload;
    expect(payload).toMatchObject({ sample_days: 0, poor_readiness_days: 0, high_rpe_sessions: 2 });
    expect(validateCandidateAgainstCatalog(result.candidates.find(candidate => candidate.signalKind === "recovery_risk_trend")).ok).toBe(true);
  });

  it("detects removing the final target race without exposing race identity", async () => {
    const result = await discoverReportCandidates({
      workouts: [], dailyNotes: [], memoryFacts: [],
      races: [{ id: "private-race-id", date: "2026-09-01", is_target: false, priority: "A", updated_at: "2026-07-14T03:00:00.000Z" }],
    }, { now: INCIDENT_NOW, timeZone: "Asia/Shanghai" });
    const payload = result.candidates.find(candidate => candidate.signalKind === "target_race_context_change")?.typedPayload;
    expect(payload).toEqual({
      type: "goal_context_change", signal_kind: "target_race_context_change", schema_version: "goal_context_change.v1",
      change_window: "2026-07-14", target_count: 0, nearest_target_days: null,
      priority_counts: { A: 0, B: 0, C: 0, unset: 0 },
    });
    expect(canonicalJson(payload)).not.toContain("private-race-id");
  });

  it("ignores malformed external dates instead of failing discovery", async () => {
    const features = await extractReportFeatures({
      races: [{ date: "2026-99-99", is_target: true, updated_at: "invalid" }],
      memoryFacts: [{ id: "bad", category: "training_preferences", status: "active", updated_at: "invalid" }],
    }, { now: INCIDENT_NOW, timeZone: "Asia/Shanghai" });
    expect(features.goalContext.nearestTargetDays).toBeNull();
    expect(features.goalContext.changedCount).toBe(0);
    expect(features.preference.changedCount).toBe(0);
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

  it("schedules all seven due live types in one Cron round", () => {
    const rows = REPORT_CATALOG.map((entry, index) => ({
      id: index + 1,
      report_type: entry.reportType,
      signal_kind: entry.signalKind,
      status: "idle",
      pending_envelope: null,
    }));
    const scheduled = scheduleLiveOutboxRuns(rows, { now, candidateWindow: true });
    expect(scheduled).toHaveLength(7);
    expect(scheduled.every(item => item.run.action === "discover")).toBe(true);
  });

  it("keeps blocked, retry, and discover work independent", () => {
    const rows = REPORT_CATALOG.map((entry, index) => ({
      id: index + 1,
      report_type: entry.reportType,
      signal_kind: entry.signalKind,
      status: "idle",
      pending_envelope: null,
    }));
    rows[0] = { ...rows[0], ...pending, status: "blocked" };
    rows[1] = { ...rows[1], ...pending, status: "retry_wait", next_attempt_at: "2026-07-14T23:00:00Z" };
    const actions = scheduleLiveOutboxRuns(rows, { now, candidateWindow: true }).map(item => item.run);
    expect(actions[0]).toEqual({ action: "skip", reason: "permanent_failure" });
    expect(actions[1]).toEqual({ action: "retry", reason: "retry_due" });
    expect(actions.slice(2).every(run => run.action === "discover")).toBe(true);
  });

  it("enforces each live type cadence from its last successful delivery", () => {
    const weekly = REPORT_CATALOG.find(entry => entry.maxFrequencyDays === 7);
    const delivered = { delivered_at: "2026-07-10T00:00:00.000Z" };
    expect(isLiveCadenceDue(delivered, weekly, { now })).toBe(false);
    expect(isLiveCadenceDue(delivered, weekly, { now: new Date("2026-07-17T00:00:00.000Z") })).toBe(true);
    expect(isLiveCadenceDue({}, weekly, { now })).toBe(true);
    expect(isLiveCadenceDue({ delivered_at: "invalid" }, weekly, { now })).toBe(false);

    const row = {
      report_type: weekly.reportType, signal_kind: weekly.signalKind,
      status: "delivered", pending_envelope: null, delivered_at: "2026-07-10T00:00:00.000Z",
    };
    const scheduled = scheduleLiveOutboxRuns([row], { now, candidateWindow: true })
      .find(item => item.entry === weekly);
    expect(scheduled.run).toEqual({ action: "skip", reason: "cadence_not_due" });
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

  it("treats recorded sensitive needs_user receipts as delivered", () => {
    expect(classifyIngressResult({
      status: 202,
      receipt: { status: "recorded", disposition: "needs_user" },
      attemptCount: 0,
    })).toEqual({ kind: "delivered" });
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

  it("preserves the deployed HMAC canonical message", () => {
    expect(buildReportSignatureMessage({
      path: "/functions/v1/aevum-agent-report-ingress",
      timestamp: 1784046600,
      bodyHash: "a".repeat(64),
    })).toBe(`POST\n/functions/v1/aevum-agent-report-ingress\nultreia\n1784046600\n${"a".repeat(64)}`);
  });
});
