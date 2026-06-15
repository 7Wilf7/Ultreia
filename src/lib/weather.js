// Weather + geolocation client. Two responsibilities:
//   1. Get the user's lng/lat — Capacitor Geolocation on native, browser
//      navigator.geolocation on web, with a manual-entry fallback from
//      user_settings.default_lng/lat when neither works.
//   2. Hit the wallet-backed Supabase weather-proxy Edge Function and normalize
//      Caiyun's verbose JSON into a flat shape the rest of the app can store +
//      render without re-learning the API.

import { useCallback, useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { supabase } from './supabase';

const isNative = () => Capacitor.isNativePlatform?.() === true;

// Round to 4 decimals so coords are stable across calls — the Vercel edge
// cache (and any future client-side cache) can then dedupe.
function roundCoord(n) {
  return Math.round(Number(n) * 10000) / 10000;
}

// Returns { lng, lat, source } where source ∈ 'native' | 'browser' | 'default'.
// Throws if no source is available — caller decides whether to surface or fall
// back to "weather unavailable".
//
// Default-location-first: if the user has set a fixed training location we use
// it and DON'T touch device GPS. Calling device geolocation is what pops
// Android's "Location Accuracy" (Google Play Services) dialog — and a runner's
// training spot rarely moves, so a manual default is both quieter and more
// accurate. Pass `forceDevice: true` (the explicit "use current location"
// affordance) to deliberately opt into GPS and refresh the saved coords.
export async function getCurrentLocation({ defaultLng, defaultLat, forceDevice = false } = {}) {
  const hasDefault = Number.isFinite(Number(defaultLng)) && Number.isFinite(Number(defaultLat));
  if (hasDefault && !forceDevice) {
    return { lng: roundCoord(defaultLng), lat: roundCoord(defaultLat), source: 'default' };
  }
  if (isNative()) {
    try {
      // Low accuracy on purpose: city-level is all weather needs, and
      // enableHighAccuracy:true is what triggers Android's "Location Accuracy"
      // (Google Play Services) upsell dialog. Network/coarse location is fine.
      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: false,
        timeout: 8000,
      });
      return {
        lng: roundCoord(pos.coords.longitude),
        lat: roundCoord(pos.coords.latitude),
        source: 'native',
      };
    } catch {
      // Fall through to default. Native geolocation failures usually mean
      // the user denied permission or location services are off.
    }
  } else if (typeof navigator !== 'undefined' && navigator.geolocation) {
    try {
      const pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 8000,
          maximumAge: 5 * 60 * 1000,
        });
      });
      return {
        lng: roundCoord(pos.coords.longitude),
        lat: roundCoord(pos.coords.latitude),
        source: 'browser',
      };
    } catch {
      // Fall through to default.
    }
  }

  if (hasDefault) {
    return {
      lng: roundCoord(defaultLng),
      lat: roundCoord(defaultLat),
      source: 'default',
    };
  }
  throw new Error('no_location_available');
}

async function throwFunctionError(error, fallback) {
  let code = '';
  try {
    const ctx = error.context;
    if (ctx && typeof ctx.json === 'function') {
      const b = await ctx.json();
      code = b?.error || '';
    }
  } catch { /* ignore */ }
  const e = new Error(code || error.message || fallback);
  e.code = code;
  throw e;
}

// Wallet-backed Supabase weather proxy. The Caiyun token stays in Edge
// Function secrets; successful fetches debit the user's wallet server-side.
async function fetchProxy({ lng, lat, type, begin }) {
  const { data, error } = await supabase.functions.invoke('weather-proxy', {
    body: {
      mode: 'single',
      lng: roundCoord(lng),
      lat: roundCoord(lat),
      type,
      begin: begin ? Math.floor(begin) : undefined,
    },
  });
  if (error) await throwFunctionError(error, 'weather_proxy_failed');
  if (data?.error) {
    const e = new Error(data.error);
    e.code = data.error;
    throw e;
  }
  return data?.data;
}

// Caiyun "skycon" enum → a compact icon + a localized label. Full list is
// long; we map the most common buckets and fall back to a generic cloud
// for anything unmapped (rare values like LIGHT_HAZE are still readable).
// Source: https://docs.caiyunapp.com/weather-api/v2/v2.6/skycon.html
const SKYCON_MAP = {
  CLEAR_DAY:        { icon: '☀️',  zh: '晴',         en: 'Clear' },
  CLEAR_NIGHT:      { icon: '🌙',  zh: '晴',         en: 'Clear' },
  PARTLY_CLOUDY_DAY:   { icon: '⛅', zh: '多云',       en: 'Partly cloudy' },
  PARTLY_CLOUDY_NIGHT: { icon: '☁️', zh: '多云',       en: 'Partly cloudy' },
  CLOUDY:           { icon: '☁️',  zh: '阴',         en: 'Cloudy' },
  LIGHT_HAZE:       { icon: '🌫️', zh: '轻度雾霾',   en: 'Light haze' },
  MODERATE_HAZE:    { icon: '🌫️', zh: '中度雾霾',   en: 'Moderate haze' },
  HEAVY_HAZE:       { icon: '🌫️', zh: '重度雾霾',   en: 'Heavy haze' },
  LIGHT_RAIN:       { icon: '🌦️', zh: '小雨',       en: 'Light rain' },
  MODERATE_RAIN:    { icon: '🌧️', zh: '中雨',       en: 'Moderate rain' },
  HEAVY_RAIN:       { icon: '🌧️', zh: '大雨',       en: 'Heavy rain' },
  STORM_RAIN:       { icon: '⛈️',  zh: '暴雨',       en: 'Storm rain' },
  FOG:              { icon: '🌫️', zh: '雾',         en: 'Fog' },
  LIGHT_SNOW:       { icon: '🌨️', zh: '小雪',       en: 'Light snow' },
  MODERATE_SNOW:    { icon: '🌨️', zh: '中雪',       en: 'Moderate snow' },
  HEAVY_SNOW:       { icon: '❄️',  zh: '大雪',       en: 'Heavy snow' },
  STORM_SNOW:       { icon: '❄️',  zh: '暴雪',       en: 'Storm snow' },
  DUST:             { icon: '🌪️', zh: '浮尘',       en: 'Dust' },
  SAND:             { icon: '🌪️', zh: '沙尘',       en: 'Sand' },
  WIND:             { icon: '💨',  zh: '大风',       en: 'Windy' },
};

export function skyconMeta(skycon, lang = 'zh') {
  const hit = SKYCON_MAP[skycon];
  if (!hit) return { icon: '☁️', label: skycon || '' };
  return { icon: hit.icon, label: lang === 'en' ? hit.en : hit.zh };
}

// Apparent temperature ("feels like"). Caiyun returns this in realtime as
// `apparent_temperature` already, but historical/forecast endpoints only
// have raw temp. Use a simple summer heat-index approximation when humidity
// is available — gets the "30°C but feels like 36°C" effect right enough
// for training context. Falls back to raw temp when humidity missing.
function approxApparentTemp(tempC, humidity) {
  if (!Number.isFinite(tempC) || !Number.isFinite(humidity)) return tempC;
  if (tempC < 27) return tempC;
  // Steadman-style simplification: each 10% RH above 40% adds ~1°C of
  // perceived heat at temps above 27°C.
  const rhPct = humidity > 1 ? humidity : humidity * 100;
  const extra = Math.max(0, (rhPct - 40) / 10);
  return Math.round((tempC + extra) * 10) / 10;
}

// Compact snapshot stored on a workout row. JSONB column = the whole object
// goes in unchanged. Field names are camelCase to match the rest of the
// React state.
function buildSnapshot({
  ts, type, lng, lat,
  tempC, apparentC, humidity, skycon, windSpeed, windDirection, aqi, source,
}) {
  return {
    ts,                  // ISO 8601 — when the weather was observed
    type,                // 'realtime' | 'historical' | 'daily'
    lng, lat,
    tempC: Number.isFinite(tempC) ? Math.round(tempC * 10) / 10 : null,
    apparentC: Number.isFinite(apparentC) ? Math.round(apparentC * 10) / 10 : null,
    humidity: Number.isFinite(humidity) ? humidity : null,
    skycon: skycon || null,
    windSpeed: Number.isFinite(windSpeed) ? Math.round(windSpeed * 10) / 10 : null,   // km/h
    windDirection: Number.isFinite(windDirection) ? windDirection : null,
    aqi: Number.isFinite(aqi) ? aqi : null,
    source,              // 'caiyun'
  };
}

// Reduce a raw Caiyun realtime payload to a snapshot. Shared by the direct
// (own-token) path and the free-tier proxy bundle.
function snapshotFromRealtimeData(data, lng, lat) {
  const r = data?.result?.realtime;
  if (!r) throw new Error('caiyun_realtime_missing_result');
  return buildSnapshot({
    ts: new Date().toISOString(),
    type: 'realtime',
    lng, lat,
    tempC: r.temperature,
    apparentC: r.apparent_temperature ?? approxApparentTemp(r.temperature, r.humidity),
    humidity: r.humidity,
    skycon: r.skycon,
    windSpeed: r.wind?.speed,
    windDirection: r.wind?.direction,
    aqi: r.air_quality?.aqi?.chn,
    source: 'caiyun',
  });
}

// Pull realtime weather and reduce to a snapshot. lng/lat caller's job.
export async function fetchRealtimeSnapshot({ lng, lat }) {
  const data = await fetchProxy({ lng, lat, type: 'realtime' });
  return snapshotFromRealtimeData(data, lng, lat);
}

// Historical weather for a specific moment in the past 24h. Caiyun's
// hourly endpoint with `begin=` returns 24 hours of past hourly data;
// we pick the hour closest to the requested timestamp.
export async function fetchHistoricalSnapshot({ lng, lat, when }) {
  const beginSec = Math.floor(new Date(when).getTime() / 1000);
  if (!Number.isFinite(beginSec)) throw new Error('invalid_when');
  const data = await fetchProxy({ lng, lat, type: 'historical', begin: beginSec });
  const hourly = data.result?.hourly;
  if (!hourly) throw new Error('caiyun_historical_missing_result');
  const wantedMs = beginSec * 1000;
  function pickClosest(arr) {
    if (!Array.isArray(arr) || !arr.length) return null;
    let best = arr[0], bestDelta = Math.abs(new Date(arr[0].datetime).getTime() - wantedMs);
    for (const item of arr) {
      const d = Math.abs(new Date(item.datetime).getTime() - wantedMs);
      if (d < bestDelta) { best = item; bestDelta = d; }
    }
    return best;
  }
  const tempPt = pickClosest(hourly.temperature);
  const humPt = pickClosest(hourly.humidity);
  const skyconPt = pickClosest(hourly.skycon);
  const windPt = pickClosest(hourly.wind);
  const aqiPt = pickClosest(hourly.air_quality?.aqi);
  const tempC = tempPt?.value;
  const humidity = humPt?.value;
  return buildSnapshot({
    ts: new Date(beginSec * 1000).toISOString(),
    type: 'historical',
    lng, lat,
    tempC,
    apparentC: approxApparentTemp(tempC, humidity),
    humidity,
    skycon: skyconPt?.value,
    windSpeed: windPt?.speed,
    windDirection: windPt?.direction,
    aqi: aqiPt?.value?.chn,
    source: 'caiyun',
  });
}

// Daily forecast for the next 7 days. Used by the calendar for future dates
// and by the AI Coach for planned workout days. Returns an array of
// snapshots, one per day, keyed by YYYY-MM-DD (local).
// Reduce a raw Caiyun daily payload to the forecast array. Shared by the direct
// (own-token) path and the free-tier proxy bundle.
function forecastsFromDailyData(data) {
  const d = data?.result?.daily;
  if (!d) throw new Error('caiyun_daily_missing_result');
  const out = [];
  const days = d.temperature?.length || 0;
  for (let i = 0; i < days; i++) {
    const dt = d.temperature[i]?.date;
    if (!dt) continue;
    const tMax = d.temperature[i]?.max;
    const tMin = d.temperature[i]?.min;
    const tAvg = d.temperature[i]?.avg ?? ((Number(tMax) + Number(tMin)) / 2);
    const humAvg = d.humidity?.[i]?.avg;
    const skycon = d.skycon?.[i]?.value;
    const wind = d.wind?.[i]?.avg;
    const aqi = d.air_quality?.aqi?.[i]?.avg?.chn;
    out.push({
      date: dt.slice(0, 10),                  // YYYY-MM-DD
      tempMaxC: Number.isFinite(tMax) ? Math.round(tMax * 10) / 10 : null,
      tempMinC: Number.isFinite(tMin) ? Math.round(tMin * 10) / 10 : null,
      tempAvgC: Number.isFinite(tAvg) ? Math.round(tAvg * 10) / 10 : null,
      apparentAvgC: approxApparentTemp(tAvg, humAvg),
      humidity: Number.isFinite(humAvg) ? humAvg : null,
      skycon: skycon || null,
      windSpeed: Number.isFinite(wind?.speed) ? Math.round(wind.speed * 10) / 10 : null,
      windDirection: Number.isFinite(wind?.direction) ? wind.direction : null,
      aqi: Number.isFinite(aqi) ? aqi : null,
      source: 'caiyun',
    });
  }
  return out;
}

export async function fetchDailyForecasts({ lng, lat }) {
  const data = await fetchProxy({ lng, lat, type: 'daily' });
  return forecastsFromDailyData(data);
}

// One call to the wallet-backed weather-proxy Edge Function returns realtime +
// 7-day forecast in one shot and counts as ONE wallet debit.
async function weatherProxyBundle({ lng, lat }) {
  const { data, error } = await supabase.functions.invoke('weather-proxy', {
    body: { mode: 'bundle', lng: roundCoord(lng), lat: roundCoord(lat) },
  });
  if (error) {
    let code = '';
    try {
      const ctx = error.context;
      if (ctx && typeof ctx.json === 'function') { const b = await ctx.json(); code = b?.error || ''; }
    } catch { /* ignore */ }
    const e = new Error(code || error.message || 'weather_proxy_failed');
    e.code = code;
    throw e;
  }
  if (data && data.error) { const e = new Error(data.error); e.code = data.error; throw e; }
  return {
    realtime: data?.realtime ? snapshotFromRealtimeData(data.realtime, lng, lat) : null,
    forecasts: data?.daily ? forecastsFromDailyData(data.daily) : null,
    wallet: data?.wallet || null,
  };
}

// For a long session (≥ LONG_SESSION_SEC) recorded with a real start time,
// sample the weather at several points across its duration — start temps on a
// 10h ultra say nothing about the midday heat. Each point is a historical
// snapshot; we cap the count and stay inside the historical window (past ~24h).
// Returns an array of { atHours, tempC, apparentC, humidity, skycon, ... } or
// [] when nothing usable.
const LONG_SESSION_SEC = 2 * 3600;
async function captureWeatherSeries({ lng, lat, startMs, durationSec, now }) {
  const stepMs = 2 * 60 * 60 * 1000;                 // ~every 2 hours
  const endMs = Math.min(startMs + durationSec * 1000, now);
  const firstEligibleMs = Math.max(startMs, now - DAY_MS + 60 * 1000);
  if (endMs <= firstEligibleMs) return [];
  const stamps = [];
  for (let tMs = firstEligibleMs; tMs < endMs - 30 * 60 * 1000; tMs += stepMs) stamps.push(tMs);
  stamps.push(endMs);
  const uniq = [...new Set(stamps)].slice(0, 8);     // cap proxy calls
  const out = [];
  for (const tMs of uniq) {
    if (now - tMs >= 24 * 60 * 60 * 1000) continue;   // outside historical window
    try {
      const s = await fetchHistoricalSnapshot({ lng, lat, when: tMs });
      if (s) out.push({
        atHours: Math.round(((tMs - startMs) / 3600000) * 10) / 10,
        tempC: s.tempC, apparentC: s.apparentC, humidity: s.humidity,
        skycon: s.skycon, windSpeed: s.windSpeed, aqi: s.aqi,
      });
    } catch { /* skip this point */ }
  }
  return out;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Whether Caiyun can return weather that actually matches a workout's moment.
// Caiyun's only data windows are: future → daily forecast, past 24h → hourly
// historical, now → realtime. Fully older-than-24h sessions have no usable
// data, so capturing them would silently stamp current weather onto old work.
//   • startedAt in the future            → eligible (forecast)
//   • startedAt within the past 24h      → eligible (historical)
//   • startedAt older than 24h, but a long session overlaps the past 24h
//                                            → eligible for partial series
//   • startedAt older than 24h and ended before the 24h window → NOT eligible
//   • no startedAt → captured as "now"   → eligible only when the date is today
//     (a past-dated entry with no time would otherwise get current weather)
export function weatherWindowEligible({ startedAt, date, durationSec = 0, duration = 0 } = {}, now = Date.now()) {
  if (startedAt) {
    const ts = new Date(startedAt).getTime();
    if (Number.isFinite(ts)) {
      if (ts > now) return true;          // future → forecast
      if (now - ts < DAY_MS) return true; // past → within the 24h window
      const durSec = Number(durationSec || duration || 0);
      return durSec >= LONG_SESSION_SEC && ts + durSec * 1000 > now - DAY_MS;
    }
  }
  if (date) {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const todayKey = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    return date === todayKey;
  }
  return true; // brand-new entry, no date yet → assume "now"
}

// Pick the right fetch path for a given workout: future plan → daily forecast,
// past with timestamp → historical, otherwise realtime (= "now"). Returns
// the snapshot or null if Caiyun has no data for that session. For long past
// sessions the returned snapshot can also carry a `series` array (see
// captureWeatherSeries).
export async function captureSnapshotForWorkout({ date, startedAt, durationSec = 0, lng, lat }) {
  // Future / today-with-no-time → use daily forecast for that date.
  // Else if startedAt is in the past 24h → historical at that timestamp.
  // Else → realtime (now).
  const now = Date.now();
  const dayMs = DAY_MS;
  if (startedAt) {
    const tsMs = new Date(startedAt).getTime();
    if (Number.isFinite(tsMs)) {
      if (tsMs > now + dayMs) {
        // Far-future plan — try daily forecast keyed on the date.
        const forecasts = await fetchDailyForecasts({ lng, lat });
        const dayKey = date || new Date(tsMs).toISOString().slice(0, 10);
        const hit = forecasts.find(f => f.date === dayKey);
        return hit ? { ts: new Date(tsMs).toISOString(), type: 'forecast', lng, lat, ...hit } : null;
      }
      if (tsMs <= now) {
        const start = now - tsMs < dayMs
          ? await fetchHistoricalSnapshot({ lng, lat, when: tsMs })
          : null;
        if (start && durationSec >= LONG_SESSION_SEC) {
          const series = await captureWeatherSeries({ lng, lat, startMs: tsMs, durationSec, now });
          if (series.length > 1) return { ...start, series };
        }
        if (start) return start;
        if (durationSec >= LONG_SESSION_SEC && tsMs + durationSec * 1000 > now - dayMs) {
          const series = await captureWeatherSeries({ lng, lat, startMs: tsMs, durationSec, now });
          const firstMs = Math.max(tsMs, now - dayMs + 60 * 1000);
          if (series.length) return { ...series[0], ts: new Date(firstMs).toISOString(), type: 'historical_partial', lng, lat, series };
        }
        return null;
      }
      // Past, but older than Caiyun's 24h historical window → no accurate data.
      // Don't fall through to realtime: that would stamp *current* weather on an
      // old session. Return null so the row simply has no weather.
      if (now - tsMs >= dayMs) return null;
    }
  }
  return await fetchRealtimeSnapshot({ lng, lat });
}

// localStorage-backed cache for weather data. Two freshness rules:
//   • realtime → 1 hour TTL. AI Coach status pill + prompt context want
//     "roughly now" — a stale hour is fine, more than that and a runner
//     deciding pace mid-afternoon shouldn't trust this morning's temp.
//   • forecasts → cached until the next local midnight. The daily forecast
//     for today + 6 future days only changes meaningfully day-over-day, so
//     once-per-day matches actual freshness. Refetches when the user opens
//     the app on a new calendar day.
// Cache invalidates wholesale when coords change (user updates default
// location) — old data is for the wrong city.
const CACHE_KEY = 'ts.weather.v1';
// 3h: weather doesn't change minute-to-minute, and a longer TTL means far fewer
// Caiyun calls (matters for the shared free-tier quota — see weather-proxy).
const REALTIME_TTL_MS = 3 * 60 * 60 * 1000;

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}
function writeCache(next) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(next)); } catch { /* quota / private mode */ }
}
function localDateKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function realtimeFresh(cache, now = Date.now()) {
  if (!cache?.realtime || !cache?.realtimeAt) return false;
  return now - new Date(cache.realtimeAt).getTime() < REALTIME_TTL_MS;
}
function forecastFresh(cache, today = localDateKey()) {
  return !!cache?.forecasts && cache?.forecastDay === today;
}
function coordsMatch(cache, lng, lat) {
  if (!cache) return false;
  return Number(cache.lng) === Number(lng) && Number(cache.lat) === Number(lat);
}

// React hook — fetches realtime + 7-day forecast with localStorage caching,
// exposes { currentWeather, forecastByDate, status, error, refetch }. Both
// AICoachTab and AppShell.sendChat consume this so the prompt preview
// matches what's actually sent. Pass `force: true` to refetch() to bypass
// the cache (used by the "refresh" affordance + the hourly timer).
//
// status values:
//   'idle'        — never fetched (initial mount, before effect runs)
//   'loading'     — fetch in flight
//   'ready'       — currentWeather populated (from cache or live)
//   'no_location' — geolocation denied + no default; UI prompts user to set one
//   'error'       — fetch attempted, proxy/Caiyun failed
// `lastUpdatedAt` is the ISO timestamp of the most recent successful
//   realtime fetch — surfaced so the UI can render "updated HH:MM" labels
//   and decide when a manual refresh is meaningful.
export function useWeatherContext({ defaultLng, defaultLat, onWeatherUsed } = {}) {
  // Hydrate from cache synchronously on mount so the AI Coach status pill
  // doesn't flash 'idle' on every page load. The freshness check below
  // decides whether to actually refetch.
  const [state, setState] = useState(() => {
    const c = readCache();
    if (!c || !c.realtime) return { currentWeather: null, forecastByDate: null, status: 'idle', error: null, lastUpdatedAt: null };
    const m = new Map();
    if (Array.isArray(c.forecasts)) for (const f of c.forecasts) m.set(f.date, f);
    return { currentWeather: c.realtime, forecastByDate: m, status: 'ready', error: null, lastUpdatedAt: c.realtimeAt || null };
  });

  const run = useCallback(async (opts = {}) => {
    const force = !!opts.force;
    const cachedNow = readCache();
    // Fast path: both realtime + forecast are still fresh → serve straight from
    // cache WITHOUT touching device geolocation. This is the common case on
    // app-foreground refresh; calling getCurrentLocation() here is what popped
    // the Android "Location Accuracy" dialog every time the user switched back
    // to the app. Only invoke GPS when something is actually stale (or forced).
    if (!force && cachedNow && realtimeFresh(cachedNow) && forecastFresh(cachedNow)) {
      const m = new Map();
      if (Array.isArray(cachedNow.forecasts)) for (const f of cachedNow.forecasts) m.set(f.date, f);
      setState({ currentWeather: cachedNow.realtime, forecastByDate: m, status: 'ready', error: null, lastUpdatedAt: cachedNow.realtimeAt || null });
      return;
    }
    let loc;
    try {
      loc = await getCurrentLocation({ defaultLng, defaultLat });
    } catch {
      setState({ currentWeather: null, forecastByDate: null, status: 'no_location', error: null, lastUpdatedAt: null });
      return;
    }
    // Cache check — when the user opened the app inside the TTL window, we
    // serve straight from localStorage without hitting the proxy.
    const cache = readCache();
    const needRealtime = force || !coordsMatch(cache, loc.lng, loc.lat) || !realtimeFresh(cache);
    const needForecast = force || !coordsMatch(cache, loc.lng, loc.lat) || !forecastFresh(cache);
    if (!needRealtime && !needForecast && cache) {
      // Pure cache hit — already hydrated in initial state, but re-set to
      // make sure 'ready' is reflected when the user changes default loc
      // between renders.
      const m = new Map();
      if (Array.isArray(cache.forecasts)) for (const f of cache.forecasts) m.set(f.date, f);
      setState({ currentWeather: cache.realtime, forecastByDate: m, status: 'ready', error: null, lastUpdatedAt: cache.realtimeAt || null });
      return;
    }

    setState((s) => ({ ...s, status: s.currentWeather ? 'ready' : 'loading' }));

    try {
      const bundle = await weatherProxyBundle({ lng: loc.lng, lat: loc.lat });
      const rt = bundle.realtime ?? (cache?.realtime || null);
      const daily = bundle.forecasts ?? (cache?.forecasts || null);
      if (typeof bundle?.wallet?.balance_cents === 'number' && onWeatherUsed) onWeatherUsed(bundle.wallet.balance_cents);
      const today = localDateKey();
      const nextCache = {
        lng: loc.lng,
        lat: loc.lat,
        realtime: rt || null,
        realtimeAt: needRealtime ? new Date().toISOString() : cache?.realtimeAt || null,
        forecasts: daily || null,
        forecastDay: needForecast ? today : cache?.forecastDay || null,
      };
      writeCache(nextCache);
      const m = new Map();
      if (Array.isArray(daily)) for (const f of daily) m.set(f.date, f);
      setState({
        currentWeather: rt || null,
        forecastByDate: m,
        status: 'ready',
        error: null,
        lastUpdatedAt: nextCache.realtimeAt,
      });
    } catch (e) {
      const status = e?.code === 'insufficient_balance' ? 'insufficient_balance' : 'error';
      setState({ currentWeather: null, forecastByDate: null, status, error: status === 'error' ? (e.message || String(e)) : null, lastUpdatedAt: null });
    }
  }, [defaultLng, defaultLat, onWeatherUsed]);

  // run() is async — the setState calls inside happen on later ticks, not
  // synchronously inside the effect body. The lint rule still flags this
  // (it can't see across the await), so silence it explicitly.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void run(); }, [run]);

  // Refresh whenever the tab comes back into focus — covers the "left the
  // tab open all day, returned in the morning" case where the daily
  // forecast is stale. The cache check inside run() means this is cheap
  // when nothing's actually expired.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') void run();
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [run]);

  return { ...state, refetch: run };
}

// Reverse-geocode WGS84 coords → a short, localized place label (district /
// city level, e.g. "广东省 广州市" or "Guangzhou, Guangdong"). Uses
// BigDataCloud's free reverse-geocode-client endpoint: no API key, CORS-
// enabled (works in the browser AND the Capacitor WebView), and localized via
// localityLanguage. District/city granularity is intentional — street-level is
// unnecessary for coaching/weather context and more privacy-sensitive.
// Returns "" on any failure so callers can fall back to manual entry.
export async function reverseGeocode({ lng, lat, lang = 'zh' }) {
  if (!Number.isFinite(Number(lng)) || !Number.isFinite(Number(lat))) return '';
  const localityLanguage = lang === 'en' ? 'en' : 'zh';
  const url = `https://api.bigdatacloud.net/data/reverse-geocode-client`
    + `?latitude=${roundCoord(lat)}&longitude=${roundCoord(lng)}&localityLanguage=${localityLanguage}`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return '';
    const d = await resp.json();
    const province = (d.principalSubdivision || '').trim();
    const city = (d.city || d.locality || '').trim();
    if (!province && !city) return (d.locality || '').trim();
    if (localityLanguage === 'zh') {
      // Chinese addresses concatenate without separators; dedupe if the API
      // returns the same string for both (e.g. municipalities like 上海市).
      return province === city ? city : `${province}${city}`;
    }
    // English: "City, Province"
    return [city, province].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ');
  } catch {
    return '';
  }
}

// ── Forward geocode: place NAME → coords. For race locations the user isn't
// physically at (an away race), so device GPS / reverseGeocode can't help.
// Open-Meteo's geocoding endpoint is free, keyless, CORS-enabled. Returns an
// array of candidates (the user picks when ambiguous), or [] on failure.
export async function forwardGeocode(name, lang = 'zh') {
  const q = (name || '').trim();
  if (!q) return [];
  const url = `https://geocoding-api.open-meteo.com/v1/search`
    + `?name=${encodeURIComponent(q)}&count=6&language=${lang === 'en' ? 'en' : 'zh'}&format=json`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const d = await resp.json();
    return (d.results || []).map(r => ({
      name: r.name,
      lat: r.latitude,
      lng: r.longitude,
      admin1: r.admin1 || '',
      country: r.country || '',
      // Disambiguation label, e.g. "广州市, 广东省, 中国" — dedupe repeats.
      label: [r.name, r.admin1, r.country].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', '),
    }));
  } catch {
    return [];
  }
}

// Day-of-year helpers for the climate-normal window (year-agnostic).
const _DOY_CUM = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
function _dayOfYear(month, day) { return _DOY_CUM[month] + day; }
function _monthDayDistance(m1, d1, m2, d2) {
  const raw = Math.abs(_dayOfYear(m1, d1) - _dayOfYear(m2, d2));
  return Math.min(raw, 365 - raw);
}
function _pushNum(arr, v) { const n = Number(v); if (Number.isFinite(n)) arr.push(n); }

// ── Climate normal: TYPICAL weather for a date at a location, averaged from
// the past ~5 years of ERA5 reanalysis (Open-Meteo archive — free, keyless).
// For races too far out for any real forecast (> ~2 weeks). Averages the target
// month-day ± 4 days across the sampled years. Apparent ("feels like") temp is
// included because that's what matters for heat planning. Returns a
// forecast-shaped object (source:'climate') so existing formatters work, or null.
export async function fetchClimateNormal({ lat, lng, date }) {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng)) || !date) return null;
  const target = new Date(`${date}T00:00:00`);
  if (isNaN(target.getTime())) return null;
  const tMonth = target.getMonth();
  const tDay = target.getDate();
  const end = new Date(Date.now() - 7 * 86400000); // archive lags ~5 days
  const start = `${end.getFullYear() - 5}-01-01`;
  const url = `https://archive-api.open-meteo.com/v1/archive`
    + `?latitude=${roundCoord(lat)}&longitude=${roundCoord(lng)}`
    + `&start_date=${start}&end_date=${end.toISOString().slice(0, 10)}`
    + `&daily=temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_mean,precipitation_sum`
    + `&timezone=auto`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const dd = (await resp.json()).daily;
    if (!dd || !Array.isArray(dd.time)) return null;
    const maxs = [], mins = [], appMax = [], appMean = [], precs = [];
    for (let i = 0; i < dd.time.length; i++) {
      const day = new Date(`${dd.time[i]}T00:00:00`);
      if (_monthDayDistance(day.getMonth(), day.getDate(), tMonth, tDay) > 4) continue;
      _pushNum(maxs, dd.temperature_2m_max?.[i]);
      _pushNum(mins, dd.temperature_2m_min?.[i]);
      _pushNum(appMax, dd.apparent_temperature_max?.[i]);
      _pushNum(appMean, dd.apparent_temperature_mean?.[i]);
      _pushNum(precs, dd.precipitation_sum?.[i]);
    }
    if (!maxs.length || !mins.length) return null;
    const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
    const r1 = x => x == null ? null : Math.round(x * 10) / 10;
    const tMax = r1(avg(maxs)), tMin = r1(avg(mins));
    return {
      tempMaxC: tMax,
      tempMinC: tMin,
      tempAvgC: (tMax != null && tMin != null) ? r1((tMax + tMin) / 2) : null,
      apparentMaxC: r1(avg(appMax)),
      apparentAvgC: r1(avg(appMean)),
      precipMm: r1(avg(precs)),
      source: 'climate',
      sampleDays: maxs.length,
    };
  } catch {
    return null;
  }
}

// ── Actual past-day weather from the Open-Meteo ERA5 archive. Unlike
// fetchClimateNormal (which averages a ±4-day window across 5 years for a
// TYPICAL value), this returns what the weather ACTUALLY was on one specific
// historical date — works back to 1940, lags ~5 days behind today. Used for
// finished (history) races so the card can show the real race-day conditions.
// Daily granularity (max/min/apparent/precip) — for a long race the min–max
// span is the useful "range"; for a short one we surface the day average as a
// stand-in for start temp (history races don't store a start time). Returns a
// forecast-shaped object { source:'archive', ... } or null.
export async function fetchActualDailyWeather({ lat, lng, date }) {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng)) || !date) return null;
  const target = new Date(`${date}T00:00:00`);
  if (isNaN(target.getTime())) return null;
  const url = `https://archive-api.open-meteo.com/v1/archive`
    + `?latitude=${roundCoord(lat)}&longitude=${roundCoord(lng)}`
    + `&start_date=${date}&end_date=${date}`
    + `&daily=temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_mean,precipitation_sum`
    + `&timezone=auto`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const dd = (await resp.json()).daily;
    if (!dd || !Array.isArray(dd.time) || !dd.time.length) return null;
    const r1 = (x) => (x == null || !Number.isFinite(Number(x))) ? null : Math.round(Number(x) * 10) / 10;
    const tMax = r1(dd.temperature_2m_max?.[0]);
    const tMin = r1(dd.temperature_2m_min?.[0]);
    if (tMax == null && tMin == null) return null;
    return {
      tempMaxC: tMax,
      tempMinC: tMin,
      tempAvgC: (tMax != null && tMin != null) ? r1((tMax + tMin) / 2) : (tMax ?? tMin),
      apparentMaxC: r1(dd.apparent_temperature_max?.[0]),
      apparentAvgC: r1(dd.apparent_temperature_mean?.[0]),
      precipMm: r1(dd.precipitation_sum?.[0]),
      source: 'archive',
    };
  } catch {
    return null;
  }
}

// Resolver for a FINISHED race's actual weather, cached. Past archive data is
// immutable, so cache for 30 days (a refetch only matters if coords/date
// change, which busts the key anyway). Returns { kind:'archive', ... } or null.
export async function fetchHistoryRaceWeather({ lat, lng, date }) {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng)) || !date) return null;
  const cached = _readRaceWx(lat, lng, date);
  if (cached) return cached;
  const actual = await fetchActualDailyWeather({ lat, lng, date });
  if (!actual) return null;
  const v = { kind: 'archive', ...actual };
  _writeRaceWx(lat, lng, date, v);
  return v;
}

// localStorage cache for race-day weather so switching to the Races tab is
// instant and we don't re-hit the API every time. Climate normals are
// effectively constant → cache 7 days (also forces a re-eval within a week, so
// a race entering the forecast window flips from climate → forecast). Real
// forecasts refresh daily → cache until next local midnight.
function _raceWxKey(lat, lng, date) {
  return `ts_race_wx:${roundCoord(lat)}:${roundCoord(lng)}:${date}`;
}
function _readRaceWx(lat, lng, date) {
  try {
    const c = JSON.parse(localStorage.getItem(_raceWxKey(lat, lng, date)) || "null");
    if (c && typeof c.expires === "number" && Date.now() < c.expires) return c.value;
  } catch { /* ignore */ }
  return null;
}
function _writeRaceWx(lat, lng, date, value) {
  try {
    let expires;
    if (value.kind === "archive") {
      // Actual past-day weather never changes → cache 30 days.
      expires = Date.now() + 30 * 24 * 60 * 60 * 1000;
    } else if (value.kind === "climate") {
      expires = Date.now() + 7 * 24 * 60 * 60 * 1000;
    } else {
      const m = new Date(); m.setHours(24, 0, 0, 0); expires = m.getTime();
    }
    localStorage.setItem(_raceWxKey(lat, lng, date), JSON.stringify({ value, expires }));
  } catch { /* private mode / quota */ }
}

// ── Race-day weather resolver: a real daily forecast when the race is inside
// Caiyun's ~15-day window, otherwise a climate normal. Cached (see above) so
// repeated Races-tab visits don't refetch. Returns
// { kind: 'forecast' | 'climate', ...forecastLike } or null.
export async function fetchRaceDayWeather({ lat, lng, date }) {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng)) || !date) return null;
  const cached = _readRaceWx(lat, lng, date);
  if (cached) return cached;

  const daysOut = Math.round((new Date(`${date}T00:00:00`).getTime() - Date.now()) / 86400000);
  if (!Number.isFinite(daysOut)) return null;
  if (daysOut >= -1 && daysOut <= 14) {
    try {
      const forecasts = await fetchDailyForecasts({ lng, lat });
      const hit = forecasts.find(f => f.date === date);
      if (hit) { const v = { kind: 'forecast', ...hit }; _writeRaceWx(lat, lng, date, v); return v; }
    } catch { /* fall through to climate normal */ }
  }
  const normal = await fetchClimateNormal({ lat, lng, date });
  if (!normal) return null;
  const v = { kind: 'climate', ...normal };
  _writeRaceWx(lat, lng, date, v);
  return v;
}

// One-line summary string used inside the AI Coach prompt + activity rows.
// "28°C 体感30°C 湿度65% 多云 风2m/s AQI50". Skips missing fields silently.
export function formatWeatherShort(w, lang = 'zh') {
  if (!w) return '';
  const parts = [];
  const t = w.tempC ?? w.tempAvgC;
  const apparent = w.apparentC ?? w.apparentAvgC;
  if (Number.isFinite(t)) parts.push(`${t}°C`);
  if (Number.isFinite(apparent) && Math.abs(apparent - t) >= 1) {
    parts.push(lang === 'en' ? `feels ${apparent}°C` : `体感${apparent}°C`);
  }
  if (Number.isFinite(w.humidity)) {
    const rhPct = w.humidity > 1 ? Math.round(w.humidity) : Math.round(w.humidity * 100);
    parts.push(lang === 'en' ? `RH${rhPct}%` : `湿度${rhPct}%`);
  }
  if (w.skycon) parts.push(skyconMeta(w.skycon, lang).label);
  if (Number.isFinite(w.windSpeed) && w.windSpeed >= 1) {
    parts.push(lang === 'en' ? `wind ${w.windSpeed}km/h` : `风${w.windSpeed}km/h`);
  }
  if (Number.isFinite(w.aqi) && w.aqi > 0) parts.push(`AQI${w.aqi}`);
  return parts.join(' · ');
}
