import { supabase } from '../supabase';
import { getCurrentUserId } from './_auth';

const FIELD_MAP = {
  isTarget:      'is_target',
  priority:      'priority',
  name:          'name',
  date:          'date',
  distance:      'distance',
  category:      'category',
  ascent:        'ascent',
  itraScore:     'itra_score',
  resultSeconds: 'result_seconds',
  createdAt:     'created_at',
  updatedAt:     'updated_at',
};

// id / user_id are handled outside FIELD_MAP (id passes through; user_id is
// written only by create flows). createdAt / updatedAt are server-managed.
const WRITE_SKIP = new Set(['createdAt', 'updatedAt']);

function fromRow(row) {
  if (!row) return null;

  // Derive H/M/S string fields from the merged result_seconds int — the form
  // inputs in RacesTab are three separate <input>s and PersonalRecordsTab
  // reads resultH/M/S directly via parseInt(). We expose the raw seconds too
  // so callers that want to sort / aggregate don't have to reassemble.
  let resultSeconds, resultH, resultM, resultS;
  if (row.result_seconds != null) {
    resultSeconds = row.result_seconds;
    resultH = String(Math.floor(resultSeconds / 3600));
    resultM = String(Math.floor((resultSeconds % 3600) / 60));
    resultS = String(resultSeconds % 60);
  } else {
    resultSeconds = null;
    resultH = '';
    resultM = '';
    resultS = '';
  }

  return {
    id:        row.id,
    isTarget:  !!row.is_target,
    priority:  row.priority ?? null,        // null when history (DB CHECK)
    name:      row.name ?? '',
    date:      row.date ?? '',
    distance:  row.distance ?? null,        // numeric, kept as number — fresh start, no string units
    category:  row.category ?? '',
    ascent:    row.ascent ?? null,          // int, kept as number
    itraScore: row.itra_score ?? null,      // int, kept as number
    resultSeconds,
    resultH, resultM, resultS,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

function toRow(patch) {
  const out = {};

  // Plain passthrough fields. Bool / text / date — Supabase handles the types.
  for (const camel of ['isTarget', 'name', 'date', 'category']) {
    if (camel in patch && patch[camel] !== undefined) {
      out[FIELD_MAP[camel]] = patch[camel];
    }
  }

  // distance: accept a number, or extract the first number from a legacy
  // string like "Marathon (42.195 km)". RacesTab already pre-parses, but the
  // DAL stays defensive so AI Coach / future callers can pass either form.
  if ('distance' in patch && patch.distance !== undefined) {
    const v = patch.distance;
    if (v === null || v === '') {
      out.distance = null;
    } else if (typeof v === 'number') {
      out.distance = Number.isFinite(v) ? v : null;
    } else {
      const m = String(v).match(/[\d.]+/);
      out.distance = m ? Number(m[0]) : null;
    }
  }

  // ascent / itra_score — DB INTEGER columns. Same Math.round defense as
  // workouts.js (Garmin sometimes hands us floats; users sometimes type "12.5").
  for (const camel of ['ascent', 'itraScore']) {
    if (camel in patch && patch[camel] !== undefined) {
      const v = patch[camel];
      const snake = FIELD_MAP[camel];
      if (v === null || v === '') {
        out[snake] = null;
      } else {
        const n = typeof v === 'number' ? v : Number(v);
        out[snake] = Number.isFinite(n) ? Math.round(n) : null;
      }
    }
  }

  // result_seconds: prefer an explicit `resultSeconds` patch field; otherwise
  // assemble from the three H/M/S strings (legacy form shape).
  if ('resultSeconds' in patch && patch.resultSeconds !== undefined) {
    const v = patch.resultSeconds;
    out.result_seconds = (v === null || v === '') ? null : Number(v);
  } else if ('resultH' in patch || 'resultM' in patch || 'resultS' in patch) {
    const h = Number(patch.resultH || 0);
    const m = Number(patch.resultM || 0);
    const s = Number(patch.resultS || 0);
    const total = h * 3600 + m * 60 + s;
    out.result_seconds = total > 0 ? total : null;
  }

  // priority: enforces the DB CHECK constraint that history rows have null
  // priority. isTarget === false always forces priority = null even if the
  // caller forgot to clear it.
  if ('isTarget' in patch || 'priority' in patch) {
    const isTarget = patch.isTarget;
    if (isTarget === false) {
      out.priority = null;
    } else if (isTarget === true) {
      out.priority = patch.priority || null;
    } else if ('priority' in patch) {
      // Only priority changed (e.g. user re-prioritising an existing target).
      // We don't know isTarget here; let the DB CHECK surface inconsistencies.
      out.priority = patch.priority || null;
    }
  }

  // Defensive: WRITE_SKIP fields should never reach here, but make it explicit
  for (const skipCamel of WRITE_SKIP) {
    delete out[FIELD_MAP[skipCamel]];
  }

  return out;
}

export async function listMyRaces() {
  // Order by created_at desc so newly added races come first regardless of
  // their (possibly missing) `date` field. RacesTab re-sorts internally:
  // targets ASC by date for "next up", history DESC by date for "most recent".
  const { data, error } = await supabase
    .from('races')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('listMyRaces failed:', error);
    throw new Error(error.message);
  }
  return (data ?? []).map(fromRow);
}

export async function createRace(race) {
  const userId = await getCurrentUserId();
  const row = { ...toRow(race), user_id: userId };
  const { data, error } = await supabase
    .from('races')
    .insert(row)
    .select('*')
    .single();
  if (error) {
    console.error('createRace failed:', error);
    throw new Error(error.message);
  }
  return fromRow(data);
}

export async function updateRace(id, patch) {
  const { data, error } = await supabase
    .from('races')
    .update(toRow(patch))
    .eq('id', id)
    .select('*')
    .single();
  if (error) {
    console.error('updateRace failed:', error);
    throw new Error(error.message);
  }
  return fromRow(data);
}

export async function deleteRace(id) {
  const { error } = await supabase.from('races').delete().eq('id', id);
  if (error) {
    console.error('deleteRace failed:', error);
    throw new Error(error.message);
  }
}
