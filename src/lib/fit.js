// FIT-file parsing (Garmin / Coros / most watches export .fit natively).
//
// .fit is a BINARY format — we use fit-file-parser to decode it. The library is
// LAZY-loaded (dynamic import) so its weight only lands when a user actually
// imports a .fit, never on normal app open.
//
// We extract the session SUMMARY (to prefill a workout like the CSV path) plus
// two compact derived extras that CSV can't give:
//   • hrZoneSeconds — time spent in each HR zone Z1–Z5 (from per-record HR)
//   • gpsTrack      — a downsampled lat/lng route (~300 pts) for future posters
// We deliberately do NOT keep the full per-second stream (storage).

// Which zone a heart rate falls in. `zones` is the 5-entry [{id,low,high}] array
// from computeHRZones(). Below Z1 counts as Z1; above Z5 counts as Z5.
function zoneIndex(hr, zones) {
  for (let i = 0; i < zones.length; i++) {
    if (hr < zones[i].high) return i;
  }
  return zones.length - 1;
}

// Keep at most `max` points, evenly spaced, always including the last one.
function downsample(arr, max) {
  if (arr.length <= max) return arr;
  const step = Math.ceil(arr.length / max);
  const out = [];
  for (let i = 0; i < arr.length; i += step) out.push(arr[i]);
  if (out[out.length - 1] !== arr[arr.length - 1]) out.push(arr[arr.length - 1]);
  return out;
}

// Parse an ArrayBuffer (from <input type=file> → readAsArrayBuffer). Returns a
// normalized summary object; the caller maps sport→activity type (reusing the
// CSV mapper) and assembles the import row. `hrZones` (or null) drives the
// time-in-zone calc.
export async function parseFitFile(arrayBuffer, hrZones) {
  const mod = await import("fit-file-parser");
  const FitParser = mod.default || mod;
  const parser = new FitParser({ force: true, mode: "list", elapsedRecordField: true });

  const data = await new Promise((resolve, reject) => {
    parser.parse(arrayBuffer, (err, d) => (err ? reject(err) : resolve(d)));
  });

  const session = (data.sessions && data.sessions[0]) || {};
  const records = Array.isArray(data.records) ? data.records : [];

  const startRaw = session.start_time || (records[0] && records[0].timestamp) || null;
  const start = startRaw ? new Date(startRaw) : null;
  const durationSec = Math.round(session.total_timer_time || session.total_elapsed_time || 0);
  const distanceKm = session.total_distance ? +(session.total_distance / 1000).toFixed(2) : 0;
  const avgHr = session.avg_heart_rate ? Math.round(session.avg_heart_rate) : 0;
  const maxHr = session.max_heart_rate ? Math.round(session.max_heart_rate) : 0;
  const ascent = session.total_ascent ? Math.round(session.total_ascent) : 0;
  // FIT stores running cadence per-leg (rpm); watches/CSV show steps-per-minute
  // (both legs) — double it so it matches the rest of the app. Non-running uses
  // avg_cadence as-is.
  const cadence = session.avg_running_cadence
    ? Math.round(session.avg_running_cadence * 2)
    : (session.avg_cadence ? Math.round(session.avg_cadence) : 0);
  const aerobicTE = session.total_training_effect ? +Number(session.total_training_effect).toFixed(1) : 0;

  const sportStr = `${session.sport || ""} ${session.sub_sport || ""}`
    .toLowerCase().replace(/_/g, " ").trim();

  // Time-in-zone from per-record HR. Cap inter-record gaps at 10s so a paused
  // watch (long gap between samples) doesn't dump minutes into one zone.
  let hrZoneSeconds = null;
  if (hrZones && hrZones.length >= 5 && records.length) {
    const z = [0, 0, 0, 0, 0];
    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      if (r.heart_rate == null) continue;
      let dt = 1;
      const next = records[i + 1];
      if (next && r.timestamp && next.timestamp) {
        dt = (new Date(next.timestamp) - new Date(r.timestamp)) / 1000;
        if (!(dt > 0) || dt > 10) dt = 1;
      }
      z[zoneIndex(r.heart_rate, hrZones)] += dt;
    }
    hrZoneSeconds = z.map((s) => Math.round(s));
  }

  // Downsampled GPS route (lat/lng only), rounded to ~1m precision.
  const rawPts = [];
  for (const r of records) {
    if (Number.isFinite(r.position_lat) && Number.isFinite(r.position_long)) {
      rawPts.push([r.position_lat, r.position_long]);
    }
  }
  const gpsTrack = rawPts.length
    ? downsample(rawPts, 300).map(([a, b]) => [+a.toFixed(5), +b.toFixed(5)])
    : null;

  return {
    sportStr,
    date: start ? localDateKey(start) : "",
    startedAt: start ? start.toISOString() : null,
    distance: distanceKm,
    duration: durationSec,
    hr: avgHr,
    maxHR: maxHr,
    ascent,
    cadence,
    aerobicTE,
    hrZoneSeconds,
    gpsTrack,
  };
}

function localDateKey(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
