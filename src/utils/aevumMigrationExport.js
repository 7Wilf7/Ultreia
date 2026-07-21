const FORMAT = "ultreia.old-origin-export";
const SCHEMA_VERSION = 1;
const MAX_EXPORT_BYTES = 4 * 1024 * 1024;
const WEEKLY_PREFIX = "ultreia.weeklyReports.v1.";
const MIGRATED_PREFIX = "ultreia.weeklyReportsMigrated.v1.";
const FIXED_KEYS = Object.freeze([
  "ultreia.lang",
  "ultreia.chartPeriod",
  "ultreia.weather.autoUpdate.v1",
  "ultreia.weather.updateIntervalHours.v1",
]);
const CHART_PERIODS = new Set([
  "day:7",
  "week:4",
  "week:8",
  "month:6",
  "month:12",
  "year:5",
]);
const REPORT_KEYS = new Set([
  "body", "createdAt", "end", "error", "generatedAt", "id", "metadata",
  "model", "nextEnd", "nextStart", "rangeMode", "readAt", "source", "start",
  "status", "text", "title", "updatedAt", "userId", "walletChargeCents",
]);
const REPORT_METADATA_KEYS = new Set(["legacyId", "migratedFromDevice"]);
const SENSITIVE_KEY = /password|passcode|access.?token|refresh.?token|api.?key|secret|authorization|cookie|session|push.?token|fcm|getui/i;

export class AevumMigrationExportError extends Error {
  constructor(code, paths = []) {
    super(`${code}${paths.length ? `: ${paths.join(", ")}` : ""}`);
    this.name = "AevumMigrationExportError";
    this.code = code;
    this.paths = paths;
  }
}

function fail(code, ...paths) {
  throw new AevumMigrationExportError(code, paths);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function assertAllowedKeys(value, allowed, path) {
  if (!isPlainObject(value)) fail("invalid_object", path);
  for (const key of Object.keys(value)) {
    if (SENSITIVE_KEY.test(key)) fail("sensitive_field", `${path}.${key}`);
    if (!allowed.has(key)) fail("unknown_field", `${path}.${key}`);
  }
}

function assertString(value, path, { allowEmpty = true, max = 500_000 } = {}) {
  if (typeof value !== "string" || (!allowEmpty && !value) || value.length > max) {
    fail("invalid_string", path);
  }
}

function assertTimestamp(value, path, { nullable = false } = {}) {
  if (nullable && (value === null || value === "" || value === undefined)) return;
  assertString(value, path, { allowEmpty: false, max: 40 });
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) fail("invalid_timestamp", path);
}

function validateMetadata(value, path) {
  if (value === undefined) return;
  assertAllowedKeys(value, REPORT_METADATA_KEYS, path);
  if (Object.hasOwn(value, "legacyId") && value.legacyId !== null) assertString(value.legacyId, `${path}.legacyId`, { max: 200 });
  if (Object.hasOwn(value, "migratedFromDevice") && typeof value.migratedFromDevice !== "boolean") {
    fail("invalid_boolean", `${path}.migratedFromDevice`);
  }
}

function validateReport(report, index, expectedUserId) {
  const path = `payload.weekly_reports.reports[${index}]`;
  assertAllowedKeys(report, REPORT_KEYS, path);
  for (const key of ["id", "userId", "rangeMode", "start", "end", "nextStart", "nextEnd", "source", "status", "title", "text", "body", "error", "model"]) {
    if (Object.hasOwn(report, key) && report[key] !== null) assertString(report[key], `${path}.${key}`);
  }
  for (const key of ["createdAt", "generatedAt", "updatedAt", "readAt"]) {
    if (Object.hasOwn(report, key)) assertTimestamp(report[key], `${path}.${key}`, { nullable: true });
  }
  if (Object.hasOwn(report, "walletChargeCents") && report.walletChargeCents !== null
    && (!Number.isFinite(report.walletChargeCents) || report.walletChargeCents < 0)) {
    fail("invalid_number", `${path}.walletChargeCents`);
  }
  validateMetadata(report.metadata, `${path}.metadata`);
  if (!report.start || !report.end || !(report.text || report.body)) fail("invalid_weekly_report", path);
  if (report.userId && report.userId !== expectedUserId) fail("owner_mismatch", `${path}.userId`);
  const sanitizedReport = { ...report };
  delete sanitizedReport.userId;
  return sanitizedReport;
}

function parseStoredJson(raw, path) {
  try {
    return JSON.parse(raw);
  } catch {
    fail("stored_state_corrupt", path);
  }
}

function readPreference(raw, key) {
  if (raw === null) return null;
  if (key === "ultreia.lang") {
    if (!new Set(["zh", "en"]).has(raw)) fail("invalid_preference", key);
    return raw;
  }
  if (key === "ultreia.chartPeriod") {
    const value = parseStoredJson(raw, key);
    assertAllowedKeys(value, new Set(["type", "count"]), key);
    if (!CHART_PERIODS.has(`${value.type}:${value.count}`)) fail("invalid_preference", key);
    return value;
  }
  if (key === "ultreia.weather.autoUpdate.v1") {
    if (!new Set(["true", "false"]).has(raw)) fail("invalid_preference", key);
    return raw === "true";
  }
  if (key === "ultreia.weather.updateIntervalHours.v1") {
    if (!new Set(["3", "6", "12", "24"]).has(raw)) fail("invalid_preference", key);
    return Number(raw);
  }
  fail("unknown_storage_key", key);
}

function listStorageKeys(storage) {
  if (!storage || typeof storage.getItem !== "function" || typeof storage.key !== "function") {
    fail("storage_unavailable", "localStorage");
  }
  return Array.from({ length: storage.length }, (_, index) => storage.key(index))
    .filter(key => typeof key === "string")
    .sort();
}

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) fail("non_json_value", "payload");
  return serialized;
}

async function sha256Hex(value, cryptoObject = globalThis.crypto) {
  if (!cryptoObject?.subtle) fail("crypto_unavailable", "crypto.subtle");
  const digest = await cryptoObject.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeOrigin(value) {
  let url;
  try { url = new URL(value); } catch { fail("invalid_origin", "source.origin"); }
  const loopback = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !loopback) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    fail("invalid_origin", "source.origin");
  }
  return url.origin;
}

function normalizeCommit(value) {
  if (value === "development" || /^[a-f0-9]{40,64}$/i.test(value || "")) return value;
  fail("invalid_source_commit", "source.commit");
}

export async function createUltreiaAevumExport({
  storage = globalThis.localStorage,
  userId,
  verifyOwner = async () => true,
  now = new Date(),
  origin = globalThis.location?.origin,
  sourceCommit = "development",
  cryptoObject = globalThis.crypto,
} = {}) {
  assertString(userId, "owner", { allowEmpty: false, max: 200 });
  if (await verifyOwner(userId) !== true) fail("owner_changed", "owner");
  const keysBefore = listStorageKeys(storage);
  const preferenceRawBefore = Object.fromEntries(FIXED_KEYS.map(key => [key, storage.getItem(key)]));
  const preferences = {};
  for (const key of FIXED_KEYS) {
    const value = readPreference(preferenceRawBefore[key], key);
    if (value !== null) preferences[key] = value;
  }

  const weeklyKey = `${WEEKLY_PREFIX}${userId}`;
  const migrationDone = storage.getItem(`${MIGRATED_PREFIX}${userId}`) === "1";
  let weeklyReports = null;
  const weeklyRaw = storage.getItem(weeklyKey);
  if (weeklyRaw !== null && !migrationDone) {
    const reports = parseStoredJson(weeklyRaw, weeklyKey);
    if (!Array.isArray(reports) || reports.length > 20) fail("invalid_weekly_reports", weeklyKey);
    weeklyReports = { scope: "current_owner", reports: reports.map((report, index) => validateReport(report, index, userId)) };
  }

  const exportedKeys = new Set([...Object.keys(preferences), ...(weeklyReports ? [weeklyKey] : [])]);
  const deniedKeys = [...new Set(keysBefore
    .filter(key => !exportedKeys.has(key))
    .map(key => key.startsWith(WEEKLY_PREFIX) || key.startsWith(MIGRATED_PREFIX)
      ? `${key.split(".").slice(0, -1).join(".")}.<owner-scope>`
      : key))].sort();
  const createdAt = new Date(now);
  if (!Number.isFinite(createdAt.getTime())) fail("invalid_timestamp", "created_at");
  const ownerFingerprint = await sha256Hex(`aevum-owner-v1:${userId}`, cryptoObject);
  if (await verifyOwner(userId) !== true) fail("owner_changed", "owner");
  if (canonicalize(keysBefore) !== canonicalize(listStorageKeys(storage))) fail("source_changed", "localStorage");
  const preferenceRawAfter = Object.fromEntries(FIXED_KEYS.map(key => [key, storage.getItem(key)]));
  if (canonicalize(preferenceRawBefore) !== canonicalize(preferenceRawAfter)) fail("source_changed", "preferences");
  if (storage.getItem(weeklyKey) !== weeklyRaw) fail("source_changed", weeklyKey);

  const body = {
    format: FORMAT,
    schema_version: SCHEMA_VERSION,
    product: "ultreia",
    created_at: createdAt.toISOString(),
    source: { origin: normalizeOrigin(origin), commit: normalizeCommit(sourceCommit) },
    owner: { kind: "aevum", fingerprint: ownerFingerprint },
    payload: { preferences, weekly_reports: weeklyReports },
    denied_keys: deniedKeys,
    stats: {
      preference_count: Object.keys(preferences).length,
      weekly_report_count: weeklyReports?.reports.length || 0,
    },
  };
  const integrity = { algorithm: "SHA-256", value: await sha256Hex(canonicalize(body), cryptoObject) };
  const artifact = { ...body, integrity };
  if (new TextEncoder().encode(canonicalize(artifact)).byteLength > MAX_EXPORT_BYTES) fail("file_too_large", "export");
  if (await verifyOwner(userId) !== true) fail("owner_changed", "owner");
  return artifact;
}

export function serializeUltreiaAevumExport(artifact) {
  return `${JSON.stringify(artifact, null, 2)}\n`;
}

export function ultreiaAevumExportFilename(artifact) {
  const date = artifact?.created_at?.slice(0, 10) || "unknown-date";
  const checksum = artifact?.integrity?.value?.slice(0, 8) || "unknown";
  return `ultreia-aevum-export-${date}-${checksum}.json`;
}
