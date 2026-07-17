import { describe, expect, it, vi } from "vitest";
import {
  MAX_QUERY_BODY_BYTES,
  ULTREIA_CONTEXT_SECTIONS,
  assertNoForbiddenQueryKeys,
  assertQueryBodySize,
  authenticateQueryRequest,
  buildQueryResultFromLoader,
  buildQuerySignatureMessage,
  buildUltreiaContextResult,
  canonicalJson,
  deriveCurrentPhase,
  findForbiddenQueryKey,
  hmacSha256Hex,
  normalizeWeeklyTemplate,
  sha256Hex,
  validateUltreiaContextQuery,
  validateUltreiaContextResult,
} from "./agentQuery";

const NOW = new Date("2026-07-17T04:00:00.000Z");
const CAPTURED_AT = "2026-07-17T04:00:01.000Z";
const QUERY_ID = "aevum-query-b3-001";
const SECRET = "unit-test-query-secret";

function request(overrides = {}) {
  return {
    id: QUERY_ID,
    contract_version: "agent_query.v1",
    requester_product: "aevum",
    owner_product: "ultreia",
    query_type: "training_context_snapshot",
    schema_version: "training_context_snapshot.request.v1",
    requested_at: NOW.toISOString(),
    sections: [...ULTREIA_CONTEXT_SECTIONS],
    ...overrides,
  };
}

function headers(timestamp, signature) {
  return new Headers({
    "x-aevum-source": "aevum",
    "x-aevum-timestamp": String(timestamp),
    "x-aevum-signature": signature,
  });
}

async function signedRequest(input = request(), { secret = SECRET, timestamp = Math.floor(NOW.getTime() / 1000) } = {}) {
  const rawBody = new TextEncoder().encode(JSON.stringify(input));
  const bodyHash = await sha256Hex(rawBody);
  const signature = await hmacSha256Hex(secret, buildQuerySignatureMessage(timestamp, bodyHash));
  return { rawBody, headers: headers(timestamp, signature) };
}

function baseSnapshot(overrides = {}) {
  return {
    races: [],
    settings: null,
    preferenceFacts: [],
    workouts: [],
    ...overrides,
  };
}

describe("Agent Query authentication and request contract", () => {
  it("accepts an exact signed request", async () => {
    const signed = await signedRequest();
    await expect(authenticateQueryRequest({ ...signed, secret: SECRET, now: NOW })).resolves.toEqual(request());
    expect(validateUltreiaContextQuery(request(), { now: NOW })).toEqual(request());
  });

  it("rejects a wrong HMAC before accepting the query", async () => {
    const signed = await signedRequest();
    const bad = headers(Math.floor(NOW.getTime() / 1000), "0".repeat(64));
    await expect(authenticateQueryRequest({ ...signed, headers: bad, secret: SECRET, now: NOW }))
      .rejects.toMatchObject({ code: "invalid_signature", status: 401 });
  });

  it("rejects stale header and request timestamps", async () => {
    const staleTimestamp = Math.floor(NOW.getTime() / 1000) - 301;
    const signed = await signedRequest(request({ requested_at: new Date(NOW.getTime() - 301000).toISOString() }), {
      timestamp: staleTimestamp,
    });
    await expect(authenticateQueryRequest({ ...signed, secret: SECRET, now: NOW }))
      .rejects.toMatchObject({ code: "stale_signature" });
    expect(() => validateUltreiaContextQuery(
      request({ requested_at: new Date(NOW.getTime() + 301000).toISOString() }),
      { now: NOW },
    )).toThrow("stale_query");
  });

  it("rejects bodies above 64 KiB", () => {
    expect(() => assertQueryBodySize(new Uint8Array(MAX_QUERY_BODY_BYTES + 1))).toThrow("request_too_large");
  });

  it("rejects extra keys, wrong section order, and UUID-like ids", () => {
    expect(() => validateUltreiaContextQuery(request({ extra: true }), { now: NOW })).toThrow("invalid_query");
    expect(() => validateUltreiaContextQuery(request({ sections: [...ULTREIA_CONTEXT_SECTIONS].reverse() }), { now: NOW }))
      .toThrow("invalid_query");
    expect(() => validateUltreiaContextQuery(request({ id: "123e4567-e89b-42d3-a456-426614174000" }), { now: NOW }))
      .toThrow("invalid_query");
  });
});

describe("privacy-trimmed context snapshot", () => {
  it("returns exactly weekly preference and training state when no target exists", async () => {
    const result = await buildUltreiaContextResult(baseSnapshot(), { queryId: QUERY_ID, capturedAt: CAPTURED_AT });
    expect(result.facts.map(fact => fact.fact_type)).toEqual(["weekly_training_preference", "training_state"]);
    await expect(validateUltreiaContextResult(result)).resolves.toBe(result);
  });

  it("always emits seven allowlisted weekly slots", () => {
    const weekly = normalizeWeeklyTemplate({
      trainingPreferences: {
        weeklyTemplate: {
          0: { am: "road_run", pm: "unknown-private-value" },
          6: { am: "rest", pm: "mobility" },
        },
      },
    });
    expect(weekly).toHaveLength(7);
    expect(weekly.map(row => row.day)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(weekly[0]).toEqual({ day: 0, am: "road_run", pm: null });
    expect(weekly[6]).toEqual({ day: 6, am: "rest", pm: "mobility" });
  });

  it("hashes target ids locally and excludes locations and internal ids", async () => {
    const privateId = "123e4567-e89b-42d3-a456-426614174000";
    const result = await buildUltreiaContextResult(baseSnapshot({
      races: [{
        id: privateId,
        name: "Mountain 50K",
        date: "2026-09-20",
        priority: "A",
        distance: 50,
        ascent: 3200,
        category: "Trail",
        is_target: true,
        updated_at: "2026-07-15T02:00:00.000Z",
        location: "private place",
      }],
    }), { queryId: QUERY_ID, capturedAt: CAPTURED_AT });
    const target = result.facts.find(fact => fact.fact_type === "target_race");
    expect(target.fact_key).toMatch(/^target:[0-9a-f]{24}$/);
    expect(JSON.stringify(target)).not.toContain(privateId);
    expect(JSON.stringify(target)).not.toContain("private place");
    expect(Object.keys(target.content).sort()).toEqual([
      "ascent_m", "category", "date", "distance_km", "name", "priority",
    ]);
  });

  it("only emits active training preference summaries without refs or metadata", async () => {
    const privateId = "223e4567-e89b-42d3-a456-426614174000";
    const result = await buildUltreiaContextResult(baseSnapshot({
      preferenceFacts: [
        {
          id: privateId,
          category: "training_preferences",
          status: "active",
          content_en: "  Long run on Saturday.  ",
          content_zh: "  周六长距离。  ",
          updated_at: "2026-07-16T02:00:00.000Z",
          source_ref_id: "private-ref",
          metadata: { private: true },
        },
        { id: "health", category: "injury_health", status: "active", content_en: "knee", updated_at: "2026-07-16T02:00:00.000Z" },
        { id: "archived", category: "training_preferences", status: "archived", content_en: "old", updated_at: "2026-07-16T02:00:00.000Z" },
        { id: "empty", category: "training_preferences", status: "active", content_en: " ", content_zh: "", updated_at: "2026-07-16T02:00:00.000Z" },
      ],
    }), { queryId: QUERY_ID, capturedAt: CAPTURED_AT });
    const preferences = result.facts.filter(fact => fact.fact_type === "training_preference_fact");
    expect(preferences).toHaveLength(1);
    expect(preferences[0].content).toEqual({
      category: "training_preferences",
      summary_en: "Long run on Saturday.",
      summary_zh: "周六长距离。",
    });
    expect(JSON.stringify(preferences[0])).not.toContain(privateId);
    expect(JSON.stringify(preferences[0])).not.toContain("private-ref");
    expect(JSON.stringify(preferences[0])).not.toContain("metadata");
  });

  it("uses the 28 completed local dates and completed rows for totals", async () => {
    const result = await buildUltreiaContextResult(baseSnapshot({
      workouts: [
        { id: "p1", date: "2026-06-19", distance: 10, duration: 3600, ascent: 100, is_planned: true, plan_status: null, plan_detail: {}, updated_at: "2026-06-19T01:00:00.000Z" },
        { id: "a1", date: "2026-06-19", distance: 8, duration: 3000, ascent: 80, is_planned: false, updated_at: "2026-06-19T03:00:00.000Z" },
        { id: "p2", date: "2026-07-16", distance: 10, duration: 3600, ascent: 100, is_planned: true, plan_status: null, plan_detail: {}, updated_at: "2026-07-16T01:00:00.000Z" },
        { id: "old", date: "2026-06-18", distance: 99, duration: 9999, ascent: 999, is_planned: false, updated_at: "2026-06-18T01:00:00.000Z" },
        { id: "today", date: "2026-07-17", distance: 99, duration: 9999, ascent: 999, is_planned: false, updated_at: "2026-07-17T01:00:00.000Z" },
      ],
    }), { queryId: QUERY_ID, capturedAt: CAPTURED_AT });
    const state = result.facts.find(fact => fact.fact_type === "training_state").content;
    expect(state.window).toEqual({ start_date: "2026-06-19", end_date: "2026-07-16", lookback_days: 28 });
    expect(state.sessions).toEqual({ planned: 2, done: 1, partial: 0, missed: 1 });
    expect(state.totals).toEqual({ duration_minutes: 50, distance_km: 8, ascent_m: 80 });
  });

  it("derives the nearest target and current phase at Coach thresholds", async () => {
    expect([null, 63, 62, 35, 34, 21, 20, 7, 6, 0].map(deriveCurrentPhase)).toEqual([
      "unstructured", "base", "build", "build", "peak", "peak", "taper", "taper", "race", "race",
    ]);
    const result = await buildUltreiaContextResult(baseSnapshot({
      races: [{ id: "race-a", name: "Target", date: "2026-08-21", priority: "A", distance: 50, ascent: 1000, category: "Trail", is_target: true, updated_at: "2026-07-16T01:00:00.000Z" }],
    }), { queryId: QUERY_ID, capturedAt: CAPTURED_AT });
    const state = result.facts.find(fact => fact.fact_type === "training_state").content;
    expect(state.days_to_nearest_target).toBe(35);
    expect(state.current_phase).toBe("build");
  });

  it("keeps ordering and source_version stable under source row reordering", async () => {
    const source = baseSnapshot({
      races: [
        { id: "r1", name: "One", date: "2026-09-01", priority: "A", distance: 50, ascent: 2000, category: "Trail", is_target: true, updated_at: "2026-07-15T01:00:00.000Z" },
        { id: "r2", name: "Two", date: "2026-10-01", priority: "B", distance: 100, ascent: 5000, category: "Trail", is_target: true, updated_at: "2026-07-15T02:00:00.000Z" },
      ],
      preferenceFacts: [
        { id: "f1", category: "training_preferences", status: "active", content_en: "A", content_zh: null, updated_at: "2026-07-15T03:00:00.000Z" },
        { id: "f2", category: "training_preferences", status: "active", content_en: "B", content_zh: null, updated_at: "2026-07-15T04:00:00.000Z" },
      ],
    });
    const first = await buildUltreiaContextResult(source, { queryId: QUERY_ID, capturedAt: CAPTURED_AT });
    const second = await buildUltreiaContextResult({
      ...source,
      races: [...source.races].reverse(),
      preferenceFacts: [...source.preferenceFacts].reverse(),
    }, { queryId: QUERY_ID, capturedAt: CAPTURED_AT });
    expect(second.facts).toEqual(first.facts);
    expect(second.source_version).toBe(first.source_version);
    expect(first.facts.map(fact => fact.fact_key)).toEqual([...first.facts.map(fact => fact.fact_key)].sort());
  });

  it("never emits source_updated_at after captured_at", async () => {
    const result = await buildUltreiaContextResult(baseSnapshot({
      settings: { coach_config: {}, updated_at: "2026-07-18T00:00:00.000Z" },
      workouts: [{ id: "future-ts", date: "2026-07-16", is_planned: false, updated_at: "2026-07-18T00:00:00.000Z" }],
    }), { queryId: QUERY_ID, capturedAt: CAPTURED_AT });
    expect(result.facts.every(fact => fact.source_updated_at <= result.captured_at)).toBe(true);
  });

  it("finds forbidden response keys while allowing required omission sentinels", async () => {
    const result = await buildUltreiaContextResult(baseSnapshot(), { queryId: QUERY_ID, capturedAt: CAPTURED_AT });
    expect(findForbiddenQueryKey(result)).toBeNull();
    expect(() => assertNoForbiddenQueryKeys({ ...result, user_id: "private" })).toThrow("forbidden_query_field");
    expect(() => assertNoForbiddenQueryKeys({ ...result, facts: [{ location: "private" }] })).toThrow("forbidden_query_field");
    expect(() => assertNoForbiddenQueryKeys({ ...result, facts: [{ latitude: 31.2 }] })).toThrow("forbidden_query_field");
    expect(() => assertNoForbiddenQueryKeys({ ...result, facts: [{ longitude: 121.4 }] })).toThrow("forbidden_query_field");
  });

  it("does not create a partial or synthetic result when a source read fails", async () => {
    const loader = vi.fn().mockRejectedValue(new Error("database unavailable"));
    await expect(buildQueryResultFromLoader(request(), loader, { nowFactory: () => new Date(CAPTURED_AT) }))
      .rejects.toThrow("database unavailable");
    expect(loader).toHaveBeenCalledOnce();
  });

  it("fails closed if source reads cross the Asia/Shanghai day boundary", async () => {
    await expect(buildQueryResultFromLoader(request(), async () => baseSnapshot(), {
      referenceNow: new Date("2026-07-16T15:59:59.900Z"),
      nowFactory: () => new Date("2026-07-16T16:00:00.100Z"),
      timeZone: "Asia/Shanghai",
    })).rejects.toThrow("snapshot_boundary_crossed");
  });

  it("matches the current Aevum result validator when that checkout is available", async () => {
    const result = await buildUltreiaContextResult(baseSnapshot(), { queryId: QUERY_ID, capturedAt: CAPTURED_AT });
    let aevum = null;
    try {
      const contractUrl = new URL("../../../Aevum/src/core/agentQuery.js", import.meta.url);
      aevum = await import(/* @vite-ignore */ contractUrl.href);
    } catch {
      // The repository is optional in CI; Ultreia's mirrored validator remains mandatory above.
    }
    if (aevum) await expect(aevum.validateUltreiaContextResult(result)).resolves.toBe(result);
  });
});

describe("canonical JSON", () => {
  it("sorts object keys recursively and preserves array order", () => {
    expect(canonicalJson({ z: [{ b: 2, a: 1 }], a: true })).toBe('{"a":true,"z":[{"a":1,"b":2}]}');
  });
});
