// Backward-compatible data migrations.
// Applied once at app boot to logs loaded from localStorage.

import { parseDistanceKm } from "./format";

const RUN_PACE_SET = new Set(["Easy Run", "Aerobic Run", "Tempo Run", "Interval Run", "Recovery Run"]);

// Pace sub-types belong only to Running. Any other top-level type that still
// has these in subTypes is stale (left over from old data or a type-change in
// the form). Listed here so we can scrub them in migration.
const STALE_PACE_TYPES = new Set(["Easy Run", "Aerobic Run", "Tempo Run", "Interval Run", "Recovery Run"]);

export function migrateLog(log) {
  let out = { ...log };

  // Aerobic → Strength (sub-types Upper/Lower/Core kept as-is, they're already correct)
  if (out.type === "Aerobic") {
    out.type = "Strength";
  }

  // Stair Climbing → Floor Climbing (renamed for clearer terminology)
  if (out.type === "Stair Climbing") {
    out.type = "Floor Climbing";
  }

  // Recovery Run → Easy Run (sub-type collapsed)
  if (Array.isArray(out.subTypes) && out.subTypes.includes("Recovery Run")) {
    out.subTypes = out.subTypes.map(s => s === "Recovery Run" ? "Easy Run" : s);
    // dedupe in case both existed
    out.subTypes = [...new Set(out.subTypes)];
  }

  // Strip stale pace sub-types from non-Running activities. Earlier versions
  // could leave "Easy Run" on a Strength/Trail/etc entry when the user changed
  // the type without clearing sub-types.
  if (out.type !== "Running" && Array.isArray(out.subTypes) && out.subTypes.length > 0) {
    out.subTypes = out.subTypes.filter(st => !STALE_PACE_TYPES.has(st));
  }

  // Backfill Garmin metrics (added later) — keep 0 = "not recorded" for clean display
  if (out.maxHR == null) out.maxHR = 0;
  if (out.cadence == null) out.cadence = 0;
  if (out.aerobicTE == null) out.aerobicTE = 0;
  if (out.gap == null) out.gap = 0; // seconds per km, same convention as `pace`

  return out;
}

export function migrateLogs(logs) {
  if (!Array.isArray(logs)) return logs;
  return logs.map(migrateLog);
}

// Heuristic: infer a race category from its name + distance string
export function inferRaceCategory(race) {
  const text = `${race.name || ""} ${race.distance || ""}`.toLowerCase();
  if (/hyrox/.test(text)) return "Hyrox";
  if (/spartan|spartrace|spartanraz/.test(text)) return "Spartan";
  if (/(^|\W)(half\s*marathon|半马|半程马拉松|21\.1|21\.0975|13\.1\s*mi)/.test(text)) return "Half Marathon";
  if (/(^|\W)(marathon|全马|马拉松|42\.195|42km|26\.2\s*mi)/.test(text)) return "Marathon";
  if (/(trail|越野|skyrun|sky\s*race|utm|ultra)/.test(text)) return "Trail";
  if (/(^|\W)(10\s*k|10km|10\.0\s*km)/.test(text)) return "10K";
  return "";
}

export function migrateRace(race) {
  if (!race) return race;
  const out = { ...race };
  // Distance: normalize legacy string forms ("Marathon (42.195 km)", "42.195km", "42.195")
  // to a plain number in km. Stored shape is now always Number (or undefined/0).
  if (typeof out.distance === "string") {
    out.distance = parseDistanceKm(out.distance);
  }
  if (!out.category) {
    out.category = inferRaceCategory(out) || "";
  }
  return out;
}

export function migrateRaces(races) {
  if (!Array.isArray(races)) return races;
  return races.map(migrateRace);
}

// Old experience IDs (mixed level + event type) → new pure-years IDs (rough mapping)
const EXPERIENCE_OLD_TO_NEW = {
  "beginner": "<1y",
  "regular": "1-3y",
  "marathoner": "3-5y",
  "trail-runner": "3-5y",
  "multi-sport": "5-10y",
};

export function migrateProfile(profile) {
  if (!profile || typeof profile !== "object") return profile;
  const out = { ...profile };

  // experience: map old enum values to year-based ones
  if (out.experience && EXPERIENCE_OLD_TO_NEW[out.experience]) {
    out.experience = EXPERIENCE_OLD_TO_NEW[out.experience];
  }

  // injuries → recentInjuries (rename)
  if (Array.isArray(out.injuries) && !Array.isArray(out.recentInjuries)) {
    out.recentInjuries = out.injuries;
    delete out.injuries;
  }

  // HR fields added later — initialise so the editor controls render cleanly
  if (out.restingHR == null) out.restingHR = "";
  if (out.maxHR == null) out.maxHR = "";
  if (!out.hrZoneMethod) out.hrZoneMethod = "karvonen-strict";

  return out;
}

// Old coach style/intervention IDs collapsed to 3-point spectrum
const COACH_STYLE_OLD_TO_NEW = {
  "data-analytical": "analytical",
  "performance":     "analytical",
  "calm-rational":   "balanced",
  "encouraging":     "soft",
  "casual":          "soft",
};
const COACH_INTERVENTION_OLD_TO_NEW = {
  "minimal":   "light",
  "risk-only": "light",
};

export function migrateCoachConfig(cfg) {
  if (!cfg || typeof cfg !== "object") return cfg;
  const out = { ...cfg };
  if (out.style && COACH_STYLE_OLD_TO_NEW[out.style]) {
    out.style = COACH_STYLE_OLD_TO_NEW[out.style];
  }
  if (out.intervention && COACH_INTERVENTION_OLD_TO_NEW[out.intervention]) {
    out.intervention = COACH_INTERVENTION_OLD_TO_NEW[out.intervention];
  }
  return out;
}
