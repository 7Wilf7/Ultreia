import { supabase } from '../supabase';
import { getCurrentUserId } from './_auth';

const FIELD_MAP = {
  displayName:     'display_name',
  birthDate:       'birth_date',
  gender:          'gender',
  city:            'city',
  occupation:      'occupation',
  occupationOther: 'occupation_other',
  experience:      'experience',
  raceTypes:       'race_types',
  recentInjuries:  'recent_injuries',
  injuriesNote:    'injuries_note',
  equipment:       'equipment',
  equipmentOther:  'equipment_other',
  restingHR:       'resting_hr',
  maxHR:           'max_hr',
  hrZoneMethod:    'hr_zone_method',
  notes:           'notes',
  itraPI:          'itra_pi',
};

const INT_FIELDS = new Set(['restingHR', 'maxHR', 'itraPI']);
const ARRAY_FIELDS = new Set(['raceTypes', 'recentInjuries', 'equipment']);

function fromRow(row) {
  if (!row) return null;
  const out = {};
  for (const [camel, snake] of Object.entries(FIELD_MAP)) {
    const v = row[snake];
    if (INT_FIELDS.has(camel)) {
      // DB int → UI string; UI controls (input type="number") read strings.
      out[camel] = v == null ? '' : String(v);
    } else if (ARRAY_FIELDS.has(camel)) {
      out[camel] = Array.isArray(v) ? v : [];
    } else {
      out[camel] = v ?? '';
    }
  }
  return out;
}

function toRow(patch) {
  const out = {};
  for (const [camel, snake] of Object.entries(FIELD_MAP)) {
    if (!(camel in patch)) continue;     // only write fields present in patch
    const v = patch[camel];
    if (INT_FIELDS.has(camel)) {
      if (v === '' || v == null) {
        out[snake] = null;
      } else {
        const n = typeof v === 'number' ? v : parseInt(v, 10);
        out[snake] = Number.isFinite(n) ? n : null;
      }
    } else {
      out[snake] = v;
    }
  }
  return out;
}

export async function getMyProfile() {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    console.error('getMyProfile failed:', error);
    throw new Error(error.message);
  }
  return fromRow(data);
}

export async function updateMyProfile(patch) {
  const userId = await getCurrentUserId();
  const row = { id: userId, ...toRow(patch) };
  const { data, error } = await supabase
    .from('profiles')
    .upsert(row)
    .select()
    .maybeSingle();
  if (error) {
    console.error('updateMyProfile failed:', error);
    throw new Error(error.message);
  }
  return fromRow(data);
}
