import { supabase } from '../supabase';
import { getCurrentUserId } from './_auth';

const FIELD_MAP = {
  apiKey:       'api_key',
  apiModel:     'api_model',
  coachConfig:  'coach_config',   // jsonb — pass plain object, do NOT JSON.stringify
  coachMemory:  'coach_memory',
  lang:         'lang',
};

function fromRow(row) {
  if (!row) return null;
  const out = {};
  for (const [camel, snake] of Object.entries(FIELD_MAP)) {
    const v = row[snake];
    if (camel === 'coachConfig') {
      // jsonb arrives as a parsed object; null when unset.
      out[camel] = (v && typeof v === 'object') ? v : null;
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
