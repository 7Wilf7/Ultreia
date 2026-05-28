// Weather + geolocation client. Two responsibilities:
//   1. Get the user's lng/lat — Capacitor Geolocation on native, browser
//      navigator.geolocation on web, with a manual-entry fallback from
//      user_settings.default_lng/lat when neither works.
//   2. Hit /api/weather (Vercel function in prod, Vite middleware in dev)
//      and normalize Caiyun's verbose JSON into a flat shape the rest of
//      the app can store + render without re-learning the API.

import { useCallback, useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';

const isNative = () => Capacitor.isNativePlatform?.() === true;
const WEATHER_PROXY_ORIGIN = 'https://www.aitrainstudio.com';

// Round to 4 decimals so coords are stable across calls — the Vercel edge
// cache (and any future client-side cache) can then dedupe.
function roundCoord(n) {
  return Math.round(Number(n) * 10000) / 10000;
}

// Returns { lng, lat, source } where source ∈ 'native' | 'browser' | 'default'.
// Throws if no source is available — caller decides whether to surface or fall
// back to "weather unavailable".
export async function getCurrentLocation({ defaultLng, defaultLat } = {}) {
  if (isNative()) {
    try {
      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
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

  if (Number.isFinite(Number(defaultLng)) && Number.isFinite(Number(defaultLat))) {
    return {
      lng: roundCoord(defaultLng),
      lat: roundCoord(defaultLat),
      source: 'default',
    };
  }
  throw new Error('no_location_available');
}

// Wrapper around the proxy. Throws on non-2xx so callers can decide between
// "show error" and "fail silently and skip weather chip".
// `caiyunToken` (optional) — the user's own Caiyun token. When present the
// proxy uses it instead of the Vercel-side fallback so the user spends
// their own daily quota. Empty / undefined keeps the legacy behaviour.
async function fetchProxy({ lng, lat, type, begin, caiyunToken }) {
  const params = new URLSearchParams({
    lng: String(roundCoord(lng)),
    lat: String(roundCoord(lat)),
    type,
  });
  if (begin) params.set('begin', String(Math.floor(begin)));
  if (caiyunToken) params.set('token', caiyunToken);
  const base = isNative() ? WEATHER_PROXY_ORIGIN : '';
  const resp = await fetch(`${base}/api/weather?${params.toString()}`);
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`weather_proxy_${resp.status}: ${text.slice(0, 200)}`);
  }
  const data = await resp.json();
  if (data.status !== 'ok') {
    throw new Error(`caiyun_error: ${data.error || data.status}`);
  }
  return data;
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

// Pull realtime weather and reduce to a snapshot. lng/lat caller's job.
export async function fetchRealtimeSnapshot({ lng, lat, caiyunToken }) {
  const data = await fetchProxy({ lng, lat, type: 'realtime', caiyunToken });
  const r = data.result?.realtime;
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

// Historical weather for a specific moment in the past 24h. Caiyun's
// hourly endpoint with `begin=` returns 24 hours of past hourly data;
// we pick the hour closest to the requested timestamp.
export async function fetchHistoricalSnapshot({ lng, lat, when, caiyunToken }) {
  const beginSec = Math.floor(new Date(when).getTime() / 1000);
  if (!Number.isFinite(beginSec)) throw new Error('invalid_when');
  const data = await fetchProxy({ lng, lat, type: 'historical', begin: beginSec, caiyunToken });
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
export async function fetchDailyForecasts({ lng, lat, caiyunToken }) {
  const data = await fetchProxy({ lng, lat, type: 'daily', caiyunToken });
  const d = data.result?.daily;
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

// Pick the right fetch path for a given workout: future plan → daily forecast,
// past with timestamp → historical, otherwise realtime (= "now"). Returns
// the snapshot or null if location is unavailable.
export async function captureSnapshotForWorkout({ date, startedAt, lng, lat, caiyunToken }) {
  // Future / today-with-no-time → use daily forecast for that date.
  // Else if startedAt is in the past 24h → historical at that timestamp.
  // Else → realtime (now).
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  if (startedAt) {
    const tsMs = new Date(startedAt).getTime();
    if (Number.isFinite(tsMs)) {
      if (tsMs > now + dayMs) {
        // Far-future plan — try daily forecast keyed on the date.
        const forecasts = await fetchDailyForecasts({ lng, lat, caiyunToken });
        const dayKey = date || new Date(tsMs).toISOString().slice(0, 10);
        const hit = forecasts.find(f => f.date === dayKey);
        return hit ? { ts: new Date(tsMs).toISOString(), type: 'forecast', lng, lat, ...hit } : null;
      }
      if (tsMs <= now && now - tsMs < dayMs) {
        return await fetchHistoricalSnapshot({ lng, lat, when: tsMs, caiyunToken });
      }
    }
  }
  return await fetchRealtimeSnapshot({ lng, lat, caiyunToken });
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
const REALTIME_TTL_MS = 60 * 60 * 1000;

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
export function useWeatherContext({ defaultLng, defaultLat, caiyunToken } = {}) {
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
      const [rt, daily] = await Promise.all([
        needRealtime
          ? fetchRealtimeSnapshot({ lng: loc.lng, lat: loc.lat, caiyunToken })
          : Promise.resolve(cache?.realtime || null),
        needForecast
          ? fetchDailyForecasts({ lng: loc.lng, lat: loc.lat, caiyunToken }).catch(() => null)
          : Promise.resolve(cache?.forecasts || null),
      ]);
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
      setState({ currentWeather: null, forecastByDate: null, status: 'error', error: e.message || String(e), lastUpdatedAt: null });
    }
  }, [defaultLng, defaultLat, caiyunToken]);

  // run() is async — the setState calls inside happen on later ticks, not
  // synchronously inside the effect body. The lint rule still flags this
  // (it can't see across the await), so silence it explicitly.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void run(); }, [run]);

  // When the Caiyun token changes (user pasted a new one / cleared it),
  // bust the cache for this device — the prior cached entries were fetched
  // against a different token's quota tier and we want a clean refetch.
  useEffect(() => {
    try { localStorage.removeItem(CACHE_KEY); } catch { /* private mode */ }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void run({ force: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caiyunToken]);

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
