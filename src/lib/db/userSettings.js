import { supabase } from '../supabase';
import { getCurrentUserId } from './_auth';

const FIELD_MAP = {
  apiKey:        'api_key',           // legacy personal API key column; no longer exposed in UI
  apiModel:      'api_model',
  apiProvider:   'api_provider',      // legacy provider column
  claudeApiKey:  'claude_api_key',    // legacy personal API key column
  coachConfig:   'coach_config',      // jsonb — pass plain object, do NOT JSON.stringify
  coachMemory:   'coach_memory',      // legacy free-text memory; no longer sent to the LLM
  coachMemoryZh: 'coach_memory_zh',    // legacy free-text memory mirror; kept for one-off cleanup/back-compat
  lang:          'lang',
  // Default coordinates for weather fetch when device geolocation is unavailable
  // (denied, offline, or APK without permission). WGS84, same as Caiyun expects.
  defaultLng:    'default_lng',
  defaultLat:    'default_lat',
  defaultLocationName: 'default_location_name',  // friendly label, e.g. "上海"
  // Legacy user-supplied Caiyun token column; weather now uses wallet-backed
  // Edge Function secrets instead of per-user tokens.
  caiyunApiKey:  'caiyun_api_key',
  // Daily coach push (Android APK). The server-side dispatch reads these to
  // decide who to push to and when. pushHours is up to 3 LOCAL hours (0–23)
  // for multi-session days; pushTimezone is an IANA name (auto-detected on
  // save) so the server can map those hours to UTC.
  pushEnabled:   'push_enabled',
  pushHours:     'push_hours',     // int[] — LEGACY whole-hour list, kept for back-compat
  pushTimes:     'push_times',     // text[] — "HH:MM" half-hour slots, e.g. ["08:00","13:30"]
  pushTimezone:  'push_timezone',
  // AI weekly report automation. The server cron reads these fields together
  // with pushTimezone (shared IANA timezone) and generates the report even
  // when the app is closed.
  weeklyReportEnabled: 'weekly_report_enabled',
  weeklyReportWeekday: 'weekly_report_weekday', // 0 Sunday ... 6 Saturday
  weeklyReportTime: 'weekly_report_time',       // "HH:MM"
  weeklyReportAfterSundayImport: 'weekly_report_after_sunday_import',
  aiProviderPreference: 'ai_provider_preference', // "auto" | "prefer_codex" | "deepseek_only"
};

function fromRow(row) {
  if (!row) return null;
  const out = {};
  for (const [camel, snake] of Object.entries(FIELD_MAP)) {
    const v = row[snake];
    if (camel === 'coachConfig') {
      // jsonb arrives as a parsed object; null when unset.
      out[camel] = (v && typeof v === 'object') ? v : null;
    } else if (camel === 'defaultLng' || camel === 'defaultLat') {
      // numeric → keep as number, null when unset (caller checks isFinite).
      out[camel] = (v === null || v === undefined) ? null : Number(v);
    } else if (camel === 'pushHours') {
      // int[] → always an array; coerce members to numbers.
      out[camel] = Array.isArray(v) ? v.map(Number).filter(Number.isFinite) : [];
    } else if (camel === 'pushTimes') {
      // text[] of "HH:MM" → always an array of strings.
      out[camel] = Array.isArray(v) ? v.map(String).filter(Boolean) : [];
    } else if (camel === 'pushEnabled' || camel === 'weeklyReportEnabled') {
      // boolean → null defends as false.
      out[camel] = v === true;
    } else if (camel === 'weeklyReportAfterSundayImport') {
      // Existing rows may be null until the new column is backfilled; keep the
      // Sunday prompt on by default because it is user-confirmed and low risk.
      out[camel] = v !== false;
    } else if (camel === 'weeklyReportWeekday') {
      const n = Number(v);
      out[camel] = Number.isInteger(n) && n >= 0 && n <= 6 ? n : 0;
    } else if (camel === 'weeklyReportTime') {
      out[camel] = typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) ? v : '20:00';
    } else {
      out[camel] = v ?? '';
    }
  }
  return out;
}

function toRow(patch) {
  const out = {};
  for (const [camel, snake] of Object.entries(FIELD_MAP)) {
    if (!(camel in patch)) continue;
    out[snake] = patch[camel];
  }
  return out;
}

export async function getMySettings() {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from('user_settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    console.error('getMySettings failed:', error);
    throw new Error(error.message);
  }
  return fromRow(data);
}

export async function updateMySettings(patch) {
  const userId = await getCurrentUserId();
  const row = { user_id: userId, ...toRow(patch) };
  const { data, error } = await supabase
    .from('user_settings')
    .upsert(row, { onConflict: 'user_id' })
    .select()
    .maybeSingle();
  if (error) {
    console.error('updateMySettings failed:', error);
    throw new Error(error.message);
  }
  return fromRow(data);
}
