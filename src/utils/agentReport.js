import { matchPlansToActuals } from "./planMatch.js";

export const REPORT_TYPE = "training_state_change";
export const SIGNAL_KIND = "repeated_plan_deviation";
export const LOOKBACK_DAYS = 14;

const DAY_MS = 86400000;

export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

export async function sha256Hex(value, cryptoImpl = globalThis.crypto) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await cryptoImpl.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function dateParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const get = type => parts.find(part => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function shiftDate(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function normalizeWorkout(row) {
  return {
    id: row.id,
    date: row.date,
    type: row.type,
    subTypes: Array.isArray(row.sub_types) ? row.sub_types : [],
    distance: row.distance,
    duration: row.duration,
    ascent: row.ascent,
    startedAt: row.started_at,
    isPlanned: row.is_planned === true,
    planStatus: row.plan_status,
    planDetail: row.plan_detail && typeof row.plan_detail === "object" ? row.plan_detail : null,
    updatedAt: row.updated_at,
  };
}

export function buildTrainingStateSource(rows, { now = new Date(), timeZone = "Asia/Shanghai" } = {}) {
  const today = dateParts(now, timeZone);
  const startDate = shiftDate(today, -LOOKBACK_DAYS);
  const endDate = shiftDate(today, -1);
  const workouts = (Array.isArray(rows) ? rows : []).map(normalizeWorkout)
    .filter(row => row.date >= startDate && row.date <= endDate)
    .sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));
  const plans = workouts.filter(row => row.isPlanned);
  const matches = matchPlansToActuals(plans, workouts, { isPast: true });
  const outcomes = matches.map(({ plan, outcome, ratio, actual }) => ({
    plan_id: plan.id,
    plan_updated_at: plan.updatedAt || null,
    actual_id: actual?.id || null,
    actual_updated_at: actual?.updatedAt || null,
    outcome,
    ratio: Number.isFinite(ratio) ? Number(ratio.toFixed(6)) : null,
    key_session: plan.planDetail?.keySession === true,
  })).sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));
  const counts = {
    planned: outcomes.length,
    done: outcomes.filter(item => item.outcome === "done").length,
    partial: outcomes.filter(item => item.outcome === "partial").length,
    missed: outcomes.filter(item => item.outcome === "missed").length,
    affected: outcomes.filter(item => item.outcome === "partial" || item.outcome === "missed").length,
    missed_key_sessions: outcomes.filter(item => item.outcome === "missed" && item.key_session).length,
  };
  return { today, startDate, endDate, workouts, outcomes, counts };
}

export async function buildTrainingStateCandidate(rows, options = {}) {
  const source = buildTrainingStateSource(rows, options);
  const sourceFingerprint = await sha256Hex(canonicalJson({
    window: { start_date: source.startDate, end_date: source.endDate },
    workouts: source.workouts,
    outcomes: source.outcomes,
  }), options.cryptoImpl);
  const triggered = source.counts.affected >= 2 || source.counts.missed_key_sessions >= 1;
  if (!triggered) return { sourceFingerprint, triggered: false, source, typedPayload: null, contentHash: null };
  const typedPayload = {
    type: REPORT_TYPE,
    signal_kind: SIGNAL_KIND,
    schema_version: "training_state_change.v1",
    window: { start_date: source.startDate, end_date: source.endDate, lookback_days: LOOKBACK_DAYS },
    counts: source.counts,
    affected_ratio: source.counts.planned ? Number((source.counts.affected / source.counts.planned).toFixed(6)) : 0,
    state: "active",
  };
  return {
    sourceFingerprint,
    triggered: true,
    source,
    typedPayload,
    contentHash: await sha256Hex(canonicalJson(typedPayload), options.cryptoImpl),
  };
}

export async function buildReportEnvelope(candidate, { reportedAt = new Date() } = {}) {
  if (!candidate?.triggered) return null;
  const identity = await sha256Hex(`${REPORT_TYPE}\n${SIGNAL_KIND}\n${candidate.sourceFingerprint}\n${candidate.contentHash}`);
  const reportId = `ultreia-${identity.slice(0, 40)}`;
  const sourceRef = `training-state-${candidate.sourceFingerprint.slice(0, 32)}`;
  const rootLineageId = `ultreia-training-${candidate.sourceFingerprint.slice(0, 30)}`;
  const occurredAt = `${candidate.source.endDate}T23:59:59.000Z`;
  const expiresAt = new Date(new Date(occurredAt).getTime() + 7 * DAY_MS).toISOString();
  return {
    id: reportId,
    contract_version: "agent_report.v1",
    source_product: "ultreia",
    source_ref: sourceRef,
    root_lineage_id: rootLineageId,
    causation_id: null,
    occurred_at: occurredAt,
    reported_at: reportedAt.toISOString(),
    evidence_type: "aggregate",
    evidence_refs: [{ product: "ultreia", ref: sourceRef, kind: "aggregate", root_lineage_id: rootLineageId }],
    sensitivity: "normal",
    confidence: 0.95,
    proposed_scopes: ["aevum"],
    retention_hint: "short",
    expires_at: expiresAt,
    content_hash: candidate.contentHash,
    typed_payload: candidate.typedPayload,
  };
}

export function containsForbiddenReportData(value, forbiddenValues = []) {
  const forbiddenKey = /(?:user_?id|email|workout|plan_?id|distance|pace|heart|rpe|note|memory|readiness|sick|pain|gps|weather|location|race)/i;
  let violation = false;
  const scan = current => {
    if (violation) return;
    if (Array.isArray(current)) return current.forEach(scan);
    if (current && typeof current === "object") {
      for (const [key, child] of Object.entries(current)) {
        if (forbiddenKey.test(key)) { violation = true; return; }
        scan(child);
      }
      return;
    }
    if (forbiddenValues.some(secret => secret != null && secret !== "" && String(current).includes(String(secret)))) violation = true;
  };
  scan(value);
  return violation;
}

export function decideCandidateAction(outbox, candidate) {
  if (candidate.sourceFingerprint === outbox?.observed_source_fingerprint) return "source_unchanged";
  if (!candidate.triggered) return "below_threshold";
  if (candidate.contentHash === outbox?.last_delivered_content_hash) return "content_already_delivered";
  return "persist_pending";
}

export function classifyIngressResult({ status, receipt, attemptCount = 0 }) {
  if (status >= 200 && status < 300 && ["recorded", "replayed", "duplicate"].includes(receipt?.status)) {
    return { kind: "delivered" };
  }
  if (status === 429 || status >= 500 || status === 0) {
    const delays = [30 * 60, 2 * 60 * 60, 6 * 60 * 60];
    return attemptCount + 1 >= 3
      ? { kind: "paused", delaySeconds: 24 * 60 * 60, attemptCount: attemptCount + 1 }
      : { kind: "retry", delaySeconds: delays[attemptCount] || delays.at(-1), attemptCount: attemptCount + 1 };
  }
  return { kind: "blocked", attemptCount: attemptCount + 1 };
}
