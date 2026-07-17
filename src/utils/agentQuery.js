import { matchPlansToActuals } from "./planMatch.js";

export const AGENT_QUERY_CONTRACT_VERSION = "agent_query.v1";
export const AGENT_QUERY_RESULT_CONTRACT_VERSION = "agent_query_result.v1";
export const ULTREIA_CONTEXT_QUERY_TYPE = "training_context_snapshot";
export const ULTREIA_CONTEXT_REQUEST_SCHEMA = "training_context_snapshot.request.v1";
export const ULTREIA_CONTEXT_RESULT_SCHEMA = "training_context_snapshot.result.v1";
export const ULTREIA_CONTEXT_SECTIONS = Object.freeze([
  "goals",
  "training_preferences",
  "training_state",
]);
export const MAX_QUERY_BODY_BYTES = 64 * 1024;
export const MAX_QUERY_SKEW_SECONDS = 300;
export const ULTREIA_QUERY_PATH = "/functions/v1/ultreia-agent-query";

const ULTREIA_QUERY_RUNTIME_PATHS = new Set([
  "/ultreia-agent-query",
  ULTREIA_QUERY_PATH,
]);

export function isAllowedUltreiaQueryRuntimePath(pathname) {
  return typeof pathname === "string" && ULTREIA_QUERY_RUNTIME_PATHS.has(pathname);
}

const REQUEST_KEYS = Object.freeze([
  "id", "contract_version", "requester_product", "owner_product", "query_type",
  "schema_version", "requested_at", "sections",
]);
const RESULT_KEYS = Object.freeze([
  "query_id", "contract_version", "source_product", "query_type", "schema_version",
  "captured_at", "source_version", "facts", "omissions",
]);
const FACT_KEYS = Object.freeze([
  "fact_key", "fact_type", "source_updated_at", "confidence", "content",
]);
const WEEKLY_VALUES = new Set([
  "rest", "road_run", "trail_run", "strength", "hiit", "mobility",
]);
const TRAINING_PHASES = new Set([
  "base", "build", "peak", "taper", "race", "recovery", "unstructured",
]);
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const FORBIDDEN_KEY_PATTERN = /(?:user_?id|(?:^|_)id(?:_|$)|uuid|gps|latitude|longitude|(?:^|_)lat(?:_|$)|(?:^|_)lng(?:_|$)|location|note|health|injury|readiness|source_?ref|metadata|raw)/i;
const REQUIRED_OMISSION_KEYS = new Set([
  "sensitive_health_context", "raw_workouts", "gps_and_locations", "private_notes",
]);

export class QueryResponderError extends Error {
  constructor(code, status = 422) {
    super(code);
    this.name = "QueryResponderError";
    this.code = code;
    this.status = status;
  }
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function bytes(value) {
  return value instanceof Uint8Array ? value : new TextEncoder().encode(String(value));
}

function hex(buffer) {
  return [...new Uint8Array(buffer)].map(value => value.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(value, cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl?.subtle) throw new QueryResponderError("crypto_unavailable", 503);
  return hex(await cryptoImpl.subtle.digest("SHA-256", bytes(value)));
}

export async function hmacSha256Hex(secret, value, cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl?.subtle) throw new QueryResponderError("crypto_unavailable", 503);
  const key = await cryptoImpl.subtle.importKey(
    "raw",
    bytes(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await cryptoImpl.subtle.sign("HMAC", key, bytes(value)));
}

export function constantTimeEqualHex(left, right) {
  if (!SHA256_PATTERN.test(left || "") || !SHA256_PATTERN.test(right || "")) return false;
  let mismatch = 0;
  for (let index = 0; index < 64; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

export function buildQuerySignatureMessage(timestamp, bodyHash) {
  return ["POST", ULTREIA_QUERY_PATH, "aevum", String(timestamp), bodyHash].join("\n");
}

export function assertQueryBodySize(rawBody) {
  if (bytes(rawBody).byteLength > MAX_QUERY_BODY_BYTES) {
    throw new QueryResponderError("request_too_large", 413);
  }
}

export function validateUltreiaContextQuery(input, { now = new Date() } = {}) {
  requirePlainObject(input, "invalid_query");
  requireExactKeys(input, REQUEST_KEYS, "invalid_query");
  if (!validOpaqueKey(input.id)
    || input.contract_version !== AGENT_QUERY_CONTRACT_VERSION
    || input.requester_product !== "aevum"
    || input.owner_product !== "ultreia"
    || input.query_type !== ULTREIA_CONTEXT_QUERY_TYPE
    || input.schema_version !== ULTREIA_CONTEXT_REQUEST_SCHEMA
    || !isIsoTimestamp(input.requested_at)
    || canonicalJson(input.sections) !== canonicalJson(ULTREIA_CONTEXT_SECTIONS)) {
    throw new QueryResponderError("invalid_query", 422);
  }
  const skew = Math.abs(Date.parse(input.requested_at) - toDate(now, "invalid_query").getTime());
  if (skew > MAX_QUERY_SKEW_SECONDS * 1000) throw new QueryResponderError("stale_query", 401);
  return input;
}

export async function authenticateQueryRequest({ rawBody, headers, secret, now = new Date(), cryptoImpl }) {
  assertQueryBodySize(rawBody);
  const source = headers.get("x-aevum-source") || "";
  const timestamp = headers.get("x-aevum-timestamp") || "";
  const signature = headers.get("x-aevum-signature") || "";
  if (source !== "aevum" || !/^\d+$/.test(timestamp) || !SHA256_PATTERN.test(signature)) {
    throw new QueryResponderError("invalid_signature", 401);
  }
  const nowMs = toDate(now, "invalid_query").getTime();
  if (Math.abs(Number(timestamp) * 1000 - nowMs) > MAX_QUERY_SKEW_SECONDS * 1000) {
    throw new QueryResponderError("stale_signature", 401);
  }
  const bodyHash = await sha256Hex(bytes(rawBody), cryptoImpl);
  const expected = await hmacSha256Hex(secret, buildQuerySignatureMessage(timestamp, bodyHash), cryptoImpl);
  if (!constantTimeEqualHex(signature, expected)) throw new QueryResponderError("invalid_signature", 401);
  let input;
  try {
    input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes(rawBody)));
  } catch {
    throw new QueryResponderError("invalid_json", 400);
  }
  return validateUltreiaContextQuery(input, { now });
}

export function localDateKey(value, timeZone = "Asia/Shanghai") {
  const date = toDate(value, "invalid_date");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

export function shiftDateKey(dateKey, days) {
  if (!isDateKey(dateKey) || !Number.isInteger(days)) throw new QueryResponderError("invalid_date", 422);
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function dateKeyDiff(fromDate, toDate) {
  if (!isDateKey(fromDate) || !isDateKey(toDate)) throw new QueryResponderError("invalid_date", 422);
  return Math.round((Date.parse(`${toDate}T00:00:00.000Z`) - Date.parse(`${fromDate}T00:00:00.000Z`)) / 86400000);
}

export function normalizeWeeklyTemplate(coachConfig) {
  const source = coachConfig?.trainingPreferences?.weeklyTemplate;
  return Array.from({ length: 7 }, (_, day) => {
    const entry = source && typeof source === "object" ? source[String(day)] : null;
    const normalizeSlot = value => WEEKLY_VALUES.has(value) ? value : null;
    return { day, am: normalizeSlot(entry?.am), pm: normalizeSlot(entry?.pm) };
  });
}

export function deriveCurrentPhase(daysToTarget) {
  if (!Number.isInteger(daysToTarget) || daysToTarget < 0) return "unstructured";
  if (daysToTarget >= 63) return "base";
  if (daysToTarget >= 35) return "build";
  if (daysToTarget >= 21) return "peak";
  if (daysToTarget >= 7) return "taper";
  return "race";
}

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function nonnegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function nullableBoundedNumber(value, maximum, integer = false) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > maximum) return null;
  return integer ? Math.round(number) : number;
}

function trimmed(value, maximum) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function safeTimestamp(value, capturedAt) {
  if (!isIsoTimestamp(value) || Date.parse(value) > Date.parse(capturedAt)) return capturedAt;
  return value;
}

function greatestTimestamp(rows, capturedAt) {
  const valid = rows
    .map(row => row?.updated_at)
    .filter(value => isIsoTimestamp(value) && Date.parse(value) <= Date.parse(capturedAt))
    .sort();
  return valid.at(-1) || capturedAt;
}

function normalizeMatchRow(row) {
  const planDetail = row?.plan_detail && typeof row.plan_detail === "object" ? row.plan_detail : {};
  const timeOfDay = ["am", "pm"].includes(planDetail.timeOfDay) ? planDetail.timeOfDay : undefined;
  return {
    id: row?.id,
    date: row?.date,
    type: "training",
    distance: nonnegativeNumber(row?.distance),
    duration: nonnegativeNumber(row?.duration),
    ascent: nonnegativeNumber(row?.ascent),
    isPlanned: row?.is_planned === true,
    planStatus: row?.plan_status === "done" ? "done" : null,
    planDetail: timeOfDay ? { timeOfDay } : {},
  };
}

function buildTrainingState(workouts, races, today, capturedAt) {
  const startDate = shiftDateKey(today, -28);
  const endDate = shiftDateKey(today, -1);
  const safeRows = (Array.isArray(workouts) ? workouts : [])
    .filter(row => isDateKey(row?.date) && row.date >= startDate && row.date <= endDate);
  const normalized = safeRows.map(normalizeMatchRow);
  const plans = normalized.filter(row => row.isPlanned);
  const actuals = normalized.filter(row => !row.isPlanned);
  const outcomes = matchPlansToActuals(plans, actuals, { isPast: true });
  const sessions = { planned: plans.length, done: 0, partial: 0, missed: 0 };
  outcomes.forEach(result => {
    if (result?.outcome in sessions && result.outcome !== "planned") sessions[result.outcome] += 1;
  });
  const targetDates = (Array.isArray(races) ? races : [])
    .filter(row => row?.is_target === true && isDateKey(row?.date) && row.date >= today)
    .map(row => row.date)
    .sort();
  const daysToTarget = targetDates.length ? dateKeyDiff(today, targetDates[0]) : null;
  const usedRows = [...safeRows];
  if (targetDates.length) {
    const nearestRace = races.find(row => row?.is_target === true && row.date === targetDates[0]);
    if (nearestRace) usedRows.push(nearestRace);
  }
  return {
    sourceUpdatedAt: greatestTimestamp(usedRows, capturedAt),
    content: {
      window: { start_date: startDate, end_date: endDate, lookback_days: 28 },
      sessions,
      totals: {
        duration_minutes: round2(actuals.reduce((sum, row) => sum + row.duration, 0) / 60),
        distance_km: round2(actuals.reduce((sum, row) => sum + row.distance, 0)),
        ascent_m: Math.round(actuals.reduce((sum, row) => sum + row.ascent, 0)),
      },
      current_phase: deriveCurrentPhase(daysToTarget),
      days_to_nearest_target: daysToTarget,
    },
  };
}

export async function buildUltreiaContextResult(snapshot, {
  queryId,
  capturedAt = new Date().toISOString(),
  timeZone = "Asia/Shanghai",
  cryptoImpl,
} = {}) {
  if (!validOpaqueKey(queryId) || !isIsoTimestamp(capturedAt)) {
    throw new QueryResponderError("invalid_query_result", 422);
  }
  const races = Array.isArray(snapshot?.races) ? snapshot.races : [];
  const preferenceFacts = Array.isArray(snapshot?.preferenceFacts) ? snapshot.preferenceFacts : [];
  const today = localDateKey(capturedAt, timeZone);
  const facts = [];

  for (const race of races) {
    if (race?.is_target !== true || !isDateKey(race?.date) || race.date < today || !race.id) continue;
    const digest = await sha256Hex(`aevum-query-target:${race.id}`, cryptoImpl);
    facts.push({
      fact_key: `target:${digest.slice(0, 24)}`,
      fact_type: "target_race",
      source_updated_at: safeTimestamp(race.updated_at, capturedAt),
      confidence: 1,
      content: {
        name: trimmed(race.name, 120),
        date: race.date,
        priority: ["A", "B", "C"].includes(race.priority) ? race.priority : null,
        distance_km: nullableBoundedNumber(race.distance, 1000),
        ascent_m: nullableBoundedNumber(race.ascent, 30000, true),
        category: trimmed(race.category, 80),
      },
    });
  }

  facts.push({
    fact_key: "preference:weekly",
    fact_type: "weekly_training_preference",
    source_updated_at: safeTimestamp(snapshot?.settings?.updated_at, capturedAt),
    confidence: 1,
    content: { weekly_template: normalizeWeeklyTemplate(snapshot?.settings?.coach_config) },
  });

  for (const fact of preferenceFacts) {
    if (fact?.category !== "training_preferences" || fact?.status !== "active" || !fact.id) continue;
    const summaryEn = trimmed(fact.content_en, 500) || null;
    const summaryZh = trimmed(fact.content_zh, 500) || null;
    if (!summaryEn && !summaryZh) continue;
    const digest = await sha256Hex(`aevum-query-preference:${fact.id}`, cryptoImpl);
    facts.push({
      fact_key: `preference:fact:${digest.slice(0, 24)}`,
      fact_type: "training_preference_fact",
      source_updated_at: safeTimestamp(fact.updated_at, capturedAt),
      confidence: 0.95,
      content: { category: "training_preferences", summary_en: summaryEn, summary_zh: summaryZh },
    });
  }

  const state = buildTrainingState(snapshot?.workouts, races, today, capturedAt);
  facts.push({
    fact_key: "state:current",
    fact_type: "training_state",
    source_updated_at: state.sourceUpdatedAt,
    confidence: 1,
    content: state.content,
  });
  facts.sort((left, right) => left.fact_key.localeCompare(right.fact_key));
  if (facts.length > 100) throw new QueryResponderError("too_many_query_facts", 500);

  const omissions = {
    sensitive_health_context: "omitted",
    raw_workouts: "omitted",
    gps_and_locations: "omitted",
    private_notes: "omitted",
  };
  const result = {
    query_id: queryId,
    contract_version: AGENT_QUERY_RESULT_CONTRACT_VERSION,
    source_product: "ultreia",
    query_type: ULTREIA_CONTEXT_QUERY_TYPE,
    schema_version: ULTREIA_CONTEXT_RESULT_SCHEMA,
    captured_at: capturedAt,
    source_version: await sha256Hex(canonicalJson({ facts, omissions }), cryptoImpl),
    facts,
    omissions,
  };
  await validateUltreiaContextResult(result, { cryptoImpl });
  assertNoForbiddenQueryKeys(result);
  return result;
}

export async function buildQueryResultFromLoader(query, loadSnapshot, options = {}) {
  const snapshot = await loadSnapshot();
  const capturedAt = toDate(options.nowFactory?.() || new Date(), "invalid_query_result").toISOString();
  if (options.referenceNow
    && localDateKey(options.referenceNow, options.timeZone) !== localDateKey(capturedAt, options.timeZone)) {
    throw new QueryResponderError("snapshot_boundary_crossed", 500);
  }
  return buildUltreiaContextResult(snapshot, {
    queryId: query.id,
    capturedAt,
    timeZone: options.timeZone,
    cryptoImpl: options.cryptoImpl,
  });
}

export async function validateUltreiaContextResult(input, { cryptoImpl } = {}) {
  requirePlainObject(input, "invalid_query_result");
  requireExactKeys(input, RESULT_KEYS, "invalid_query_result");
  if (!validOpaqueKey(input.query_id)
    || input.contract_version !== AGENT_QUERY_RESULT_CONTRACT_VERSION
    || input.source_product !== "ultreia"
    || input.query_type !== ULTREIA_CONTEXT_QUERY_TYPE
    || input.schema_version !== ULTREIA_CONTEXT_RESULT_SCHEMA
    || !isIsoTimestamp(input.captured_at)
    || !SHA256_PATTERN.test(input.source_version || "")
    || !Array.isArray(input.facts)
    || input.facts.length < 2
    || input.facts.length > 100) throw new QueryResponderError("invalid_query_result", 422);
  requireExactKeys(input.omissions, [...REQUIRED_OMISSION_KEYS], "invalid_query_result");
  if (!Object.values(input.omissions).every(value => value === "omitted")) {
    throw new QueryResponderError("invalid_query_result", 422);
  }
  let previous = "";
  let states = 0;
  let weekly = 0;
  for (const fact of input.facts) {
    validateFact(fact, input.captured_at);
    if (fact.fact_key <= previous) throw new QueryResponderError("invalid_query_result", 422);
    previous = fact.fact_key;
    if (fact.fact_type === "training_state") states += 1;
    if (fact.fact_type === "weekly_training_preference") weekly += 1;
  }
  if (states !== 1 || weekly !== 1) throw new QueryResponderError("invalid_query_result", 422);
  const expected = await sha256Hex(canonicalJson({ facts: input.facts, omissions: input.omissions }), cryptoImpl);
  if (expected !== input.source_version) throw new QueryResponderError("source_version_mismatch", 422);
  return input;
}

function validateFact(fact, capturedAt) {
  requirePlainObject(fact, "invalid_query_result");
  requireExactKeys(fact, FACT_KEYS, "invalid_query_result");
  if (!validOpaqueKey(fact.fact_key) || !isIsoTimestamp(fact.source_updated_at)
    || Date.parse(fact.source_updated_at) > Date.parse(capturedAt)
    || typeof fact.confidence !== "number" || fact.confidence < 0.9 || fact.confidence > 1) {
    throw new QueryResponderError("invalid_query_result", 422);
  }
  if (fact.fact_type === "target_race") return validateTargetRace(fact.content, capturedAt);
  if (fact.fact_type === "weekly_training_preference") return validateWeeklyPreference(fact.content);
  if (fact.fact_type === "training_preference_fact") return validatePreferenceFact(fact.content);
  if (fact.fact_type === "training_state") return validateTrainingState(fact.content);
  throw new QueryResponderError("unsupported_query_fact", 422);
}

function validateTargetRace(content, capturedAt) {
  requirePlainObject(content, "invalid_query_result");
  requireExactKeys(content, ["name", "date", "priority", "distance_km", "ascent_m", "category"], "invalid_query_result");
  if (!validText(content.name, 1, 120) || !isDateKey(content.date) || content.date < capturedAt.slice(0, 10)
    || !["A", "B", "C", null].includes(content.priority)
    || !nullableNumber(content.distance_km, 0, 1000) || !nullableInteger(content.ascent_m, 0, 30000)
    || !validText(content.category, 0, 80)) throw new QueryResponderError("invalid_query_result", 422);
}

function validateWeeklyPreference(content) {
  requirePlainObject(content, "invalid_query_result");
  requireExactKeys(content, ["weekly_template"], "invalid_query_result");
  if (!Array.isArray(content.weekly_template) || content.weekly_template.length !== 7) {
    throw new QueryResponderError("invalid_query_result", 422);
  }
  content.weekly_template.forEach((entry, day) => {
    requirePlainObject(entry, "invalid_query_result");
    requireExactKeys(entry, ["day", "am", "pm"], "invalid_query_result");
    if (entry.day !== day || ![...WEEKLY_VALUES, null].includes(entry.am) || ![...WEEKLY_VALUES, null].includes(entry.pm)) {
      throw new QueryResponderError("invalid_query_result", 422);
    }
  });
}

function validatePreferenceFact(content) {
  requirePlainObject(content, "invalid_query_result");
  requireExactKeys(content, ["category", "summary_en", "summary_zh"], "invalid_query_result");
  if (content.category !== "training_preferences" || !nullableText(content.summary_en, 500)
    || !nullableText(content.summary_zh, 500) || ![content.summary_en, content.summary_zh].some(value => String(value || "").trim())) {
    throw new QueryResponderError("invalid_query_result", 422);
  }
}

function validateTrainingState(content) {
  requirePlainObject(content, "invalid_query_result");
  requireExactKeys(content, ["window", "sessions", "totals", "current_phase", "days_to_nearest_target"], "invalid_query_result");
  requirePlainObject(content.window, "invalid_query_result");
  requireExactKeys(content.window, ["start_date", "end_date", "lookback_days"], "invalid_query_result");
  requirePlainObject(content.sessions, "invalid_query_result");
  requireExactKeys(content.sessions, ["planned", "done", "partial", "missed"], "invalid_query_result");
  requirePlainObject(content.totals, "invalid_query_result");
  requireExactKeys(content.totals, ["duration_minutes", "distance_km", "ascent_m"], "invalid_query_result");
  const sessions = Object.values(content.sessions);
  if (!isDateKey(content.window.start_date) || !isDateKey(content.window.end_date) || content.window.lookback_days !== 28
    || !sessions.every(value => integerInRange(value, 0, 10000))
    || content.sessions.done + content.sessions.partial + content.sessions.missed > content.sessions.planned
    || !numberInRange(content.totals.duration_minutes, 0, 1000000)
    || !numberInRange(content.totals.distance_km, 0, 1000000)
    || !integerInRange(content.totals.ascent_m, 0, 10000000)
    || !TRAINING_PHASES.has(content.current_phase)
    || !nullableInteger(content.days_to_nearest_target, 0, 3650)) {
    throw new QueryResponderError("invalid_query_result", 422);
  }
}

export function findForbiddenQueryKey(value, path = []) {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findForbiddenQueryKey(value[index], [...path, String(index)]);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value)) {
    const isRequiredOmission = path.length === 1 && path[0] === "omissions" && REQUIRED_OMISSION_KEYS.has(key);
    if (key !== "query_id" && !isRequiredOmission && FORBIDDEN_KEY_PATTERN.test(key)) return [...path, key].join(".");
    const found = findForbiddenQueryKey(child, [...path, key]);
    if (found) return found;
  }
  return null;
}

export function assertNoForbiddenQueryKeys(value) {
  const path = findForbiddenQueryKey(value);
  if (path) throw new QueryResponderError("forbidden_query_field", 500);
  const uuidPath = findUuidValue(value);
  if (uuidPath) throw new QueryResponderError("forbidden_query_value", 500);
  return value;
}

function findUuidValue(value, path = []) {
  if (typeof value === "string") return UUID_PATTERN.test(value) ? path.join(".") || "root" : null;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findUuidValue(value[index], [...path, String(index)]);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value)) {
    const found = findUuidValue(child, [...path, key]);
    if (found) return found;
  }
  return null;
}

function validOpaqueKey(value) {
  return validText(value, 1, 96) && /^[a-z0-9][a-z0-9:._-]*$/i.test(value) && !UUID_PATTERN.test(value);
}

function validText(value, minimum, maximum) {
  return typeof value === "string" && value.trim().length >= minimum && value.trim().length <= maximum;
}

function nullableText(value, maximum) {
  return value === null || validText(value, 0, maximum);
}

function numberInRange(value, minimum, maximum) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function integerInRange(value, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

function nullableNumber(value, minimum, maximum) {
  return value === null || numberInRange(value, minimum, maximum);
}

function nullableInteger(value, minimum, maximum) {
  return value === null || integerInRange(value, minimum, maximum);
}

function isDateKey(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isIsoTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function toDate(value, code) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new QueryResponderError(code, 422);
  return date;
}

function requirePlainObject(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new QueryResponderError(code, 422);
}

function requireExactKeys(value, keys, code) {
  requirePlainObject(value, code);
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) {
    throw new QueryResponderError(code, 422);
  }
}
