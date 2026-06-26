import { supabase } from '../supabase';
import { getCurrentUserId } from './_auth';

const FIELD_MAP = {
  clientId: 'client_id',
  name: 'name',
  cityName: 'city_name',
  address: 'address',
  lat: 'lat',
  lng: 'lng',
  source: 'source',
  isDefaultWeather: 'is_default_weather',
  isArchived: 'is_archived',
  sortOrder: 'sort_order',
  notes: 'notes',
  metadata: 'metadata',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

const WRITE_SKIP = new Set(['createdAt', 'updatedAt', 'isArchived']);
const JSON_FIELDS = new Set(['metadata']);

function makeClientId() {
  return `loc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cleanNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function fromRow(row) {
  if (!row) return null;
  const out = { id: row.id };
  for (const [camel, snake] of Object.entries(FIELD_MAP)) {
    const v = row[snake];
    if (camel === 'lat' || camel === 'lng') out[camel] = cleanNumber(v);
    else if (camel === 'isDefaultWeather' || camel === 'isArchived') out[camel] = v === true;
    else if (camel === 'sortOrder') out[camel] = Number.isFinite(Number(v)) ? Number(v) : 0;
    else if (JSON_FIELDS.has(camel)) out[camel] = (v && typeof v === 'object') ? v : {};
    else out[camel] = v ?? '';
  }
  return out;
}

function toRow(patch) {
  const out = {};
  for (const [camel, snake] of Object.entries(FIELD_MAP)) {
    if (WRITE_SKIP.has(camel)) continue;
    if (!(camel in patch)) continue;
    const v = patch[camel];
    if (camel === 'lat' || camel === 'lng') out[snake] = cleanNumber(v);
    else if (camel === 'name') out[snake] = String(v || '').trim();
    else if (camel === 'source') out[snake] = String(v || 'manual').trim();
    else if (camel === 'metadata') out[snake] = (v && typeof v === 'object') ? v : {};
    else out[snake] = v;
  }
  return out;
}

export async function listMyLocations() {
  const { data, error } = await supabase
    .from('training_locations')
    .select('*')
    .eq('is_archived', false)
    .order('is_default_weather', { ascending: false })
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });
  if (error) {
    console.error('listMyLocations failed:', error);
    throw new Error(error.message);
  }
  return (data ?? []).map(fromRow);
}

export async function createLocation(location) {
  const userId = await getCurrentUserId();
  const wantDefault = location?.isDefaultWeather === true;
  const row = {
    user_id: userId,
    client_id: location?.clientId || makeClientId(),
    ...toRow({ ...location, isDefaultWeather: false }),
  };
  if (!row.name) row.name = 'Training place';
  const { data, error } = await supabase
    .from('training_locations')
    .insert(row)
    .select('*')
    .single();
  if (error) {
    console.error('createLocation failed:', error);
    throw new Error(error.message);
  }
  const created = fromRow(data);
  return wantDefault ? setDefaultLocation(created.id) : created;
}

export async function updateLocation(id, patch) {
  const { data, error } = await supabase
    .from('training_locations')
    .update(toRow(patch))
    .eq('id', id)
    .select('*')
    .single();
  if (error) {
    console.error('updateLocation failed:', error);
    throw new Error(error.message);
  }
  return fromRow(data);
}

export async function setDefaultLocation(id) {
  const userId = await getCurrentUserId();
  const { data: target, error: targetError } = await supabase
    .from('training_locations')
    .select('*')
    .eq('user_id', userId)
    .eq('id', id)
    .eq('is_archived', false)
    .single();
  if (targetError) {
    console.error('setDefaultLocation target failed:', targetError);
    throw new Error(targetError.message);
  }

  const { error: clearError } = await supabase
    .from('training_locations')
    .update({ is_default_weather: false })
    .eq('user_id', userId)
    .eq('is_archived', false);
  if (clearError) {
    console.error('setDefaultLocation clear failed:', clearError);
    throw new Error(clearError.message);
  }

  const { data, error } = await supabase
    .from('training_locations')
    .update({ is_default_weather: true })
    .eq('user_id', userId)
    .eq('id', id)
    .select('*')
    .single();
  if (error) {
    console.error('setDefaultLocation failed:', error);
    throw new Error(error.message);
  }
  return fromRow(data || { ...target, is_default_weather: true });
}

export async function archiveLocation(id) {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from('training_locations')
    .update({ is_archived: true, is_default_weather: false })
    .eq('user_id', userId)
    .eq('id', id)
    .select('*')
    .single();
  if (error) {
    console.error('archiveLocation failed:', error);
    throw new Error(error.message);
  }
  return fromRow(data);
}
