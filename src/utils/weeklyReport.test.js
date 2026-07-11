import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { READINESS_FIELDS } from "./readinessContract";
import { buildWeeklyReportPrompt, weekWindow } from "./weeklyReport";

describe("weekly report contract", () => {
  it("uses the same sleep/legs/energy readiness contract for manual and background reports", () => {
    const range = weekWindow(new Date("2026-07-08T12:00:00+08:00"));
    const prompt = buildWeeklyReportPrompt({
      coachConfig: {}, logs: [], races: [], agentActions: [], memoryFacts: [],
      dailyNotes: [{ date: "2026-07-08", readiness: { sleep: 4, legs: 3, energy: 2, fatigue: 1 } }],
      now: new Date("2026-07-08T12:00:00+08:00"), range,
    });
    expect(READINESS_FIELDS).toEqual(["sleep", "legs", "energy"]);
    expect(prompt.user).toContain("readiness: sleep:4, legs:3, energy:2");
    expect(prompt.user).not.toContain("fatigue:1");

    const edgePath = fileURLToPath(new URL("../../supabase/functions/daily-coach-dispatch/index.ts", import.meta.url));
    const edgeSource = readFileSync(edgePath, "utf8");
    expect(edgeSource).toContain('const WEEKLY_READINESS_COLUMNS = ["readiness_sleep", "readiness_legs", "readiness_energy"]');
    for (const field of READINESS_FIELDS) expect(edgeSource).toContain(`readiness_${field}`);
  });

  it("keeps both paths on a full recap plus next-week recommendation contract", () => {
    const edgePath = fileURLToPath(new URL("../../supabase/functions/daily-coach-dispatch/index.ts", import.meta.url));
    const edgeSource = readFileSync(edgePath, "utf8");
    expect(edgeSource).toContain("detailed next 7-day plan");
    const range = weekWindow(new Date("2026-07-08T12:00:00+08:00"));
    const prompt = buildWeeklyReportPrompt({ coachConfig: {}, logs: [], races: [], dailyNotes: [], now: new Date(), range });
    expect(prompt.user).toContain("Give a detailed next 7-day training plan");
    expect(prompt.system).toContain("full report page");
  });
});
