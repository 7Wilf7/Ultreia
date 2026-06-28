import { describe, expect, it } from "vitest";
import { computeLoadTrend, computeTrainingLoad, formatTrainingLoadLine } from "./trainingLoad";

describe("computeTrainingLoad", () => {
  const now = new Date("2026-06-19T12:00:00");

  it("computes smoothed sRPE acute, chronic weekly load, ACWR, and RPE coverage", () => {
    const logs = [
      { date: "2026-06-18", duration: 60 * 60, rpe: 5 },
      { date: "2026-06-15", duration: 30 * 60, rpe: 4 },
      { date: "2026-06-08", duration: 45 * 60, rpe: 4 },
      { date: "2026-05-25", duration: 60 * 60, rpe: 3 },
    ];

    expect(computeTrainingLoad(logs, now)).toEqual({
      acute: 359,
      chronicWeekly: 147,
      acwr: 2.45,
      ramp: "danger",
      building: false,
      sessions7: 2,
      rpeCoverage: 1,
      method: "ewma",
    });
  });

  it("marks the baseline as building when history is too short", () => {
    const load = computeTrainingLoad([
      { date: "2026-06-18", duration: 60 * 60, rpe: 5 },
      { date: "2026-06-15", duration: 30 * 60 },
    ], now);

    expect(load.building).toBe(true);
    expect(load.ramp).toBe("unknown");
    expect(load.rpeCoverage).toBe(0.5);
    expect(load.method).toBe("ewma");
  });

  it("returns null when there is no completed training in the 28 day window", () => {
    expect(computeTrainingLoad([
      { date: "2026-05-01", duration: 60 * 60, rpe: 5 },
      { date: "2026-06-18", duration: 60 * 60, rpe: 5, isPlanned: true },
    ], now)).toBeNull();
  });

  it("smooths a large session instead of dropping it off a hard 7-day cliff", () => {
    const logs = [];
    for (let i = 27; i >= 0; i -= 1) {
      const d = new Date("2026-06-28T00:00:00");
      d.setDate(d.getDate() - i);
      logs.push({ date: d.toISOString().slice(0, 10), duration: 60 * 60, rpe: 5 });
    }
    logs.push({ date: "2026-06-21", duration: 6 * 60 * 60, rpe: 8 });

    const saturday = computeTrainingLoad(logs, new Date("2026-06-27T12:00:00"));
    const sunday = computeTrainingLoad(logs, new Date("2026-06-28T12:00:00"));

    expect(saturday.acute).toBe(3214);
    expect(sunday.acute).toBe(2755);
    expect(sunday.acute / saturday.acute).toBeGreaterThan(0.8);
    expect(sunday.acwr).toBe(1.49);
  });
});

describe("computeLoadTrend", () => {
  it("returns a fixed display window with daily load and smoothed ATL/CTL", () => {
    const trend = computeLoadTrend([
      { date: "2026-06-18", duration: 60 * 60, rpe: 5 },
    ], new Date("2026-06-19T12:00:00"), 7);

    expect(trend).toHaveLength(7);
    expect(trend.at(-2)).toMatchObject({ date: "2026-06-18", load: 300 });
    expect(trend.at(-1)).toMatchObject({ date: "2026-06-19", load: 0 });
  });
});

describe("formatTrainingLoadLine", () => {
  it("labels low RPE coverage as rough", () => {
    expect(formatTrainingLoadLine({
      acute: 420,
      chronicWeekly: 195,
      acwr: 2.15,
      ramp: "danger",
      building: false,
      rpeCoverage: 0.25,
    })).toContain("rough: RPE logged on <half of sessions");
  });
});
