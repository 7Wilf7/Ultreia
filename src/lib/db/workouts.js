import { supabase } from '../supabase';
import { getCurrentUserId } from './_auth';

const FIELD_MAP = {
  date:       'date',
  type:       'type',
  subTypes:   'sub_types',     // text[]
  distance:   'distance',
  duration:   'duration',
  pace:       'pace',
  hr:         'hr',
  maxHR:      'max_hr',
  ascent:     'ascent',
  cadence:    'cadence',
  aerobicTE:  'aerobic_te',
  gap:        'gap',
  createdAt:  'created_at',
  updatedAt:  'updated_at',
};

// id, user_id, source are not in FIELD_MAP:
// - id        : server-generated uuid, copied straight through in fromRow
// - user_id   : RLS-scoped; written by createWorkout / bulkInsertWorkouts only
// - source    : provenance ('manual' / 'garmin_csv' / 'fit_file'); set by the
//               write functions, not exposed to the form layer yet.
const ARRAY_FIELDS = new Set(['subTypes']);
const WRITE_SKIP = new Set(['createdAt', 'updatedAt']);  // server-managed

// Columns the DB stores as INTEGER. Garmin CSV occasionally hands us floats
// (e.g. cadence "173.4", duration "435.9") which Postgres rejects. Round
// defensively in toRow. NUMERIC columns — distance / pace / ascent / aerobic_te
// / gap — keep their original precision.
const INT_FIELDS = new Set(['duration', 'hr', 'maxHR', 'cadence']);

function fromRow(row) {
  if (!row) return null;
  const out = { id: row.id };
  for (const [camel, snake] of Object.entries(FIELD_MAP)) {
    const v = row[snake];
    if (ARRAY_FIELDS.has(camel)) {
      out[camel] = Array.isArray(v) ? v : [];
    } else {
      out[camel] = v ?? (typeof v === 'number' ? 0 : '');
    }
  }
  return out;
}

function toRow(patch) {
  const out = {};
  for (const [camel, snake] of Object.entries(FIELD_MAP)) {
    if (WRITE_SKIP.has(camel)) continue;
    if (!(camel in patch)) continue;     // skip undefined → don't overwrite
    const v = patch[camel];
    if (INT_FIELDS.has(camel)) {
      if (v === null || v === '') {
        out[snake] = null;
      } else {
        const n = typeof v === 'number' ? v : Number(v);
        out[snake] = Number.isFinite(n) ? Math.round(n) : null;
      }
    } else {
      out[snake] = v;
    }
  }
  return out;
}

export async function listMyWorkouts() {
  const { data, error } = await supabase
    .from('workouts')
    .select('*')
    .order('date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) {
    console.error('listMyWorkouts failed:', error);
    throw new Error(error.message);
  }
  return (data ?? []).map(fromRow);
}

export async function createWorkout(workout, { source = 'manual' } = {}) {
  const userId = await getCurrentUserId();
  const row = { ...toRow(workout), user_id: userId, source };
  const { data, error } = await supabase
    .from('workouts')
    .insert(row)
    .select('*')
    .single();
  if (error) {
    console.error('createWorkout failed:', error);
    throw new Error(error.message);
  }
  return fromRow(data);
}

export async function updateWorkout(id, patch) {
  const { data, error } = await supabase
    .from('workouts')
    .update(toRow(patch))
    .eq('id', id)
    .select('*')
    .single();
  if (error) {
    console.error('updateWorkout failed:', error);
    throw new Error(error.message);
  }
  return fromRow(data);
}

export async function deleteWorkout(id) {
  const { error } = await supabase.from('workouts').delete().eq('id', id);
  if (error) {
    console.error('deleteWorkout failed:', error);
    throw new Error(error.message);
  }
}

// Batch delete — single round-trip via .in('id', ids). Used by the
// "select-then-bulk-delete" flow in ActivitiesTab and the App.jsx
// confirm-delete modal.
export async function deleteWorkouts(ids) {
  if (!ids || ids.length === 0) return;
  const { error } = await supabase.from('workouts').delete().in('id', ids);
  if (error) {
    console.error('deleteWorkouts failed:', error);
    throw new Error(error.message);
  }
}

export async function bulkInsertWorkouts(workouts, { source = 'garmin_csv' } = {}) {
  if (!workouts || workouts.length === 0) return [];
  const userId = await getCurrentUserId();
  const rows = workouts.map(w => ({ ...toRow(w), user_id: userId, source }));

  const BATCH_SIZE = 500;
  const inserted = [];
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const slice = rows.slice(i, i + BATCH_SIZE);
    const { data, error } = await supabase
      .from('workouts')
      .insert(slice)
      .select('*');
    if (error) {
      console.error(`bulkInsertWorkouts batch ${i}-${i + slice.length} failed:`, error);
      // Partial failure: earlier successful batches are not rolled back.
      // Tell the caller how far we got so the UI can show a useful message.
      throw new Error(
        `Imported ${inserted.length} workouts successfully, but next batch failed: ${error.message}`
      );
    }
    inserted.push(...data);
  }
  return inserted.map(fromRow);
}
