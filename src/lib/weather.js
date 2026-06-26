// Weather + geolocation client. Two responsibilities:
//   1. Get the user's lng/lat — Capacitor Geolocation on native, browser
//      navigator.geolocation on web, with a manual-entry fallback from
//      user_settings.default_lng/lat when neither works.
//   2. Hit the personal-mode Supabase weather-proxy Edge Function and normalize
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

export function isValidCoordValue(value, min, max) {
  if (value === "" || value == null) return false;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max;
}

export function hasValidCoords({ lng, lat } = {}) {
  return isValidCoordValue(lng, -180, 180) && isValidCoordValue(lat, -90, 90);
}

function uniqueParts(parts) {
  return parts
    .map(part => String(part || '').trim())
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i);
}

function stripCitySuffix(name) {
  return toSimplifiedChineseLabel(name).trim().replace(/(?:市|特别行政区)$/, '');
}

const TRADITIONAL_CHINESE_MAP = {
  廣: '广',
  東: '东',
  區: '区',
  縣: '县',
  鎮: '镇',
  鄉: '乡',
  街: '街',
  道: '道',
  裡: '里',
  里: '里',
  臺: '台',
  門: '门',
  灣: '湾',
  雲: '云',
  陽: '阳',
  陰: '阴',
  龍: '龙',
  鳳: '凤',
  黃: '黄',
  長: '长',
  樂: '乐',
  興: '兴',
  橋: '桥',
  濱: '滨',
  邊: '边',
  園: '园',
  國: '国',
  內: '内',
  廈: '厦',
  寧: '宁',
  貴: '贵',
  從: '从',
  營: '营',
  會: '会',
  學: '学',
  醫: '医',
  鐵: '铁',
  車: '车',
  運: '运',
  連: '连',
  島: '岛',
  閣: '阁',
  樓: '楼',
  館: '馆',
};

const TRADITIONAL_CHINESE_RE = new RegExp(`[${Object.keys(TRADITIONAL_CHINESE_MAP).join('')}]`, 'g');

function toSimplifiedChineseLabel(value) {
  return String(value || '').replace(TRADITIONAL_CHINESE_RE, ch => TRADITIONAL_CHINESE_MAP[ch] || ch);
}

const KNOWN_CITY_ABBREVIATIONS = {
  广州: 'GZ',
  guangzhou: 'GZ',
  深圳: 'SZ',
  shenzhen: 'SZ',
  上海: 'SH',
  shanghai: 'SH',
  北京: 'BJ',
  beijing: 'BJ',
  杭州: 'HZ',
  hangzhou: 'HZ',
  南京: 'NJ',
  nanjing: 'NJ',
  成都: 'CD',
  chengdu: 'CD',
  重庆: 'CQ',
  chongqing: 'CQ',
  武汉: 'WH',
  wuhan: 'WH',
  西安: 'XA',
  xian: 'XA',
  "xi'an": 'XA',
  苏州: 'SZ',
  suzhou: 'SZ',
  香港: 'HK',
  hongkong: 'HK',
  "hong kong": 'HK',
  澳门: 'MO',
  macau: 'MO',
  macao: 'MO',
};

const KNOWN_CITY_ALIASES = {
  guangzhou: '广州',
  shenzhen: '深圳',
  shanghai: '上海',
  beijing: '北京',
  hangzhou: '杭州',
  nanjing: '南京',
  chengdu: '成都',
  chongqing: '重庆',
  wuhan: '武汉',
  xian: '西安',
  "xi'an": '西安',
  suzhou: '苏州',
  hongkong: '香港',
  "hong kong": '香港',
  macau: '澳门',
  macao: '澳门',
};

const CITY_COORD_BOUNDS = [
  { city: '广州', minLat: 22.45, maxLat: 23.95, minLng: 112.85, maxLng: 114.1 },
  { city: '深圳', minLat: 22.35, maxLat: 22.9, minLng: 113.75, maxLng: 114.65 },
  { city: '上海', minLat: 30.65, maxLat: 31.9, minLng: 120.85, maxLng: 122.15 },
  { city: '北京', minLat: 39.4, maxLat: 41.1, minLng: 115.4, maxLng: 117.6 },
  { city: '杭州', minLat: 29.2, maxLat: 30.6, minLng: 118.3, maxLng: 120.75 },
  { city: '南京', minLat: 31.2, maxLat: 32.65, minLng: 118.35, maxLng: 119.25 },
  { city: '成都', minLat: 30.05, maxLat: 31.45, minLng: 102.9, maxLng: 104.9 },
  { city: '重庆', minLat: 28.1, maxLat: 32.2, minLng: 105.25, maxLng: 110.2 },
  { city: '武汉', minLat: 29.95, maxLat: 31.35, minLng: 113.65, maxLng: 115.1 },
  { city: '西安', minLat: 33.6, maxLat: 34.75, minLng: 107.4, maxLng: 109.5 },
  { city: '苏州', minLat: 30.75, maxLat: 32.05, minLng: 119.9, maxLng: 121.35 },
  { city: '香港', minLat: 22.13, maxLat: 22.57, minLng: 113.8, maxLng: 114.45 },
  { city: '澳门', minLat: 22.05, maxLat: 22.25, minLng: 113.5, maxLng: 113.65 },
];

function knownCityFromText(text) {
  const raw = toSimplifiedChineseLabel(text).trim();
  if (!raw) return '';
  const compact = raw.replace(/\s+/g, '').toLowerCase();
  const compactAscii = raw.toLowerCase().replace(/[^a-z]/g, '');
  for (const key of Object.keys(KNOWN_CITY_ABBREVIATIONS)) {
    const normalized = key.toLowerCase().replace(/\s+/g, '');
    if (/[\u3400-\u9fff]/.test(key)) {
      if (compact.includes(normalized)) return key;
    } else if (compactAscii.includes(normalized.replace(/[^a-z]/g, ''))) {
      return KNOWN_CITY_ALIASES[key] || key;
    }
  }
  return '';
}

function looksSubCityPlaceName(name) {
  const text = toSimplifiedChineseLabel(name).trim();
  if (!text) return false;
  return /(?:区|县|镇|乡|街道|街|村|社区|园区)$/u.test(text)
    || /\b(?:subdistrict|district|county|township|town|village|community|neighborhood)\b/i.test(text);
}

export function cityFromLocationName(name) {
  const raw = toSimplifiedChineseLabel(name).trim();
  if (!raw) return '';
  const compactRaw = raw.replace(/\s+/g, '');
  const municipalityMatch = compactRaw.match(/(北京市|上海市|天津市|重庆市|香港特别行政区|澳门特别行政区)/u);
  if (municipalityMatch?.[1]) return stripCitySuffix(municipalityMatch[1]);
  const afterProvince = compactRaw.replace(/^.*?(?:省|自治区)/u, '');
  const cityMatch = afterProvince.match(/([\p{Script=Han}A-Za-z][\p{Script=Han}A-Za-z·.' -]{0,12}?市)/u);
  if (cityMatch?.[1]) return stripCitySuffix(cityMatch[1]);
  const known = knownCityFromText(raw);
  if (known) return known;
  const parts = raw
    .split(/[,\s，、/]+/)
    .map(part => part.trim())
    .filter(Boolean)
    .filter(part => !/^(中国|China|中华人民共和国)$/i.test(part));
  const cityLike = parts.find(part => /市$/.test(part));
  if (cityLike) return stripCitySuffix(cityLike);
  const first = parts[0] || '';
  if (looksSubCityPlaceName(raw)) return '';
  return looksSubCityPlaceName(first) ? '' : stripCitySuffix(first);
}

function cityFromCoords({ lng, lat } = {}) {
  if (!hasValidCoords({ lng, lat })) return '';
  const nLng = Number(lng);
  const nLat = Number(lat);
  const hit = CITY_COORD_BOUNDS.find(item => (
    nLng >= item.minLng && nLng <= item.maxLng
    && nLat >= item.minLat && nLat <= item.maxLat
  ));
  return hit?.city || '';
}

export function cityFromLocation(location) {
  if (typeof location === 'string') return cityFromLocationName(location);
  const fromName = cityFromLocationName(location?.name);
  return fromName || cityFromCoords(location);
}

export function cityAbbreviationFromLocation(location, lang = 'zh') {
  const city = cityFromLocation(location);
  if (!city) return lang === 'zh' ? '未设' : 'unset';
  if (KNOWN_CITY_ABBREVIATIONS[city]) return KNOWN_CITY_ABBREVIATIONS[city];
  const normalizedCity = city.toLowerCase().replace(/\s+/g, ' ').trim();
  if (KNOWN_CITY_ABBREVIATIONS[normalizedCity]) return KNOWN_CITY_ABBREVIATIONS[normalizedCity];
  const ascii = city.match(/[A-Za-z]/g);
  if (ascii?.length) return ascii.join('').slice(0, 3).toUpperCase();
  const compact = city.replace(/[^\p{L}\p{N}]/gu, '');
  return compact.slice(0, 2) || city.slice(0, 2);
}

export function cityAbbreviationFromLocationName(name, lang = 'zh') {
  return cityAbbreviationFromLocation(name, lang);
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
// affordance) to deliberately opt into GPS and refresh the saved coords. That
// explicit tap uses high accuracy; passive auto-refresh stays quiet/coarse.
export async function getCurrentLocation({ defaultLng, defaultLat, forceDevice = false, highAccuracy = false } = {}) {
  const hasDefault = hasValidCoords({ lng: defaultLng, lat: defaultLat });
  if (hasDefault && !forceDevice) {
    return { lng: roundCoord(defaultLng), lat: roundCoord(defaultLat), source: 'default' };
  }
  if (isNative()) {
    try {
      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: !!(forceDevice || highAccuracy),
        timeout: forceDevice || highAccuracy ? 12000 : 8000,
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

// Personal-mode Supabase weather proxy. The Caiyun token stays in Edge Function
// secrets; successful fetches do not debit wallet records.
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
// legacy own-token path and the current shared server proxy bundle.
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
// legacy own-token path and the current shared server proxy bundle.
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

// One call to the weather-proxy Edge Function returns realtime + 7-day forecast
// in one shot.
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

// localStorage-backed cache for weather data. Auto refresh is a rolling
// interval from the last successful update, not a midnight schedule: if the
// app first fetches at 07:00 and the interval is 3h, the next eligible refresh
// is 10:00 while the app is open/foregrounded.
//
// Forecasts ride on the same bundle request as realtime weather. Manual
// refresh and location changes still bypass the interval.
const CACHE_KEY = 'ts.weather.v1';
export const WEATHER_AUTO_UPDATE_KEY = 'ultreia.weather.autoUpdate.v1';
export const WEATHER_UPDATE_INTERVAL_KEY = 'ultreia.weather.updateIntervalHours.v1';
export const DEFAULT_WEATHER_UPDATE_INTERVAL_HOURS = 3;
export const WEATHER_UPDATE_INTERVAL_OPTIONS = [3, 6, 12, 24];

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
export function getStoredWeatherSettings() {
  try {
    const rawAuto = localStorage.getItem(WEATHER_AUTO_UPDATE_KEY);
    const rawHours = localStorage.getItem(WEATHER_UPDATE_INTERVAL_KEY);
    const intervalHours = WEATHER_UPDATE_INTERVAL_OPTIONS.includes(Number(rawHours))
      ? Number(rawHours)
      : DEFAULT_WEATHER_UPDATE_INTERVAL_HOURS;
    return {
      autoUpdate: rawAuto == null ? true : rawAuto !== 'false',
      intervalHours,
    };
  } catch {
    return { autoUpdate: true, intervalHours: DEFAULT_WEATHER_UPDATE_INTERVAL_HOURS };
  }
}
export function setStoredWeatherSettings({ autoUpdate, intervalHours }) {
  try {
    if (typeof autoUpdate === 'boolean') localStorage.setItem(WEATHER_AUTO_UPDATE_KEY, autoUpdate ? 'true' : 'false');
    if (WEATHER_UPDATE_INTERVAL_OPTIONS.includes(Number(intervalHours))) {
      localStorage.setItem(WEATHER_UPDATE_INTERVAL_KEY, String(Number(intervalHours)));
    }
  } catch { /* private mode */ }
}
function realtimeFresh(cache, intervalHours, now = Date.now()) {
  if (!cache?.realtime || !cache?.realtimeAt) return false;
  const ttlMs = Math.max(1, Number(intervalHours) || DEFAULT_WEATHER_UPDATE_INTERVAL_HOURS) * 60 * 60 * 1000;
  return now - new Date(cache.realtimeAt).getTime() < ttlMs;
}
function coordsMatch(cache, lng, lat) {
  if (!cache) return false;
  return Number(cache.lng) === Number(lng) && Number(cache.lat) === Number(lat);
}

// React hook — fetches realtime + 7-day forecast with localStorage caching,
// exposes { currentWeather, forecastByDate, status, error, refetch }. Both
// AICoachTab and AppShell.sendChat consume this so the prompt preview
// matches what's actually sent. Pass `force: true` to refetch() to bypass
// the cache (used by the "refresh" affordance).
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
export function useWeatherContext({ defaultLng, defaultLat, autoUpdate = true, intervalHours = DEFAULT_WEATHER_UPDATE_INTERVAL_HOURS } = {}) {
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
    const allowAuto = autoUpdate !== false;
    const effectiveHours = WEATHER_UPDATE_INTERVAL_OPTIONS.includes(Number(intervalHours))
      ? Number(intervalHours)
      : DEFAULT_WEATHER_UPDATE_INTERVAL_HOURS;
    const cachedNow = readCache();
    if (!force && !allowAuto) {
      if (cachedNow?.realtime) {
        const m = new Map();
        if (Array.isArray(cachedNow.forecasts)) for (const f of cachedNow.forecasts) m.set(f.date, f);
        setState({ currentWeather: cachedNow.realtime, forecastByDate: m, status: 'ready', error: null, lastUpdatedAt: cachedNow.realtimeAt || null });
      }
      return;
    }
    // Fast path: both realtime + forecast are still fresh → serve straight from
    // cache WITHOUT touching device geolocation. This is the common case on
    // app-foreground refresh; calling getCurrentLocation() here is what popped
    // the Android "Location Accuracy" dialog every time the user switched back
    // to the app. Only invoke GPS when something is actually stale (or forced).
    if (!force && cachedNow && realtimeFresh(cachedNow, effectiveHours)) {
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
    const shouldFetch = force || !coordsMatch(cache, loc.lng, loc.lat) || !realtimeFresh(cache, effectiveHours);
    if (!shouldFetch && cache) {
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
      const today = localDateKey();
      const nextCache = {
        lng: loc.lng,
        lat: loc.lat,
        realtime: rt || null,
        realtimeAt: new Date().toISOString(),
        forecasts: daily || null,
        forecastDay: today,
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
  }, [defaultLng, defaultLat, autoUpdate, intervalHours]);

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

function compactReverseLabel(data, localityLanguage) {
  const administrative = Array.isArray(data?.localityInfo?.administrative)
    ? data.localityInfo.administrative
    : [];
  const adminNames = administrative
    .map(item => toSimplifiedChineseLabel(item?.name || item?.isoName).trim())
    .filter(Boolean)
    .filter(name => !/^(中国|China|中华人民共和国)$/i.test(name));
  const province = toSimplifiedChineseLabel(data?.principalSubdivision).trim();
  const city = toSimplifiedChineseLabel(data?.city).trim();
  const locality = toSimplifiedChineseLabel(data?.locality).trim();
  const candidates = uniqueParts([province, city, locality, ...adminNames]);
  if (!candidates.length) return '';

  if (localityLanguage === 'zh') {
    const cityPart = city || adminNames.find(name => /(市|自治州|地区|盟)$/u.test(name)) || '';
    const districtPart = adminNames.find(name => (
      name !== province
      && name !== cityPart
      && /(?:区|县|旗|县级市)$/u.test(name)
    )) || '';
    const localityPart = locality && ![province, cityPart, districtPart].includes(locality)
      ? locality
      : '';
    const focused = uniqueParts([province, cityPart, districtPart, localityPart]).filter(Boolean);
    return (focused.length ? focused : candidates.slice(-3)).join('');
  }
  return candidates.slice(-3).reverse().join(', ');
}

// Reverse-geocode WGS84 coords → a short, localized place label (usually
// district/city level, e.g. "广东省广州市白云区" or "Baiyun, Guangzhou"). Uses
// BigDataCloud's free reverse-geocode-client endpoint: no API key, CORS-
// enabled (works in the browser AND the Capacitor WebView), and localized via
// localityLanguage. The label is only for display; the precise weather lookup
// uses the coordinates.
// Returns "" on any failure so callers can fall back to manual entry.
export async function reverseGeocode({ lng, lat, lang = 'zh' }) {
  if (!hasValidCoords({ lng, lat })) return '';
  const localityLanguage = lang === 'en' ? 'en' : 'zh';
  const url = `https://api.bigdatacloud.net/data/reverse-geocode-client`
    + `?latitude=${roundCoord(lat)}&longitude=${roundCoord(lng)}&localityLanguage=${localityLanguage}`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return '';
    const d = await resp.json();
    return compactReverseLabel(d, localityLanguage);
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
    return (d.results || []).map(r => {
      const admin2 = r.admin2 || '';
      const regionParts = uniqueParts([admin2, r.admin1, r.country]);
      return {
        name: r.name,
        lat: r.latitude,
        lng: r.longitude,
        admin1: r.admin1 || '',
        admin2,
        country: r.country || '',
        regionLabel: regionParts.join(', '),
        // Disambiguation label, e.g. "白云山, 巴中市, 四川, 中国" — dedupe repeats.
        label: uniqueParts([r.name, ...regionParts]).join(', '),
      };
    });
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
  if (!hasValidCoords({ lng, lat }) || !date) return null;
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
  if (!hasValidCoords({ lng, lat }) || !date) return null;
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
  if (!hasValidCoords({ lng, lat }) || !date) return null;
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
  return `ultreia.raceWeather:${roundCoord(lat)}:${roundCoord(lng)}:${date}`;
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
  if (!hasValidCoords({ lng, lat }) || !date) return null;
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
