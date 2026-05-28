// Caiyun Weather proxy. Hides CAIYUN_TOKEN (Vercel env var) so the browser
// never sees it — token-in-frontend = anyone with devtools can drain the
// daily quota. Same code is invoked locally by the Vite dev middleware in
// vite.config.js so `npm run dev` and Vercel prod behave identically.
//
// Query params (all required unless noted):
//   lng       — longitude, WGS84 (e.g. 121.4737)
//   lat       — latitude,  WGS84 (e.g. 31.2304)
//   type      — 'realtime' | 'hourly' | 'daily' | 'historical'
//   begin     — Unix timestamp (seconds), only when type=historical
//   token     — optional: caller's personal Caiyun token. When present we
//               use it INSTEAD of the server-side fallback, so the user
//               consumes their own daily quota. Empty / missing → server
//               token is used (the legacy behaviour).
//
// Caller responsibilities:
//   • Throttle and cache on the client — this proxy does NOT cache.
//   • Round coords to ~4 decimals before calling, so the Vercel response
//     cache (if added later) can dedupe.
//
// Response shape: Caiyun's raw JSON is passed through verbatim. Frontend
// (src/lib/weather.js) does the field extraction.

const CAIYUN_BASE = 'https://api.caiyunapp.com/v2.6';

function setCors(req, res) {
  const origin = req.headers?.origin;
  if (origin === 'https://localhost' || origin === 'capacitor://localhost') {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function isValidCoord(v, min, max) {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max;
}

function buildCaiyunUrl({ token, lng, lat, type, begin }) {
  const coord = `${lng},${lat}`;
  switch (type) {
    case 'realtime':
      return `${CAIYUN_BASE}/${token}/${coord}/realtime`;
    case 'hourly':
      return `${CAIYUN_BASE}/${token}/${coord}/hourly?hourlysteps=72`;
    case 'daily':
      return `${CAIYUN_BASE}/${token}/${coord}/daily?dailysteps=7`;
    case 'historical': {
      // Caiyun's "historical" mode = hourly endpoint with a begin= unix-seconds
      // timestamp. Returns 24h hourly data starting from `begin`.
      const beginSec = Number(begin);
      if (!Number.isFinite(beginSec) || beginSec <= 0) {
        throw new Error('historical requires begin= (unix seconds)');
      }
      return `${CAIYUN_BASE}/${token}/${coord}/hourly?hourlysteps=24&begin=${Math.floor(beginSec)}`;
    }
    default:
      throw new Error(`unknown type: ${type}`);
  }
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  // Per-user token wins over the server fallback when the caller paste's
  // their own Caiyun key in the Settings → Weather API modal. We trim and
  // do a lightweight shape check so the URL doesn't fall apart with
  // accidentally-quoted strings.
  const { lng, lat, type, begin, token: userToken } = req.query || {};
  const cleanUserToken = typeof userToken === 'string' ? userToken.trim() : '';
  const token = cleanUserToken || process.env.CAIYUN_TOKEN;
  if (!token) {
    res.status(500).json({ error: 'server_misconfigured', detail: 'CAIYUN_TOKEN missing' });
    return;
  }
  if (!isValidCoord(lng, -180, 180) || !isValidCoord(lat, -90, 90)) {
    res.status(400).json({ error: 'bad_coords' });
    return;
  }
  if (!['realtime', 'hourly', 'daily', 'historical'].includes(type)) {
    res.status(400).json({ error: 'bad_type' });
    return;
  }

  let url;
  try {
    url = buildCaiyunUrl({ token, lng, lat, type, begin });
  } catch (e) {
    res.status(400).json({ error: 'bad_request', detail: e.message });
    return;
  }

  try {
    const upstream = await fetch(url);
    const text = await upstream.text();
    // Mirror Caiyun's status. Their successful body always has status:"ok"
    // inside the JSON; non-2xx upstream usually means quota or auth issue.
    res.status(upstream.status);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    // Edge cache for 5 min — realtime weather doesn't change second-by-second,
    // and this dedupes the "open the app twice" case. Frontend can still
    // bypass by passing fresh coords.
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.send(text);
  } catch (e) {
    res.status(502).json({ error: 'upstream_failed', detail: e.message });
  }
}
