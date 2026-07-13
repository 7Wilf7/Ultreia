import { describe, expect, it } from "vitest";
import {
  buildReportEnvelope, buildTrainingStateCandidate, canonicalJson, classifyIngressResult,
  containsForbiddenReportData, decideCandidateAction,
} from "./agentReport";

const NOW = new Date("2026-07-12T04:00:00.000Z");
const plan = (id, date, extra = {}) => ({
  id, date, type: "Road Run", sub_types: ["Easy Run"], distance: 10,
  is_planned: true, plan_status: null, plan_detail: {}, updated_at: `${date}T01:00:00Z`, ...extra,
});
const actual = (id, date, distance = 10) => ({
  id, date, type: "Road Run", sub_types: ["Easy Run"], distance,
  is_planned: false, updated_at: `${date}T12:00:00Z`,
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

  it("covers all quiet-skip paths and retry receipt semantics", () => {
    const candidate = { sourceFingerprint: "source", triggered: true, contentHash: "content" };
    expect(decideCandidateAction({ observed_source_fingerprint: "source" }, candidate)).toBe("source_unchanged");
    expect(decideCandidateAction({}, { ...candidate, triggered: false })).toBe("below_threshold");
    expect(decideCandidateAction({ last_delivered_content_hash: "content" }, candidate)).toBe("content_already_delivered");
    expect(decideCandidateAction({}, candidate)).toBe("persist_pending");
    for (const status of ["recorded", "replayed", "duplicate"]) {
      expect(classifyIngressResult({ status: 200, receipt: { status } }).kind).toBe("delivered");
    }
    expect(classifyIngressResult({ status: 0, attemptCount: 0 })).toMatchObject({ kind: "retry", delaySeconds: 1800 });
    expect(classifyIngressResult({ status: 503, attemptCount: 2 }).kind).toBe("paused");
    expect(classifyIngressResult({ status: 422, attemptCount: 0 }).kind).toBe("blocked");
  });
});
