import { describe, expect, it } from "vitest";
import {
  buildWeeklyReportRanges,
  countUnreadWeeklyReportRanges,
  isWeeklyReportUnread,
  mergeWeeklyReportUnread,
} from "./weeklyReportInbox";

function report(overrides = {}) {
  return {
    id: "report-1",
    start: "2026-07-13",
    end: "2026-07-19",
    status: "ready",
    text: "Weekly report",
    generatedAt: "2026-07-19T10:00:00+08:00",
    readAt: null,
    ...overrides,
  };
}

describe("weekly report inbox", () => {
  it("hides the current week from Monday through Saturday", () => {
    for (const date of ["2026-07-13", "2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17", "2026-07-18"]) {
      const ranges = buildWeeklyReportRanges([report()], new Date(`${date}T12:00:00+08:00`));
      expect(ranges.map(range => range.start)).not.toContain("2026-07-13");
      expect(ranges.map(range => range.start)).toContain("2026-07-06");
    }
  });

  it("shows the current week on Sunday and keeps older history", () => {
    const ranges = buildWeeklyReportRanges([
      report(),
      report({ id: "older", start: "2026-06-29", end: "2026-07-05", generatedAt: "2026-07-05T10:00:00+08:00" }),
    ], new Date("2026-07-19T12:00:00+08:00"));
    expect(ranges.map(range => range.start)).toEqual(["2026-07-13", "2026-07-06", "2026-06-29"]);
  });

  it("counts only the newest unread ready report for each visible range", () => {
    const reports = [
      report({ id: "old", generatedAt: "2026-07-19T09:00:00+08:00" }),
      report({ id: "new", generatedAt: "2026-07-19T10:00:00+08:00" }),
      report({ id: "last-week", start: "2026-07-06", end: "2026-07-12", readAt: "2026-07-13T08:00:00+08:00" }),
      report({ id: "failed", start: "2026-06-29", end: "2026-07-05", status: "failed", text: "", readAt: null }),
    ];
    expect(countUnreadWeeklyReportRanges(reports, new Date("2026-07-19T12:00:00+08:00"))).toBe(1);
    expect(countUnreadWeeklyReportRanges(reports, new Date("2026-07-18T12:00:00+08:00"))).toBe(0);
  });

  it("does not turn reports created before unread tracking into new reminders", () => {
    expect(isWeeklyReportUnread(report({ generatedAt: "2026-07-13T09:33:59Z" }))).toBe(false);
    expect(isWeeklyReportUnread(report({ generatedAt: "2026-07-13T09:34:00Z" }))).toBe(true);
  });

  it("does not double-count a report and its push reminder", () => {
    expect(mergeWeeklyReportUnread({ daily: 1, weekly: 1, other: 2, total: 4 }, 1))
      .toEqual({ daily: 1, weekly: 1, other: 2, total: 4 });
    expect(mergeWeeklyReportUnread({ daily: 1, weekly: 0, other: 0, total: 1 }, 2))
      .toEqual({ daily: 1, weekly: 2, other: 0, total: 3 });
  });
});
