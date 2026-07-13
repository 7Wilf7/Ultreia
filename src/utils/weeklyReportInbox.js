import { weekWindow } from "./weeklyReport";

const WEEKLY_REPORT_UNREAD_TRACKING_STARTED_AT = Date.parse("2026-07-13T09:34:00Z");

function rangesEqual(a, b) {
  return !!a && !!b && a.start === b.start && a.end === b.end;
}

function reportSortValue(report) {
  return String(report?.generatedAt || report?.createdAt || report?.updatedAt || "");
}

function isReadyReport(report) {
  return report?.status !== "failed" && !!String(report?.text || "").trim();
}

export function isWeeklyReportUnread(report) {
  if (!isReadyReport(report) || report.readAt) return false;
  const generatedAt = Date.parse(report.generatedAt || report.createdAt || "");
  return Number.isFinite(generatedAt) && generatedAt >= WEEKLY_REPORT_UNREAD_TRACKING_STARTED_AT;
}

export function buildWeeklyReportRanges(reports, now = new Date()) {
  const currentDate = new Date(now);
  const thisWeek = weekWindow(currentDate, 0);
  const lastWeek = weekWindow(currentDate, -1);
  const showCurrentWeek = currentDate.getDay() === 0;
  const byKey = new Map();
  const seededRanges = showCurrentWeek ? [thisWeek, lastWeek] : [lastWeek];

  for (const range of seededRanges) {
    byKey.set(`${range.start}:${range.end}`, {
      ...range,
      reports: [],
      latest: null,
      latestReady: null,
    });
  }

  for (const report of reports || []) {
    if (!report?.start || !report?.end) continue;
    if (!showCurrentWeek && rangesEqual(report, thisWeek)) continue;
    const key = `${report.start}:${report.end}`;
    const current = byKey.get(key) || {
      start: report.start,
      end: report.end,
      nextStart: report.nextStart,
      nextEnd: report.nextEnd,
      reports: [],
      latest: null,
      latestReady: null,
    };
    current.nextStart ||= report.nextStart;
    current.nextEnd ||= report.nextEnd;
    current.reports.push(report);
    if (!current.latest || reportSortValue(report) > reportSortValue(current.latest)) current.latest = report;
    if (isReadyReport(report) && (!current.latestReady || reportSortValue(report) > reportSortValue(current.latestReady))) {
      current.latestReady = report;
    }
    byKey.set(key, current);
  }

  return [...byKey.values()].sort((a, b) => String(b.start).localeCompare(String(a.start)));
}

export function countUnreadWeeklyReportRanges(reports, now = new Date()) {
  return buildWeeklyReportRanges(reports, now)
    .filter(range => isWeeklyReportUnread(range.latestReady))
    .length;
}

export function mergeWeeklyReportUnread(pushUnread, reportUnread) {
  const daily = Number(pushUnread?.daily) || 0;
  const other = Number(pushUnread?.other) || 0;
  const weekly = Math.max(Number(pushUnread?.weekly) || 0, Number(reportUnread) || 0);
  return { daily, weekly, other, total: daily + weekly + other };
}
