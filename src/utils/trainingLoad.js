// Training load via the session-RPE (sRPE) method + acute:chronic workload
// ratio (ACWR) — a simple, well-established overtraining / injury-risk signal.
//
//   session load = duration(min) × RPE          (sRPE)
//   acute        = sum of session load, last 7 days
//   chronic      = average WEEKLY load over the last 28 days  (= 28d sum / 4)
//   ACWR         = acute / chronic
//
// "Sweet spot" is ~0.8–1.3; >1.5 is the classic spike-injury danger zone.
// RPE is optional per session — when it's missing we fall back to a neutral
// moderate effort (4/10) so the metric still works, but we report rpeCoverage
// so the UI/coach can say "rough until you log RPE more consistently".

const DAY_MS = 24 * 60 * 60 * 1000;
const FALLBACK_RPE = 4;

function sessionLoad(l) {
  const min = (Number(l.duration) || 0) / 60;
  if (min <= 0) return 0;
  const rpe = Number(l.rpe) > 0 ? Number(l.rpe) : FALLBACK_RPE;
  return min * rpe;
}

// `logs` is the full activity list; `now` a Date. Returns null when there's
// not enough completed training to say anything (no sessions in 28 days).
export function computeTrainingLoad(logs, now = new Date()) {
  const nowMs = now.getTime();
  const completed = (logs || []).filter(l => l && !l.isPlanned && (Number(l.duration) || 0) > 0);

  let acute = 0, chronic28 = 0, in7 = 0, in28 = 0, rpe28 = 0, earliestMs = Infinity;
  for (const l of completed) {
    const ms = new Date(`${l.date}T00:00:00`).getTime();
    if (Number.isNaN(ms)) continue;
    const ageMs = nowMs - ms;
    if (ageMs < -DAY_MS) continue; // ignore future-dated completed rows
    if (ms < earliestMs) earliestMs = ms;
    const load = sessionLoad(l);
    if (ageMs <= 28 * DAY_MS) {
      chronic28 += load;
      in28 += 1;
      if (Number(l.rpe) > 0) rpe28 += 1;
    }
    if (ageMs <= 7 * DAY_MS) {
      acute += load;
      in7 += 1;
    }
  }

  if (in28 === 0) return null;

  const chronicWeekly = chronic28 / 4;
  const acwr = chronicWeekly > 0 ? acute / chronicWeekly : null;
  // Chronic baseline needs ~3-4 weeks of history to mean anything.
  const historyDays = Number.isFinite(earliestMs) ? (nowMs - earliestMs) / DAY_MS : 0;
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
  };
}

// Compact English line for the coach prompt. "" when no load data.
export function formatTrainingLoadLine(load) {
  if (!load) return "";
  if (load.building || load.acwr == null) {
    return `acute(7d)=${load.acute} sRPE, chronic(wk-avg)=${load.chronicWeekly} sRPE — baseline still building, ACWR not reliable yet`;
  }
  const cov = load.rpeCoverage < 0.5 ? " (rough: RPE logged on <half of sessions)" : "";
  return `acute(7d)=${load.acute} sRPE, chronic(wk-avg)=${load.chronicWeekly} sRPE, ACWR=${load.acwr} (ramp: ${load.ramp})${cov}`;
}
