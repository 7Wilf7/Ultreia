import { supabase } from '../supabase';
import { getCurrentUserId } from './_auth';

const FIELD_MAP = {
  apiKey:        'api_key',           // DeepSeek key (legacy column kept for that provider)
  apiModel:      'api_model',
  apiProvider:   'api_provider',      // 'deepseek' | 'claude'
  claudeApiKey:  'claude_api_key',    // Anthropic Claude API key
  coachConfig:   'coach_config',      // jsonb — pass plain object, do NOT JSON.stringify
  coachMemory:   'coach_memory',
  lang:          'lang',
  // Default coordinates for weather fetch when device geolocation is unavailable
  // (denied, offline, or APK without permission). WGS84, same as Caiyun expects.
  defaultLng:    'default_lng',
  defaultLat:    'default_lat',
  defaultLocationName: 'default_location_name',  // friendly label, e.g. "上海"
  // User-supplied Caiyun Weather API token. Empty = fall back to the shared
  // server-side token. Requires column `caiyun_api_key TEXT` on user_settings.
  caiyunApiKey:  'caiyun_api_key',
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
