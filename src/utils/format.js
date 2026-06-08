// Personalised heart-rate-based run-type RECOMMENDATION. Returns one of
// "Easy Run" / "Aerobic Run" / "Tempo Run", or "" when the average HR is too
// high to attribute confidently (could be tempo, threshold, or an interval
// session — we won't auto-pick Interval Run because avg HR alone can't tell).
//
//   - low Z2  → Easy Run
//   - high Z2 → Aerobic Run
//   - Z3      → Tempo Run
//   - Z4+     → "" (let the user decide between Tempo / Interval / Threshold)
//
// hrZones is the 5-entry array produced by computeHRZones(profile). When it's
// missing (user hasn't set Resting HR + Max HR yet), we fall back to the
// previous hard-coded thresholds so the UX still does *something* useful.
export function recommendRunType(avgHR, isTrail, hrZones) {
  if (isTrail) return "";
  if (!avgHR) return "Easy Run";

  if (!hrZones || hrZones.length < 4) {
    if (avgHR < 150) return "Easy Run";
    if (avgHR < 165) return "Aerobic Run";
    if (avgHR < 175) return "Tempo Run";
    return "";
  }

  const z2 = hrZones[1];
  const z3 = hrZones[2];
  if (!z2 || !z3) return "";

  if (avgHR < z2.low) return "Easy Run";
  const z2Mid = Math.round((z2.low + z2.high) / 2);
  if (avgHR < z2Mid)  return "Easy Run";
  if (avgHR <= z2.high) return "Aerobic Run";
  if (avgHR <= z3.high) return "Tempo Run";
  return "";
}

export function parseTimeToSeconds(t) {
  if (!t) return 0;
  const parts = String(t).split(":").map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

export function formatDuration(sec) {
  if (!sec) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

// Duration for PLANNED sessions — minutes/hours only, never seconds. A plan is
// a target ("30m", "1h 30m"), so the spurious "00s" on a round planned figure
// just reads as noise. Used wherever a planned row's duration is shown.
export function formatPlanDuration(sec) {
  if (!sec) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

// Compact duration for tight cells (mobile stat tiles). Drops seconds + minutes
// once it spans an hour so a weekly total stays one line: "12h", "45m". Below
// 1 minute we still surface seconds so the readout isn't an unhelpful "0m".
export function formatDurationShort(sec) {
  if (!sec) return "—";
  const h = Math.floor(sec / 3600);
  if (h > 0) return `${h}h`;
  const m = Math.floor(sec / 60);
  if (m > 0) return `${m}m`;
  return `${Math.round(sec)}s`;
}

export function formatPaceFromSec(secPerKm) {
  if (!secPerKm || !isFinite(secPerKm)) return "—";
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Cycling speed in km/h from distance (km) + duration (sec). Cycling reads in
// speed, not pace (min/km), so this is the headline metric on cycling cards.
export function formatSpeedKmh(distanceKm, durationSec) {
  if (!distanceKm || !durationSec) return "—";
  return (distanceKm / (durationSec / 3600)).toFixed(1);
}

// Swim pace per 100m (the universal swim metric) from distance (km) + duration
// (sec). distanceKm * 10 = number of 100m laps.
export function formatSwimPace(distanceKm, durationSec) {
  if (!distanceKm || !durationSec) return "—";
  const secPer100 = durationSec / (distanceKm * 10);
  const m = Math.floor(secPer100 / 60);
  const sec = Math.round(secPer100 % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function formatDateShort(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const thisYear = new Date().getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  if (d.getFullYear() === thisYear) return `${m}-${day}`;
  return `${String(d.getFullYear()).slice(2)}-${m}-${day}`;
}

// Short weekday label for a YYYY-MM-DD date. Returns "周X" in Chinese,
// 3-letter English (Mon/Tue/…) otherwise. Used in mobile activity cards
// where a date + weekday fits on a single line.
const WEEKDAY_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_ZH = ["日", "一", "二", "三", "四", "五", "六"];
export function formatWeekdayShort(dateStr, lang) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const idx = d.getDay();
  if (lang === "zh") return `周${WEEKDAY_ZH[idx]}`;
  return WEEKDAY_EN[idx];
}

// Pull a distance-in-km number from anything the user/LLM may have typed:
// "42.195", "42.195 km", "42.195km", "Marathon (42.195 km)", "21.1KM" — all → 42.195/21.1.
// Returns 0 if no number found.
export function parseDistanceKm(input) {
  if (input == null || input === "") return 0;
  if (typeof input === "number") return isFinite(input) ? input : 0;
  const m = String(input).match(/(\d+(?:\.\d+)?)/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  return isFinite(n) ? n : 0;
}

// Heuristic: infer a race category from its name + distance string. Used by
// RacesTab when the user doesn't pick a category manually. Not a data
// migration — this is live business logic.
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

// Planned-workout time-of-day helpers. We don't add a DB column — instead we
// ride on `started_at`: "am" → 08:00 local, "pm" → 18:00 local on the plan's
// date. Display derives the AM/PM badge back from that hour.
export function timeOfDayToStartedAt(dateKey, tod) {
  if (!dateKey) return null;
  if (tod === "am") return `${dateKey}T08:00:00+08:00`;
  if (tod === "pm") return `${dateKey}T18:00:00+08:00`;
  return null;
}
// Returns "am" | "pm" | "" from a workout's startedAt (local hour). "" when no
// time is set, so callers can hide the badge entirely.
export function startedAtToTimeOfDay(startedAt) {
  if (!startedAt) return "";
  const h = new Date(startedAt).getHours();
  if (!Number.isFinite(h)) return "";
  return h < 12 ? "am" : "pm";
}

export function isDuplicate(a, b) {
  if (a.date !== b.date) return false;
  if (a.type !== b.type) return false;
  const distDiff = Math.abs((a.distance || 0) - (b.distance || 0));
  const durDiff = Math.abs((a.duration || 0) - (b.duration || 0));
  return distDiff < 0.3 && durDiff < 60;
}
