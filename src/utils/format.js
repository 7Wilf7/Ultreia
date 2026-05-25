// Heart-rate-based auto classification.
// Returns one of: "Easy Run" / "Aerobic Run" / "Tempo Run" / "Interval Run", or "" for trail runs.
// Recovery Run removed (Wilf rarely lands in <130 zone).
export function autoClassifyRun(avgHR, isTrail) {
  if (isTrail) return "";
  if (!avgHR) return "Easy Run";
  if (avgHR < 150) return "Easy Run";
  if (avgHR < 165) return "Aerobic Run";
  if (avgHR < 175) return "Tempo Run";
  return "Interval Run";
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

export function formatPaceFromSec(secPerKm) {
  if (!secPerKm || !isFinite(secPerKm)) return "—";
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
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

export function isDuplicate(a, b) {
  if (a.date !== b.date) return false;
  if (a.type !== b.type) return false;
  const distDiff = Math.abs((a.distance || 0) - (b.distance || 0));
  const durDiff = Math.abs((a.duration || 0) - (b.duration || 0));
  return distDiff < 0.3 && durDiff < 60;
}
