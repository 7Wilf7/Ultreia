import { describe, expect, it } from "vitest";
import { buildRecoveryGuardPrompt, summarizeRecoveryGuard } from "./recoveryGuard";

function completed(date, durationHours, rpe = 4, patch = {}) {
  return {
    id: `w-${date}-${durationHours}-${rpe}`,
    isPlanned: false,
    date,
    type: "Road Run",
    duration: durationHours * 3600,
    rpe,
    ...patch,
  };
}

describe("recovery guard helpers", () => {
  it("summarizes load and readiness risk when future plans exist", () => {
    const now = new Date("2026-06-25T10:00:00+08:00");
    const logs = [
      completed("2026-06-03", 1, 4),
      completed("2026-06-07", 1, 4),
      completed("2026-06-11", 1, 4),
      completed("2026-06-15", 1, 4),
      completed("2026-06-19", 2, 8, { note: "legs are sore and achilles tight" }),
      completed("2026-06-21", 2, 8),
      completed("2026-06-23", 2, 8),
      { id: "p1", isPlanned: true, date: "2026-06-26", type: "Road Run", distance: 16, subTypes: ["Tempo Run"], planDetail: { keySession: true } },
    ];
    const dailyNotes = [
      { date: "2026-06-24", readiness: { sleep: 1, legs: 1, energy: 2 }, tags: [] },
    ];

    const summary = summarizeRecoveryGuard(logs, dailyNotes, now);

    expect(summary).toMatchObject({
      today: "2026-06-25",
      futurePlanCount: 1,
      hardFuturePlanCount: 1,
    });
    expect(summary.signals.map(s => s.id)).toEqual(expect.arrayContaining([
      "load_danger",
      "high_rpe",
      "pain_fatigue_note",
      "poor_readiness",
    ]));
    expect(summary.trainingLoad.ramp).toBe("danger");
    expect(summary.futurePlans[0].planId).toBe("p1");
    expect(summary.futurePlans[0].keySession).toBe(true);
    expect(summary.futurePlans[0].line).toContain("key_session=true");
  });

  it("returns null when there is risk but nothing upcoming to guard", () => {
    const now = new Date("2026-06-25T10:00:00+08:00");
    const logs = [
      completed("2026-06-03", 1, 4),
      completed("2026-06-07", 1, 4),
      completed("2026-06-11", 1, 4),
      completed("2026-06-15", 1, 4),
      completed("2026-06-23", 2, 9, { note: "knee pain" }),
    ];

    expect(summarizeRecoveryGuard(logs, [], now)).toBeNull();
  });

  it("does not guard a plan dated today after the day is already in progress", () => {
    const now = new Date("2026-06-28T23:30:00+08:00");
    const logs = [
      completed("2026-06-26", 2, 9, { note: "legs sore" }),
      completed("2026-06-28", 3, 8),
      { id: "p-today", isPlanned: true, date: "2026-06-28", type: "Trail Run", distance: 24, ascent: 900 },
      { id: "p-next", isPlanned: true, date: "2026-06-29", type: "Road Run", distance: 6 },
    ];
    const dailyNotes = [
      { date: "2026-06-28", readiness: { sleep: 1, legs: 1, energy: 2 }, tags: [] },
    ];

    const summary = summarizeRecoveryGuard(logs, dailyNotes, now);

    expect(summary.futurePlans.map(p => p.planId)).toEqual(["p-next"]);
  });

  it("builds a JSON-only recovery guard prompt with plan ids", () => {
    const summary = {
      lookbackDays: 7,
      futureDays: 7,
      severity: "high",
      signals: [{ id: "high_rpe", label: "High recent RPE", detail: "2026-06-23 RPE 9" }],
      recentSessions: [{ line: "2026-06-23 Road Run 12km RPE 9 note=\"heavy legs\"" }],
      futurePlans: [{ line: "plan_id=p1 2026-06-26 Road Run (Tempo Run) 10km" }],
    };

    const prompt = buildRecoveryGuardPrompt({
      summary,
      dataBlock: "[Planned Sessions]\nplan_id=p1 2026-06-26 Road Run Tempo 10km",
      now: new Date("2026-06-25T10:00:00+08:00"),
    });

    expect(prompt).toContain("High recent RPE: 2026-06-23 RPE 9");
    expect(prompt).toContain("targetPlanId");
    expect(prompt).toContain("Do NOT diagnose injury or illness");
    expect(prompt).toContain("Plans marked key_session=true are protected anchor workouts");
    expect(prompt).toContain("Output the JSON array ONLY");
  });
});
