// Training load via the session-RPE (sRPE) method + acute:chronic workload
// ratio (ACWR) — a simple, well-established overtraining / injury-risk signal.
//
//   session load = duration(min) × RPE          (sRPE)
//   acute        = 7-day EWMA, scaled back to weekly load
//   chronic      = 28-day EWMA, scaled back to weekly load
//   ACWR         = acute / chronic
//
// We use EWMA instead of a hard rolling 7-day sum so one big trail run decays
// smoothly instead of disappearing all at once when it crosses the day boundary.
//
// "Sweet spot" is ~0.8–1.3; >1.5 is the classic spike-injury danger zone.
// RPE is optional per session — when it's missing we fall back to a neutral
// moderate effort (4/10) so the metric still works, but we report rpeCoverage
// so the UI/coach can say "rough until you log RPE more consistently".

const DAY_MS = 24 * 60 * 60 * 1000;
const FALLBACK_RPE = 4;
const ACUTE_EWMA_DAYS = 7;
const CHRONIC_EWMA_DAYS = 28;

function sessionLoad(l) {
  const min = (Number(l.duration) || 0) / 60;
  if (min <= 0) return 0;
  const rpe = Number(l.rpe) > 0 ? Number(l.rpe) : FALLBACK_RPE;
  return min * rpe;
}

function startOfLocalDay(dateLike) {
  const d = dateLike instanceof Date ? new Date(dateLike) : new Date(`${dateLike}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

function localDateKey(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// `logs` is the full activity list; `now` a Date. Returns null when there's
// not enough completed training to say anything (no sessions in 28 days).
export function computeTrainingLoad(logs, now = new Date()) {
  const today = startOfLocalDay(now);
  if (!today) return null;
  const todayMs = today.getTime();
  const completed = (logs || []).filter(l => l && !l.isPlanned && (Number(l.duration) || 0) > 0);

  let in7 = 0, in28 = 0, rpe28 = 0, earliestMs = Infinity;
  const loadByDate = new Map();
  for (const l of completed) {
    const day = startOfLocalDay(l.date);
    if (!day) continue;
    const ms = day.getTime();
    if (ms > todayMs) continue; // ignore future-dated completed rows
    if (ms < earliestMs) earliestMs = ms;
    const load = sessionLoad(l);
    const key = localDateKey(day);
    loadByDate.set(key, (loadByDate.get(key) || 0) + load);
    const ageDays = Math.round((todayMs - ms) / DAY_MS);
    if (ageDays < 28) {
      in28 += 1;
      if (Number(l.rpe) > 0) rpe28 += 1;
    }
    if (ageDays < 7) {
      in7 += 1;
    }
  }

  if (in28 === 0) return null;

  let acuteDaily = 0;
  let chronicDaily = 0;
  for (let d = new Date(earliestMs); d <= today; d.setDate(d.getDate() + 1)) {
    const load = loadByDate.get(localDateKey(d)) || 0;
    acuteDaily += (load - acuteDaily) / ACUTE_EWMA_DAYS;
    chronicDaily += (load - chronicDaily) / CHRONIC_EWMA_DAYS;
  }

  const acute = acuteDaily * 7;
  const chronicWeekly = chronicDaily * 7;
  const acwr = chronicWeekly > 0 ? acute / chronicWeekly : null;
  // Chronic baseline needs ~3-4 weeks of history to mean anything.
  const historyDays = Number.isFinite(earliestMs) ? (todayMs - earliestMs) / DAY_MS : 0;
  const building = historyDays < 21;

  let ramp = "unknown";
  if (acwr != null && !building) {
    if (acwr < 0.8) ramp = "low";
    else if (acwr <= 1.3) ramp = "optimal";
    else if (acwr <= 1.5) ramp = "high";
    else ramp = "danger";
  }

  return {
    acute: Math.round(acute),
    chronicWeekly: Math.round(chronicWeekly),
    acwr: acwr != null ? Math.round(acwr * 100) / 100 : null,
    ramp,
    building,
    sessions7: in7,
    rpeCoverage: in28 > 0 ? rpe28 / in28 : 0,
    method: "ewma",
  };
}

// Simplified CTL/ATL trend for charts. It uses the same sRPE load, then smooths
// daily load with exponential averages: ATL reacts over ~7 days, CTL over ~28.
export function computeLoadTrend(logs, now = new Date(), days = 56) {
  const completed = (logs || []).filter(l => l && !l.isPlanned && (Number(l.duration) || 0) > 0);
  if (!completed.length) return [];

  const today = startOfLocalDay(now);
  if (!today) return [];
  const displayDays = Math.max(7, Math.round(days || 56));
  const displayStart = new Date(today);
  displayStart.setDate(today.getDate() - (displayDays - 1));

  const loadByDate = new Map();
  let earliest = null;
  for (const l of completed) {
    const d = startOfLocalDay(l.date);
    if (!d || d > today) continue;
    const key = localDateKey(d);
    loadByDate.set(key, (loadByDate.get(key) || 0) + sessionLoad(l));
    if (!earliest || d < earliest) earliest = d;
  }
  if (!earliest) return [];

  const warmupStart = new Date(displayStart);
  warmupStart.setDate(displayStart.getDate() - 42);
  const start = earliest < warmupStart ? earliest : warmupStart;
  const rows = [];
  let ctl = 0;
  let atl = 0;

  for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    const key = localDateKey(d);
    const load = loadByDate.get(key) || 0;
    atl += (load - atl) / ACUTE_EWMA_DAYS;
    ctl += (load - ctl) / CHRONIC_EWMA_DAYS;
    if (d >= displayStart) {
      rows.push({
        date: key,
        label: `${d.getMonth() + 1}-${d.getDate()}`,
        load: Math.round(load),
        atl: Math.round(atl),
        ctl: Math.round(ctl),
        tsb: Math.round(ctl - atl),
      });
    }
  }
  return rows;
}

// Compact English line for the coach prompt. "" when no load data.
export function formatTrainingLoadLine(load) {
  if (!load) return "";
  if (load.building || load.acwr == null) {
    return `acute(EWMA 7d)=${load.acute} sRPE, chronic(EWMA 4w)=${load.chronicWeekly} sRPE — baseline still building, ACWR not reliable yet`;
  }
  const cov = load.rpeCoverage < 0.5 ? " (rough: RPE logged on <half of sessions)" : "";
  return `acute(EWMA 7d)=${load.acute} sRPE, chronic(EWMA 4w)=${load.chronicWeekly} sRPE, ACWR=${load.acwr} (ramp: ${load.ramp})${cov}`;
}
