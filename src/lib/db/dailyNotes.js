import { supabase } from '../supabase';
import { getCurrentUserId } from './_auth';

const SUPPORTED_DAILY_TAGS = new Set(['planned_rest', 'massage', 'stretching', 'sick']);

// daily_notes: one row per (user_id, date). Holds day-level metadata that
// doesn't fit on a single workout — tags[] plus morning readiness. Calendar
// reads this alongside workouts; the Activities list does NOT touch it.
//
// Schema (see project CLAUDE.md / SQL migration):
//   id          uuid PK
//   user_id     uuid → auth.users
//   date        date (UNIQUE per user)
//   tags        text[] NOT NULL DEFAULT '{}'
//   created_at  timestamptz
//   updated_at  timestamptz

function fromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    date: row.date,
    tags: Array.isArray(row.tags) ? row.tags : [],
    // Legacy travel destination. Kept in the row mapper so old rows can still
    // load, but new tag writes clear it because travel is no longer a day tag.
    travelDest: row.travel_dest ?? '',
    // Morning readiness self-check (1=poor 2=ok 3=good), null when not logged.
    // Feeds the coach so it can judge "push or back off today".
    readiness: (row.readiness_sleep != null || row.readiness_legs != null || row.readiness_energy != null)
      ? { sleep: row.readiness_sleep ?? null, legs: row.readiness_legs ?? null, energy: row.readiness_energy ?? null }
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listMyDailyNotes() {
  const { data, error } = await supabase
    .from('daily_notes')
    .select('*')
    .order('date', { ascending: false });
  if (error) {
    console.error('listMyDailyNotes failed:', error);
    throw new Error(error.message);
  }
  return (data ?? []).map(fromRow);
}

// Upsert by (user_id, date). If tags=[] we delete the row instead — there's
// no point storing empty notes, and it keeps the table tidy. Returns the
// resulting row (or null if deleted).
export async function setDailyTags(date, tags, travelDest = '') {
  if (!date) throw new Error('setDailyTags: date is required');
  const cleanTags = Array.isArray(tags) ? tags.filter(tag => SUPPORTED_DAILY_TAGS.has(tag)) : [];
  // Destination only made sense alongside the retired "travel" tag.
  const dest = cleanTags.includes('travel') ? (travelDest || '').trim() : '';

  if (cleanTags.length === 0) {
    // Clear tags but DON'T delete the row — a readiness check-in may live on
    // the same (user, date) row and must survive clearing the day's tags.
    // Upsert only the tag columns; readiness columns are left untouched.
    const userId = await getCurrentUserId();
    const { data, error } = await supabase
      .from('daily_notes')
      .upsert({ user_id: userId, date, tags: [], travel_dest: null }, { onConflict: 'user_id,date' })
      .select('*')
      .single();
    if (error) {
      console.error('setDailyTags (clear) failed:', error);
      throw new Error(error.message);
    }
    return fromRow(data);
  }

  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from('daily_notes')
    .upsert(
      { user_id: userId, date, tags: cleanTags, travel_dest: dest || null },
      { onConflict: 'user_id,date' }
    )
    .select('*')
    .single();
  if (error) {
    console.error('setDailyTags (upsert) failed:', error);
    throw new Error(error.message);
  }
  return fromRow(data);
}

// Upsert the morning readiness check-in for a date (1–3 each, or null to clear
// a field). Only touches the readiness columns — tags on the same row
// are preserved. Returns the resulting row.
export async function setReadiness(date, { sleep = null, legs = null, energy = null } = {}) {
  if (!date) throw new Error('setReadiness: date is required');
  const clamp = (v) => (v == null ? null : Math.max(1, Math.min(3, Math.round(Number(v)))) || null);
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from('daily_notes')
    .upsert(
      { user_id: userId, date, readiness_sleep: clamp(sleep), readiness_legs: clamp(legs), readiness_energy: clamp(energy) },
      { onConflict: 'user_id,date' }
    )
    .select('*')
    .single();
  if (error) {
    console.error('setReadiness failed:', error);
    throw new Error(error.message);
  }
  return fromRow(data);
}
