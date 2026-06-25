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
  note:       'note',          // text — optional free-text note ("new shoes", "knee tight")
  rpe:        'rpe',           // smallint 1–10 — required by UI for completed sessions; legacy/planned rows may be null
  isPlanned:  'is_planned',    // boolean — future plan (true) vs completed (false)
  planStatus: 'plan_status',   // text 'pending'|'done' (planned rows only; legacy 'skipped' is ignored)
  tags:       'tags',          // text[]  — e.g. ['massage', 'stretching']
  startedAt:  'started_at',    // timestamptz — when the activity actually started; null = unknown
  weather:    'weather',       // jsonb — snapshot from src/lib/weather.js (tempC, apparentC, humidity, skycon, ...)
  planDetail: 'plan_detail',   // jsonb — planned-only structured extras that have no column: { speed (km/h, cycling), subTypeDurations ({area:min}, strength) }
  hrZoneSeconds: 'hr_zone_seconds', // jsonb — [z1,z2,z3,z4,z5] seconds in each HR zone (FIT import only)
  gpsTrack:   'gps_track',     // jsonb — downsampled [[lat,lng],...] route (FIT import only)
  createdAt:  'created_at',
  updatedAt:  'updated_at',
};

// id, user_id, source are not in FIELD_MAP:
// - id        : server-generated uuid, copied straight through in fromRow
// - user_id   : RLS-scoped; written by createWorkout / bulkInsertWorkouts only
// - source    : provenance ('manual' / 'garmin_csv' / 'fit_file' / 'calendar_plan');
//               set by the write functions, not exposed to the form layer yet.
const ARRAY_FIELDS = new Set(['subTypes', 'tags']);
const BOOL_FIELDS  = new Set(['isPlanned']);
// JSONB columns: arrive as parsed objects, write through unchanged. Do NOT
// run them through the "missing → '' default" path in fromRow.
const JSON_FIELDS  = new Set(['weather', 'planDetail', 'hrZoneSeconds', 'gpsTrack']);
// Timestamps come back as ISO strings; preserve null when unset rather than
// coercing to '' (the down-stream weather logic does Number(new Date(v))).
const TS_FIELDS    = new Set(['startedAt']);
// Nullable text columns with a DB CHECK constraint: an empty string would
// violate the constraint, so '' / null must always write through as null.
const NULLABLE_TEXT_FIELDS = new Set(['planStatus']);
const WRITE_SKIP = new Set(['createdAt', 'updatedAt']);  // server-managed

// Columns to fetch for the activity list. Deliberately EXCLUDES gps_track —
// the downsampled route (~300 points/row) is only needed for the future
// share-poster, never for the list / charts / AI prompt. With hundreds of
// FIT-imported rows it's several MB; pulling it on every boot was the main
// cause of the slow / watchdog-tripping startup. fromRow defends the missing
// column (→ null). Fetch gps_track on demand per-row when posters land.
const LIST_COLUMNS = ['id', ...Object.values(FIELD_MAP).filter(c => c !== 'gps_track')].join(', ');

// Columns the DB stores as INTEGER. Garmin CSV occasionally hands us floats
// (e.g. cadence "173.4", duration "435.9") which Postgres rejects. Round
// defensively in toRow. NUMERIC columns — distance / pace / ascent / aerobic_te
// / gap — keep their original precision.
const INT_FIELDS = new Set(['duration', 'hr', 'maxHR', 'cadence', 'rpe']);

function fromRow(row) {
  if (!row) return null;
  const out = { id: row.id };
  for (const [camel, snake] of Object.entries(FIELD_MAP)) {
    const v = row[snake];
    if (ARRAY_FIELDS.has(camel)) {
      out[camel] = Array.isArray(v) ? v : [];
    } else if (BOOL_FIELDS.has(camel)) {
      // null → false (DEFAULT FALSE on the column, but defend anyway).
      out[camel] = v === true;
    } else if (JSON_FIELDS.has(camel)) {
      // jsonb → already an object; null when unset.
      out[camel] = (v && typeof v === 'object') ? v : null;
    } else if (TS_FIELDS.has(camel)) {
      // timestamptz → ISO string, or null. Keep null so callers can branch.
      out[camel] = v || null;
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
    } else if (NULLABLE_TEXT_FIELDS.has(camel)) {
      out[snake] = (v === '' || v == null) ? null : v;
    } else {
      out[snake] = v;
    }
  }
  return out;
}

export async function listMyWorkouts() {
  const { data, error } = await supabase
    .from('workouts')
    .select(LIST_COLUMNS)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) {
    console.error('listMyWorkouts failed:', error);
    throw new Error(error.message);
  }
  return (data ?? []).map(fromRow);
}

export async function getWorkoutGpsTrack(id) {
  if (!id) return null;
  const { data, error } = await supabase
    .from('workouts')
    .select('gps_track')
    .eq('id', id)
    .single();
  if (error) {
    console.error('getWorkoutGpsTrack failed:', error);
    throw new Error(error.message);
  }
  return Array.isArray(data?.gps_track) ? data.gps_track : null;
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

// Delete the PLANNED rows on the given dates (completed workouts untouched).
// Used by the coach calendar-import so re-importing a plan REPLACES the day's
// plan instead of stacking a second row on top. RLS scopes to the user; we add
// an explicit user_id filter as belt-and-braces.
export async function deletePlannedOnDates(dates) {
  const unique = [...new Set((dates || []).filter(Boolean))];
  if (unique.length === 0) return;
  const userId = await getCurrentUserId();
  const { error } = await supabase
    .from('workouts')
    .delete()
    .eq('user_id', userId)
    .eq('is_planned', true)
    .in('date', unique);
  if (error) {
    console.error('deletePlannedOnDates failed:', error);
    throw new Error(error.message);
  }
}

// Delete only the named PLANNED rows. Used when an Agent Action modifies one
// future plan without wiping other planned rows on the same date.
export async function deletePlannedByIds(ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (unique.length === 0) return;
  const userId = await getCurrentUserId();
  const { error } = await supabase
    .from('workouts')
    .delete()
    .eq('user_id', userId)
    .eq('is_planned', true)
    .in('id', unique);
  if (error) {
    console.error('deletePlannedByIds failed:', error);
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
