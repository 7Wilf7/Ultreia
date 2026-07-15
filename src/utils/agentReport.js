import { matchPlansToActuals } from "./planMatch.js";

export const REPORT_TYPE = "training_state_change";
export const SIGNAL_KIND = "repeated_plan_deviation";
export const LOOKBACK_DAYS = 14;

const DAY_MS = 86400000;
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const HEALTH_SIGNAL_RE = /(pain|ache|injur|niggle|tight|sore|fatigue|exhaust|\bill\b|sick|疼|痛|不适|伤|疲|酸|紧|生病|感冒|发烧|跟腱|膝|小腿|胫骨|髂胫束)/i;

export const REPORT_CATALOG = Object.freeze([
  {
    reportType: REPORT_TYPE,
    signalKind: SIGNAL_KIND,
    schemaVersion: "training_state_change.v1",
    detectorId: "repeated_plan_deviation",
    runtime: "live",
    sensitivity: "normal",
    confidenceFloor: 0.9,
    maxFrequencyDays: 1,
    retentionCeilingDays: 7,
    modelParticipation: "forbidden",
    allowedPayloadKeys: ["type", "signal_kind", "schema_version", "window", "counts", "affected_ratio", "state"],
  },
  {
    reportType: "training_load_change",
    signalKind: "rapid_training_load_change",
    schemaVersion: "training_load_change.v1",
    detectorId: "rapid_training_load_change",
    runtime: "live",
    sensitivity: "normal",
    confidenceFloor: 0.85,
    maxFrequencyDays: 7,
    retentionCeilingDays: 21,
    modelParticipation: "allowed_minimized",
    allowedPayloadKeys: ["type", "signal_kind", "schema_version", "window", "direction", "duration_change_ratio", "session_counts"],
  },
  {
    reportType: "recovery_state_change",
    signalKind: "recovery_risk_trend",
    schemaVersion: "recovery_state_change.v1",
    detectorId: "recovery_risk_trend",
    runtime: "live",
    sensitivity: "sensitive",
    confidenceFloor: 0.9,
    maxFrequencyDays: 7,
    retentionCeilingDays: 14,
    modelParticipation: "forbidden",
    allowedPayloadKeys: ["type", "signal_kind", "schema_version", "window", "risk_level", "poor_readiness_days", "high_rpe_sessions", "sample_days"],
  },
  {
    reportType: "goal_context_change",
    signalKind: "target_race_context_change",
    schemaVersion: "goal_context_change.v1",
    detectorId: "target_race_context_change",
    runtime: "live",
    sensitivity: "normal",
    confidenceFloor: 0.95,
    maxFrequencyDays: 1,
    retentionCeilingDays: 90,
    modelParticipation: "allowed_minimized",
    allowedPayloadKeys: ["type", "signal_kind", "schema_version", "change_window", "target_count", "nearest_target_days", "priority_counts"],
  },
  {
    reportType: "training_preference_change",
    signalKind: "preference_context_invalidated",
    schemaVersion: "training_preference_invalidation.v1",
    detectorId: "preference_context_invalidated",
    runtime: "live",
    sensitivity: "normal",
    confidenceFloor: 0.9,
    maxFrequencyDays: 7,
    retentionCeilingDays: 180,
    modelParticipation: "allowed_minimized",
    allowedPayloadKeys: ["type", "signal_kind", "schema_version", "change_window", "change_count", "operations", "context_version"],
  },
  {
    reportType: "training_progress_change",
    signalKind: "notable_progress_or_milestone",
    schemaVersion: "training_progress_change.v1",
    detectorId: "notable_progress_or_milestone",
    runtime: "live",
    sensitivity: "normal",
    confidenceFloor: 0.9,
    maxFrequencyDays: 14,
    retentionCeilingDays: 90,
    modelParticipation: "allowed_minimized",
    allowedPayloadKeys: ["type", "signal_kind", "schema_version", "window", "metric", "improvement_ratio", "baseline_days"],
  },
  {
    reportType: "health_risk_change",
    signalKind: "recurring_injury_or_health_risk_pattern",
    schemaVersion: "health_risk_change.v1",
    detectorId: "recurring_injury_or_health_risk_pattern",
    runtime: "live",
    sensitivity: "sensitive",
    confidenceFloor: 0.95,
    maxFrequencyDays: 14,
    retentionCeilingDays: 14,
    modelParticipation: "forbidden",
    allowedPayloadKeys: ["type", "signal_kind", "schema_version", "window", "signal_days", "signal_sources", "recurrence"],
  },
]);

export function catalogKey(reportType, signalKind) {
  return `${reportType}:${signalKind}`;
}

export function getCatalogEntry(reportType, signalKind) {
  return REPORT_CATALOG.find(entry => entry.reportType === reportType && entry.signalKind === signalKind) || null;
}

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

export function buildReportSignatureMessage({ method = "POST", path, source = "ultreia", timestamp, bodyHash }) {
  return [method, path, source, timestamp, bodyHash].join("\n");
}

export function localDateKey(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const get = type => parts.find(part => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function shiftDateKey(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isValidDateKey(dateKey) {
  if (!DATE_KEY_RE.test(String(dateKey))) return false;
  const [year, month, day] = String(dateKey).split("-").map(Number);
  const normalized = new Date(Date.UTC(year, month - 1, day));
  return normalized.getUTCFullYear() === year
    && normalized.getUTCMonth() === month - 1
    && normalized.getUTCDate() === day;
}

function timeZoneOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const get = type => Number(parts.find(part => part.type === type)?.value);
  const representedUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return representedUtc - Math.floor(date.getTime() / 1000) * 1000;
}

export function localDateStartInstant(dateKey, timeZone = "Asia/Shanghai") {
  if (!isValidDateKey(dateKey)) throw new Error("invalid_local_date");
  const [year, month, day] = String(dateKey).split("-").map(Number);
  const utcGuess = Date.UTC(year, month - 1, day);
  let instant = utcGuess - timeZoneOffsetMs(new Date(utcGuess), timeZone);
  instant = utcGuess - timeZoneOffsetMs(new Date(instant), timeZone);
  return new Date(instant);
}

export function localDateEndInstant(dateKey, timeZone = "Asia/Shanghai") {
  return new Date(localDateStartInstant(shiftDateKey(dateKey, 1), timeZone).getTime() - 1);
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeWorkout(row) {
  return {
    id: row.id,
    date: row.date,
    type: row.type,
    subTypes: Array.isArray(row.sub_types) ? row.sub_types : [],
    distance: finiteNumber(row.distance),
    duration: finiteNumber(row.duration),
    ascent: finiteNumber(row.ascent),
    rpe: finiteNumber(row.rpe),
    note: typeof row.note === "string" ? row.note : "",
    startedAt: row.started_at,
    isPlanned: row.is_planned === true,
    planStatus: row.plan_status,
    planDetail: row.plan_detail && typeof row.plan_detail === "object" ? row.plan_detail : null,
    updatedAt: row.updated_at,
  };
}

export function buildTrainingStateSource(rows, { now = new Date(), timeZone = "Asia/Shanghai" } = {}) {
  const today = localDateKey(now, timeZone);
  const startDate = shiftDateKey(today, -LOOKBACK_DAYS);
  const endDate = shiftDateKey(today, -1);
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
  if (!triggered) return { reportType: REPORT_TYPE, signalKind: SIGNAL_KIND, sourceFingerprint, triggered: false, source, typedPayload: null, contentHash: null };
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
    reportType: REPORT_TYPE,
    signalKind: SIGNAL_KIND,
    sourceFingerprint,
    triggered: true,
    confidence: 0.95,
    significance: source.counts.missed_key_sessions
      ? "key_session_missed"
      : source.counts.planned >= 4 && source.counts.affected / source.counts.planned >= 0.5
        ? "low_adherence_pattern"
        : "recurrent_deviation",
    novelty: "aggregate_changed",
    recurrence: source.counts.affected,
    source,
    typedPayload,
    contentHash: await sha256Hex(canonicalJson(typedPayload), options.cryptoImpl),
  };
}

function rowsInRange(rows, startDate, endDate) {
  return rows.filter(row => row.date >= startDate && row.date <= endDate);
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export async function extractReportFeatures(domainSnapshot, { now = new Date(), timeZone = "Asia/Shanghai", cryptoImpl = globalThis.crypto } = {}) {
  const today = localDateKey(now, timeZone);
  const endDate = shiftDateKey(today, -1);
  const recentStart = shiftDateKey(today, -7);
  const previousStart = shiftDateKey(today, -14);
  const previousEnd = shiftDateKey(today, -8);
  const lookback28Start = shiftDateKey(today, -28);
  const baseline90Start = shiftDateKey(today, -97);
  const changeStart = shiftDateKey(today, -1);
  const workouts = (domainSnapshot?.workouts || []).map(normalizeWorkout).filter(row => row.date && row.date <= endDate);
  const completed = workouts.filter(row => !row.isPlanned);
  const recent = rowsInRange(completed, recentStart, endDate);
  const previous = rowsInRange(completed, previousStart, previousEnd);
  const recent28 = rowsInRange(completed, lookback28Start, endDate);
  const milestoneRecent = rowsInRange(completed, recentStart, endDate);
  const milestoneBaseline = rowsInRange(completed, baseline90Start, shiftDateKey(recentStart, -1));
  const sum = (rows, key) => rows.reduce((total, row) => total + finiteNumber(row[key]), 0);
  const notes = (domainSnapshot?.dailyNotes || []).filter(row => row?.date >= previousStart && row?.date <= endDate);
  const readiness = notes.map(row => {
    const values = [row.readiness_sleep, row.readiness_legs, row.readiness_energy]
      .map(Number).filter(Number.isFinite);
    return { date: row.date, score: average(values), sick: Array.isArray(row.tags) && row.tags.includes("sick") };
  });
  const recentReadiness = readiness.filter(row => row.date >= recentStart && row.score != null);
  const previousReadiness = readiness.filter(row => row.date >= previousStart && row.date <= previousEnd && row.score != null);
  const healthWorkoutDays = new Set(recent28.filter(row => HEALTH_SIGNAL_RE.test(row.note)).map(row => row.date));
  const sickDays = new Set((domainSnapshot?.dailyNotes || [])
    .filter(row => row?.date >= lookback28Start && row?.date <= endDate && Array.isArray(row.tags) && row.tags.includes("sick"))
    .map(row => row.date));
  const races = domainSnapshot?.races || [];
  const targetRaces = races.filter(row => row?.is_target === true);
  const changedTargets = races.filter(row => {
    const updated = row.updated_at ? new Date(row.updated_at) : null;
    return updated && !Number.isNaN(updated.getTime()) && localDateKey(updated, timeZone) === changeStart;
  });
  const priorityCounts = targetRaces.reduce((counts, race) => {
    const key = ["A", "B", "C"].includes(String(race.priority || "").toUpperCase()) ? String(race.priority).toUpperCase() : "unset";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, { A: 0, B: 0, C: 0, unset: 0 });
  const nearestTargetDays = targetRaces
    .filter(race => isValidDateKey(race.date) && race.date >= today)
    .map(race => Math.round((localDateStartInstant(race.date, timeZone) - localDateStartInstant(today, timeZone)) / DAY_MS))
    .sort((a, b) => a - b)[0] ?? null;
  const preferenceChanges = (domainSnapshot?.memoryFacts || []).filter(row => {
    if (row?.category !== "training_preferences" || !row.updated_at) return false;
    const updated = new Date(row.updated_at);
    return !Number.isNaN(updated.getTime()) && localDateKey(updated, timeZone) === changeStart;
  });
  const preferenceOperations = preferenceChanges.reduce((counts, row) => {
    counts[row.status === "archived" ? "removed" : "updated"] += 1;
    return counts;
  }, { updated: 0, removed: 0 });
  const activePreferenceMetadata = (domainSnapshot?.memoryFacts || [])
    .filter(row => row?.category === "training_preferences" && row.status === "active" && row.id)
    .map(row => ({ id: String(row.id), updated_at: row.updated_at ? String(row.updated_at) : null }))
    .sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));
  const preferenceContextVersion = await sha256Hex(canonicalJson(activePreferenceMetadata), cryptoImpl);
  const recentMax = {
    distance: Math.max(0, ...milestoneRecent.map(row => row.distance)),
    duration: Math.max(0, ...milestoneRecent.map(row => row.duration)),
    ascent: Math.max(0, ...milestoneRecent.map(row => row.ascent)),
  };
  const baselineMax = {
    distance: Math.max(0, ...milestoneBaseline.map(row => row.distance)),
    duration: Math.max(0, ...milestoneBaseline.map(row => row.duration)),
    ascent: Math.max(0, ...milestoneBaseline.map(row => row.ascent)),
  };
  return {
    window: { today, endDate, recentStart, previousStart, previousEnd, lookback28Start, baseline90Start, changeStart },
    load: {
      recentDuration: sum(recent, "duration"), previousDuration: sum(previous, "duration"),
      recentSessions: recent.length, previousSessions: previous.length,
    },
    recovery: {
      recentAverage: average(recentReadiness.map(row => row.score)),
      previousAverage: average(previousReadiness.map(row => row.score)),
      recentSampleDays: recentReadiness.length,
      previousSampleDays: previousReadiness.length,
      poorDays: recentReadiness.filter(row => row.score <= 1.67).length,
      highRpeSessions: recent.filter(row => row.rpe >= 8).length,
    },
    goalContext: { changedCount: changedTargets.length, targetCount: targetRaces.length, nearestTargetDays, priorityCounts },
    preference: {
      changedCount: preferenceChanges.length,
      operations: preferenceOperations,
      contextVersion: preferenceContextVersion,
    },
    milestone: { recentMax, baselineMax, recentSessions: milestoneRecent.length, baselineSessions: milestoneBaseline.length },
    health: {
      workoutSignalDays: healthWorkoutDays.size,
      sickDays: sickDays.size,
      totalSignalDays: new Set([...healthWorkoutDays, ...sickDays]).size,
    },
  };
}

function payloadCandidate(entry, typedPayload, confidence, judgment) {
  return {
    reportType: entry.reportType,
    signalKind: entry.signalKind,
    typedPayload,
    confidence,
    novelty: "aggregate_changed",
    ...judgment,
  };
}

export const REPORT_DETECTORS = Object.freeze([
  {
    id: "repeated_plan_deviation",
    detect: ({ adherence }) => adherence.triggered ? adherence : null,
  },
  {
    id: "rapid_training_load_change",
    detect: ({ features }) => {
      const { recentDuration, previousDuration, recentSessions, previousSessions } = features.load;
      if (recentSessions < 2 || previousSessions < 2 || previousDuration < 120) return null;
      const ratio = recentDuration / previousDuration;
      if (!(ratio >= 1.5 || ratio <= 0.5) || Math.abs(recentDuration - previousDuration) < 120) return null;
      const entry = getCatalogEntry("training_load_change", "rapid_training_load_change");
      return payloadCandidate(entry, {
        type: entry.reportType, signal_kind: entry.signalKind, schema_version: entry.schemaVersion,
        window: { start_date: features.window.previousStart, end_date: features.window.endDate, comparison_days: 7 },
        direction: ratio >= 1.5 ? "rapid_increase" : "rapid_decrease",
        duration_change_ratio: Number(ratio.toFixed(3)),
        session_counts: { recent: recentSessions, previous: previousSessions },
      }, 0.9, { significance: "weekly_duration_changed_materially", recurrence: Math.min(recentSessions, previousSessions) });
    },
  },
  {
    id: "recovery_risk_trend",
    detect: ({ features }) => {
      const recovery = features.recovery;
      const sustainedPoor = recovery.recentSampleDays >= 3 && recovery.poorDays >= 2;
      const materialDrop = recovery.recentSampleDays >= 3 && recovery.previousSampleDays >= 3
        && recovery.previousAverage - recovery.recentAverage >= 0.5;
      if (!sustainedPoor && !materialDrop && recovery.highRpeSessions < 2) return null;
      const entry = getCatalogEntry("recovery_state_change", "recovery_risk_trend");
      return payloadCandidate(entry, {
        type: entry.reportType, signal_kind: entry.signalKind, schema_version: entry.schemaVersion,
        window: { start_date: features.window.recentStart, end_date: features.window.endDate, lookback_days: 7 },
        risk_level: recovery.poorDays >= 3 || recovery.highRpeSessions >= 3 ? "high" : "elevated",
        poor_readiness_days: recovery.poorDays, high_rpe_sessions: recovery.highRpeSessions,
        sample_days: recovery.recentSampleDays,
      }, 0.92, { significance: sustainedPoor ? "sustained_poor_readiness" : materialDrop ? "readiness_drop" : "repeated_high_rpe", recurrence: Math.max(recovery.poorDays, recovery.highRpeSessions) });
    },
  },
  {
    id: "target_race_context_change",
    detect: ({ features }) => {
      if (!features.goalContext.changedCount) return null;
      const entry = getCatalogEntry("goal_context_change", "target_race_context_change");
      return payloadCandidate(entry, {
        type: entry.reportType, signal_kind: entry.signalKind, schema_version: entry.schemaVersion,
        change_window: features.window.changeStart,
        target_count: features.goalContext.targetCount,
        nearest_target_days: features.goalContext.nearestTargetDays,
        priority_counts: features.goalContext.priorityCounts,
      }, 0.98, { significance: "structured_target_changed", recurrence: features.goalContext.changedCount });
    },
  },
  {
    id: "preference_context_invalidated",
    detect: ({ features }) => {
      if (!features.preference.changedCount) return null;
      const entry = getCatalogEntry("training_preference_change", "preference_context_invalidated");
      return payloadCandidate(entry, {
        type: entry.reportType, signal_kind: entry.signalKind, schema_version: entry.schemaVersion,
        change_window: features.window.changeStart,
        change_count: features.preference.changedCount,
        operations: features.preference.operations,
        context_version: features.preference.contextVersion,
      }, 0.9, { significance: "accepted_training_preference_changed", recurrence: features.preference.changedCount });
    },
  },
  {
    id: "notable_progress_or_milestone",
    detect: ({ features }) => {
      if (!features.milestone.recentSessions || features.milestone.baselineSessions < 4) return null;
      const thresholds = { distance: 10, duration: 60, ascent: 500 };
      const result = Object.keys(thresholds).map(metric => {
        const recent = features.milestone.recentMax[metric];
        const baseline = features.milestone.baselineMax[metric];
        return { metric, recent, baseline, ratio: baseline > 0 ? recent / baseline : 0 };
      }).filter(item => item.recent >= thresholds[item.metric] && item.ratio >= 1.1)
        .sort((a, b) => b.ratio - a.ratio)[0];
      if (!result) return null;
      const entry = getCatalogEntry("training_progress_change", "notable_progress_or_milestone");
      return payloadCandidate(entry, {
        type: entry.reportType, signal_kind: entry.signalKind, schema_version: entry.schemaVersion,
        window: { start_date: features.window.recentStart, end_date: features.window.endDate, lookback_days: 7 },
        metric: result.metric, improvement_ratio: Number(result.ratio.toFixed(3)), baseline_days: 90,
      }, 0.92, { significance: "new_rolling_personal_high", recurrence: 1 });
    },
  },
  {
    id: "recurring_injury_or_health_risk_pattern",
    detect: ({ features }) => {
      if (features.health.totalSignalDays < 2) return null;
      const entry = getCatalogEntry("health_risk_change", "recurring_injury_or_health_risk_pattern");
      return payloadCandidate(entry, {
        type: entry.reportType, signal_kind: entry.signalKind, schema_version: entry.schemaVersion,
        window: { start_date: features.window.lookback28Start, end_date: features.window.endDate, lookback_days: 28 },
        signal_days: features.health.totalSignalDays,
        signal_sources: {
          workout_text_days: features.health.workoutSignalDays,
          sick_tag_days: features.health.sickDays,
        },
        recurrence: "repeated_days",
      }, 0.95, { significance: "health_signal_on_multiple_days", recurrence: features.health.totalSignalDays });
    },
  },
]);

export function containsForbiddenReportData(value, forbiddenValues = []) {
  const forbiddenKey = /^(?:user_?id|email|workouts?|workout_?id|plan_?id|distance|pace|heart_?rate|hr|rpe|notes?|memory|readiness|sick|pain|gps(?:_track)?|weather|location(?:_name|_lat|_lng)?|race_?name|internal_?id|health_?details?)$/i;
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

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  return isPlainObject(value)
    && Object.keys(value).sort().join("|") === [...keys].sort().join("|");
}

function isIntegerInRange(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function validWindow(value, extraKey, extraValue, inclusiveDays) {
  return hasExactKeys(value, ["start_date", "end_date", extraKey])
    && isValidDateKey(value.start_date)
    && isValidDateKey(value.end_date)
    && value[extraKey] === extraValue
    && (Date.parse(`${value.end_date}T00:00:00.000Z`) - Date.parse(`${value.start_date}T00:00:00.000Z`)) / DAY_MS + 1 === inclusiveDays;
}

const PAYLOAD_VALIDATORS = Object.freeze({
  "training_state_change.v1": payload => {
    const countKeys = ["planned", "done", "partial", "missed", "affected", "missed_key_sessions"];
    return validWindow(payload.window, "lookback_days", 14, 14)
      && hasExactKeys(payload.counts, countKeys)
      && countKeys.every(key => isIntegerInRange(payload.counts[key], 0, 10000))
      && payload.counts.affected === payload.counts.partial + payload.counts.missed
      && payload.counts.done + payload.counts.partial + payload.counts.missed === payload.counts.planned
      && payload.counts.missed_key_sessions <= payload.counts.missed
      && isFiniteNumber(payload.affected_ratio) && payload.affected_ratio >= 0 && payload.affected_ratio <= 1
      && payload.affected_ratio === (payload.counts.planned
        ? Number((payload.counts.affected / payload.counts.planned).toFixed(6))
        : 0)
      && ["active", "resolved"].includes(payload.state);
  },
  "training_load_change.v1": payload => validWindow(payload.window, "comparison_days", 7, 14)
    && ((payload.direction === "rapid_increase" && payload.duration_change_ratio >= 1.5)
      || (payload.direction === "rapid_decrease" && payload.duration_change_ratio <= 0.5))
    && isFiniteNumber(payload.duration_change_ratio) && payload.duration_change_ratio >= 0 && payload.duration_change_ratio <= 100
    && hasExactKeys(payload.session_counts, ["recent", "previous"])
    && isIntegerInRange(payload.session_counts.recent, 2, 1000)
    && isIntegerInRange(payload.session_counts.previous, 2, 1000),
  "recovery_state_change.v1": payload => validWindow(payload.window, "lookback_days", 7, 7)
    && ["elevated", "high"].includes(payload.risk_level)
    && isIntegerInRange(payload.sample_days, 0, 7)
    && isIntegerInRange(payload.poor_readiness_days, 0, payload.sample_days)
    && isIntegerInRange(payload.high_rpe_sessions, 0, 100),
  "goal_context_change.v1": payload => isValidDateKey(payload.change_window)
    && isIntegerInRange(payload.target_count, 0, 100)
    && (payload.nearest_target_days === null || isIntegerInRange(payload.nearest_target_days, 0, 3650))
    && hasExactKeys(payload.priority_counts, ["A", "B", "C", "unset"])
    && Object.values(payload.priority_counts).every(value => isIntegerInRange(value, 0, 100))
    && Object.values(payload.priority_counts).reduce((sum, value) => sum + value, 0) === payload.target_count,
  "training_preference_invalidation.v1": payload => isValidDateKey(payload.change_window)
    && isIntegerInRange(payload.change_count, 1, 100)
    && hasExactKeys(payload.operations, ["updated", "removed"])
    && Object.values(payload.operations).every(value => isIntegerInRange(value, 0, 100))
    && payload.operations.updated + payload.operations.removed === payload.change_count
    && /^[0-9a-f]{64}$/.test(payload.context_version),
  "training_progress_change.v1": payload => validWindow(payload.window, "lookback_days", 7, 7)
    && ["distance", "duration", "ascent"].includes(payload.metric)
    && isFiniteNumber(payload.improvement_ratio) && payload.improvement_ratio >= 1.1 && payload.improvement_ratio <= 100
    && payload.baseline_days === 90,
  "health_risk_change.v1": payload => validWindow(payload.window, "lookback_days", 28, 28)
    && isIntegerInRange(payload.signal_days, 2, 28)
    && hasExactKeys(payload.signal_sources, ["workout_text_days", "sick_tag_days"])
    && Object.values(payload.signal_sources).every(value => isIntegerInRange(value, 0, 28))
    && payload.signal_days <= Object.values(payload.signal_sources).reduce((sum, value) => sum + value, 0)
    && payload.recurrence === "repeated_days",
});

export function validateCandidateAgainstCatalog(candidate) {
  const entry = getCatalogEntry(candidate?.reportType, candidate?.signalKind);
  if (!entry) return { ok: false, reason: "unregistered_report_type" };
  if (!candidate?.typedPayload || candidate.typedPayload.type !== entry.reportType
    || candidate.typedPayload.signal_kind !== entry.signalKind
    || candidate.typedPayload.schema_version !== entry.schemaVersion) {
    return { ok: false, reason: "payload_identity_mismatch" };
  }
  if (finiteNumber(candidate.confidence) < entry.confidenceFloor) return { ok: false, reason: "confidence_below_floor" };
  const keys = Object.keys(candidate.typedPayload);
  if (keys.some(key => !entry.allowedPayloadKeys.includes(key))) return { ok: false, reason: "unregistered_payload_field" };
  const validatePayload = PAYLOAD_VALIDATORS[entry.schemaVersion];
  if (!validatePayload || !validatePayload(candidate.typedPayload)) return { ok: false, reason: "invalid_payload_schema" };
  if (containsForbiddenReportData(candidate.typedPayload)) return { ok: false, reason: "forbidden_raw_field" };
  return { ok: true, entry };
}

export async function discoverReportCandidates(domainSnapshot, options = {}) {
  const adherence = await buildTrainingStateCandidate(domainSnapshot?.workouts || [], options);
  const features = await extractReportFeatures(domainSnapshot, options);
  const candidates = [];
  for (const detector of REPORT_DETECTORS) {
    const candidate = detector.detect({ adherence, features });
    if (candidate) candidates.push(candidate);
  }
  const prepared = [];
  for (const candidate of candidates) {
    if (!candidate?.triggered && candidate.signalKind === SIGNAL_KIND) continue;
    candidate.triggered = true;
    const validation = validateCandidateAgainstCatalog(candidate);
    if (!validation.ok) continue;
    candidate.contentHash ||= await sha256Hex(canonicalJson(candidate.typedPayload), options.cryptoImpl);
    candidate.sourceFingerprint ||= await sha256Hex(canonicalJson({
      type: candidate.reportType,
      signal_kind: candidate.signalKind,
      significance: candidate.significance,
      recurrence: candidate.recurrence,
      payload: candidate.typedPayload,
    }), options.cryptoImpl);
    prepared.push({ ...candidate, catalog: validation.entry });
  }
  const evidenceBySignal = {
    [SIGNAL_KIND]: { source_fingerprint: adherence.sourceFingerprint },
    rapid_training_load_change: { window: features.window, load: features.load },
    recovery_risk_trend: { window: features.window, recovery: features.recovery },
    target_race_context_change: { change_window: features.window.changeStart, goal_context: features.goalContext },
    preference_context_invalidated: { change_window: features.window.changeStart, preference: features.preference },
    notable_progress_or_milestone: { window: features.window, milestone: features.milestone },
    recurring_injury_or_health_risk_pattern: { window: features.window, health: features.health },
  };
  const candidateKeys = new Set(prepared.map(candidate => catalogKey(candidate.reportType, candidate.signalKind)));
  const observations = [];
  for (const entry of REPORT_CATALOG) {
    if (candidateKeys.has(catalogKey(entry.reportType, entry.signalKind))) continue;
    observations.push({
      reportType: entry.reportType,
      signalKind: entry.signalKind,
      triggered: false,
      sourceFingerprint: entry.signalKind === SIGNAL_KIND
        ? adherence.sourceFingerprint
        : await sha256Hex(canonicalJson(evidenceBySignal[entry.signalKind]), options.cryptoImpl),
      typedPayload: null,
      contentHash: null,
      catalog: entry,
    });
  }
  return { features, candidates: prepared, observations };
}

export async function buildReportEnvelope(candidate, { reportedAt = new Date(), timeZone = "Asia/Shanghai" } = {}) {
  if (!candidate?.triggered) return null;
  const validation = validateCandidateAgainstCatalog(candidate);
  if (!validation.ok || validation.entry.runtime !== "live") throw new Error(`report_not_dispatchable:${validation.reason || validation.entry.runtime}`);
  const identity = await sha256Hex(`${candidate.reportType}\n${candidate.signalKind}\n${candidate.sourceFingerprint}\n${candidate.contentHash}`);
  const reportId = `ultreia-${identity.slice(0, 40)}`;
  const lineageNames = {
    repeated_plan_deviation: "plan-deviation",
    rapid_training_load_change: "load-change",
    recovery_risk_trend: "recovery-risk",
    target_race_context_change: "goal-context",
    preference_context_invalidated: "preference-context",
    notable_progress_or_milestone: "training-progress",
    recurring_injury_or_health_risk_pattern: "health-risk",
  };
  const lineageName = lineageNames[candidate.signalKind];
  if (!lineageName) throw new Error("report_lineage_unregistered");
  const sourceRef = `ultreia-${lineageName}-${candidate.sourceFingerprint.slice(0, 16)}`;
  const rootLineageId = `ultreia-${lineageName}-lineage-${candidate.sourceFingerprint.slice(0, 16)}`;
  const localEndDate = candidate.typedPayload?.window?.end_date || candidate.typedPayload?.change_window;
  if (!isValidDateKey(localEndDate)) throw new Error("report_occurred_date_missing");
  const windowEnd = localDateEndInstant(localEndDate, timeZone);
  if (windowEnd.getTime() > reportedAt.getTime()) throw new Error("report_occurred_at_in_future");
  const occurredAt = windowEnd.toISOString();
  const expiresAt = new Date(new Date(occurredAt).getTime() + validation.entry.retentionCeilingDays * DAY_MS).toISOString();
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
    sensitivity: validation.entry.sensitivity,
    confidence: candidate.confidence,
    proposed_scopes: ["aevum"],
    retention_hint: "short",
    expires_at: expiresAt,
    content_hash: candidate.contentHash,
    typed_payload: candidate.typedPayload,
  };
}

export function isLiveCadenceDue(outbox, catalogEntry, { now = new Date() } = {}) {
  if (!outbox?.delivered_at) return true;
  const deliveredAt = Date.parse(outbox.delivered_at);
  if (Number.isNaN(deliveredAt)) return false;
  const cadenceMs = Math.max(1, Number(catalogEntry?.maxFrequencyDays) || 1) * DAY_MS;
  return now.getTime() - deliveredAt >= cadenceMs;
}

export function scheduleLiveOutboxRuns(rows, { now = new Date(), candidateWindow = false, limit = 7 } = {}) {
  const byKey = new Map((rows || []).map(row => [catalogKey(row.report_type, row.signal_kind), row]));
  return REPORT_CATALOG.filter(entry => entry.runtime === "live").slice(0, limit).map(entry => {
    const outbox = byKey.get(catalogKey(entry.reportType, entry.signalKind));
    let run = outbox
      ? decideOutboxRun(outbox, { now, candidateWindow })
      : { action: "skip", reason: "outbox_missing" };
    if (run.action === "discover" && !isLiveCadenceDue(outbox, entry, { now })) {
      run = { action: "skip", reason: "cadence_not_due" };
    }
    return {
      entry,
      outbox,
      run,
    };
  });
}

export function decideCandidateAction(outbox, candidate) {
  if (outbox?.pending_envelope) return "preserve_pending";
  if (candidate.sourceFingerprint === outbox?.observed_source_fingerprint) return "source_unchanged";
  if (!candidate.triggered) return "below_threshold";
  if (candidate.contentHash === outbox?.last_delivered_content_hash) return "content_already_delivered";
  return "persist_pending";
}

export function classifyIngressResult({ status, receipt, attemptCount = 0 }) {
  if (status >= 200 && status < 300 && ["recorded", "replayed", "duplicate"].includes(receipt?.status)) {
    return { kind: "delivered" };
  }
  if (status === 0 || status >= 500) {
    const delays = [30 * 60, 2 * 60 * 60, 6 * 60 * 60];
    return attemptCount + 1 >= 3
      ? { kind: "paused", delaySeconds: 24 * 60 * 60, attemptCount: attemptCount + 1 }
      : { kind: "retry", delaySeconds: delays[attemptCount] || delays.at(-1), attemptCount: attemptCount + 1 };
  }
  return { kind: "blocked", attemptCount: attemptCount + 1 };
}

export function decideOutboxRun(outbox, { now = new Date(), candidateWindow = false } = {}) {
  const nowMs = now.getTime();
  const leaseActive = outbox?.lease_token && outbox?.lease_expires_at && Date.parse(outbox.lease_expires_at) > nowMs;
  if (leaseActive) return { action: "skip", reason: "concurrent_claim" };
  if (outbox?.pending_envelope) {
    if (outbox.status === "blocked") return { action: "skip", reason: "permanent_failure" };
    if (outbox.status === "paused") {
      if (!outbox.paused_until || Number.isNaN(Date.parse(outbox.paused_until))) return { action: "skip", reason: "invalid_pause_state" };
      return Date.parse(outbox.paused_until) <= nowMs
        ? { action: "retry", reason: "pause_expired" }
        : { action: "skip", reason: "paused_not_due" };
    }
    if (outbox.status === "retry_wait") {
      if (outbox.next_attempt_at && Number.isNaN(Date.parse(outbox.next_attempt_at))) {
        return { action: "skip", reason: "invalid_retry_state" };
      }
      return !outbox.next_attempt_at || Date.parse(outbox.next_attempt_at) <= nowMs
        ? { action: "retry", reason: "retry_due" }
        : { action: "skip", reason: "retry_not_due" };
    }
    if (outbox.status === "pending") return { action: "retry", reason: "pending_due" };
    return { action: "skip", reason: "pending_state_mismatch" };
  }
  if (["pending", "retry_wait", "paused", "blocked"].includes(outbox?.status)) {
    return { action: "skip", reason: "missing_pending_envelope" };
  }
  return candidateWindow
    ? { action: "discover", reason: "candidate_window" }
    : { action: "skip", reason: "outside_candidate_window" };
}

export async function validateStoredPendingEnvelope(outbox, cryptoImpl = globalThis.crypto) {
  const envelope = outbox?.pending_envelope;
  if (!envelope || !outbox?.pending_report_id || !outbox?.pending_content_hash) return { ok: false, reason: "pending_identity_missing" };
  if (envelope.id !== outbox.pending_report_id) return { ok: false, reason: "report_id_mismatch" };
  if (envelope.content_hash !== outbox.pending_content_hash) return { ok: false, reason: "content_hash_mismatch" };
  const actualHash = await sha256Hex(canonicalJson(envelope.typed_payload), cryptoImpl);
  if (actualHash !== outbox.pending_content_hash) return { ok: false, reason: "payload_hash_mismatch" };
  return { ok: true, idempotencyKey: outbox.pending_report_id };
}

export function shadowJournalEntry(candidate, { observedAt = new Date() } = {}) {
  if (!candidate?.catalog || candidate.catalog.runtime === "live") return null;
  return {
    event: "agent_report_shadow_candidate",
    observed_at: observedAt.toISOString(),
    retention_ceiling_at: new Date(observedAt.getTime() + candidate.catalog.retentionCeilingDays * DAY_MS).toISOString(),
    report_type: candidate.reportType,
    signal_kind: candidate.signalKind,
    schema_version: candidate.catalog.schemaVersion,
    disposition: candidate.catalog.runtime,
    sensitivity: candidate.catalog.sensitivity,
    confidence: candidate.confidence,
    significance: candidate.significance,
    novelty: candidate.novelty,
    recurrence: candidate.recurrence,
    content_hash: candidate.contentHash,
    typed_payload: candidate.typedPayload,
    model_used: false,
  };
}

export function isShadowJournalDue(candidate, { observedAt = new Date(), timeZone = "Asia/Shanghai" } = {}) {
  if (!candidate?.catalog || candidate.catalog.runtime === "live") return false;
  const frequencyDays = Math.max(1, Number(candidate.catalog.maxFrequencyDays) || 1);
  const dateKey = localDateKey(observedAt, timeZone);
  const [year, month, day] = dateKey.split("-").map(Number);
  const dayOrdinal = Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
  const signalOffset = [...catalogKey(candidate.reportType, candidate.signalKind)]
    .reduce((sum, char) => sum + char.charCodeAt(0), 0) % frequencyDays;
  return dayOrdinal % frequencyDays === signalOffset;
}
