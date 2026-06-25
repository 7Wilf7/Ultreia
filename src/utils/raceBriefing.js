const DAY_MS = 24 * 60 * 60 * 1000;

function localDateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dateKeyNoonMs(dateKey) {
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey))) return NaN;
  return new Date(`${dateKey}T12:00:00`).getTime();
}

function compact(value) {
  return String(value ?? "").trim();
}

function compactNumber(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return "";
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}

function hasRaceContext(race) {
  const category = compact(race?.category);
  if (category === "Hyrox") return true;
  if (compact(race?.locationName)) return true;
  return Number.isFinite(Number(race?.locationLat)) && Number.isFinite(Number(race?.locationLng));
}

export function daysUntilRace(race, now = new Date()) {
  const raceMs = dateKeyNoonMs(race?.date);
  const todayMs = dateKeyNoonMs(localDateKey(now));
  if (!Number.isFinite(raceMs) || !Number.isFinite(todayMs)) return null;
  return Math.round((raceMs - todayMs) / DAY_MS);
}

export function raceBriefingSignature(summary, raceDayWeather = null) {
  const race = summary?.race || summary;
  if (!race?.id && !race?.date) return "";
  const weather = raceDayWeather && typeof raceDayWeather === "object"
    ? [
        raceDayWeather.kind,
        raceDayWeather.date,
        raceDayWeather.tempMinC,
        raceDayWeather.tempMaxC,
        raceDayWeather.precipMm,
        raceDayWeather.precipProb,
        raceDayWeather.condition,
      ].map(compact).join("|")
    : "";
  return [
    race.id || "",
    race.date || "",
    race.name || "",
    race.priority || "",
    race.category || "",
    race.subtype || "",
    compactNumber(race.distance),
    compactNumber(race.ascent),
    race.locationName || "",
    weather,
  ].map(compact).join("::");
}

export function summarizeRaceBriefingTarget(races = [], now = new Date(), raceDayWeather = null) {
  const candidates = (Array.isArray(races) ? races : [])
    .filter(race => race?.isTarget && compact(race.priority || "C") === "A" && race?.date)
    .map(race => ({ race, daysToRace: daysUntilRace(race, now) }))
    .filter(item => item.daysToRace !== null && item.daysToRace >= 0 && item.daysToRace <= 14)
    .filter(item => hasRaceContext(item.race))
    .sort((a, b) => a.daysToRace - b.daysToRace || String(a.race.date).localeCompare(String(b.race.date)));
  const picked = candidates[0];
  if (!picked) return null;
  return {
    ...picked,
    signature: raceBriefingSignature(picked, raceDayWeather),
  };
}

function raceLine(race) {
  const bits = [
    race?.name || "Target race",
    race?.date || "",
    race?.category || "",
    race?.subtype || "",
  ].filter(Boolean);
  const distance = compactNumber(race?.distance);
  const ascent = compactNumber(race?.ascent);
  if (distance) bits.push(`${distance} km`);
  if (ascent) bits.push(`+${ascent} m`);
  if (race?.locationName) bits.push(race.locationName);
  return bits.join(" · ");
}

function weatherLine(weather) {
  if (!weather || typeof weather !== "object") return "No race-day weather context available.";
  const bits = [
    weather.kind ? `kind=${weather.kind}` : "",
    Number.isFinite(Number(weather.tempMinC)) || Number.isFinite(Number(weather.tempMaxC))
      ? `temp=${[weather.tempMinC, weather.tempMaxC].filter(v => Number.isFinite(Number(v))).join("-")}C`
      : "",
    Number.isFinite(Number(weather.precipMm)) ? `precip=${weather.precipMm}mm` : "",
    Number.isFinite(Number(weather.precipProb)) ? `precip_prob=${weather.precipProb}` : "",
    weather.condition ? `condition=${weather.condition}` : "",
  ].filter(Boolean);
  return bits.length ? bits.join(" · ") : "Weather context is present but sparse.";
}

export function buildRaceBriefingPrompt({ summary, dataBlock, raceDayWeather = null, now = new Date() }) {
  const race = summary?.race || {};
  const today = localDateKey(now);
  const days = Number(summary?.daysToRace);
  return `You are Ultreia AI Coach. Prepare a practical race briefing and checklist for the app owner.

Today: ${today} (GMT+8)
Days to race: ${Number.isFinite(days) ? days : "unknown"}
Target race: ${raceLine(race)}
Race-day weather/context: ${weatherLine(raceDayWeather)}

Current training context:
---
${dataBlock || "(no context)"}
---

Output requirements:
- Write in concise Chinese Markdown.
- Do not output JSON.
- Do not create calendar plans and do not imply that the calendar has been changed.
- If you recommend changing training, keep it as a brief "需要另行调整" note only.
- Use the race category, distance, ascent, location, recent training, recovery signals, and weather context when available.
- Treat weather as uncertain unless it is same-day actual weather.
- Do not diagnose injury or illness.
- Keep it actionable and skimmable on mobile.

Use exactly these sections:
## 赛前重点
## 配速 / 强度策略
## 补给与喝水
## 装备检查
## 出发前流程
## 本周不要做`;
}
