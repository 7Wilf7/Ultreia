import { describe, expect, it } from "vitest";
import {
  buildRaceBriefingPrompt,
  daysUntilRace,
  raceBriefingSignature,
  summarizeRaceBriefingTarget,
} from "./raceBriefing";

describe("race briefing helpers", () => {
  it("selects the nearest target race inside the 14-day window regardless of priority", () => {
    const now = new Date("2026-06-25T10:00:00+08:00");
    const races = [
      { id: "b", isTarget: true, priority: "B", date: "2026-06-28", name: "Tune-up", locationName: "Hangzhou" },
      { id: "a2", isTarget: true, priority: "A", date: "2026-07-20", name: "Too far", locationName: "Shanghai" },
      { id: "a1", isTarget: true, priority: "A", date: "2026-07-02", name: "Main Race", locationName: "Guangzhou" },
      { id: "c", isTarget: true, priority: "C", date: "2026-07-06", name: "Training race", locationName: "Suzhou" },
    ];

    const summary = summarizeRaceBriefingTarget(races, now);

    expect(summary).toMatchObject({
      daysToRace: 3,
      race: { id: "b" },
    });
    expect(summary.signature).toContain("Tune-up");
  });

  it("allows Hyrox targets without outdoor location context", () => {
    const summary = summarizeRaceBriefingTarget([
      { id: "hyrox", isTarget: true, priority: "A", date: "2026-06-30", name: "Hyrox Shanghai", category: "Hyrox" },
    ], new Date("2026-06-25T10:00:00+08:00"));

    expect(summary?.race.id).toBe("hyrox");
    expect(summary?.daysToRace).toBe(5);
  });

  it("uses priority only as a tie-breaker on the same date", () => {
    const summary = summarizeRaceBriefingTarget([
      { id: "c", isTarget: true, priority: "C", date: "2026-06-30", name: "C Race", locationName: "Suzhou" },
      { id: "a", isTarget: true, priority: "A", date: "2026-06-30", name: "A Race", locationName: "Suzhou" },
      { id: "b", isTarget: true, priority: "B", date: "2026-06-30", name: "B Race", locationName: "Suzhou" },
    ], new Date("2026-06-25T10:00:00+08:00"));

    expect(summary?.race.id).toBe("a");
  });

  it("ignores races without date window or context", () => {
    const now = new Date("2026-06-25T10:00:00+08:00");
    expect(summarizeRaceBriefingTarget([
      { id: "no-location", isTarget: true, priority: "B", date: "2026-06-30", name: "Unknown trail" },
      { id: "past", isTarget: true, priority: "C", date: "2026-06-20", name: "Past", locationName: "Ningbo" },
    ], now)).toBeNull();
  });

  it("computes day distance from local date keys", () => {
    expect(daysUntilRace(
      { date: "2026-06-26" },
      new Date("2026-06-25T23:30:00+08:00"),
    )).toBe(1);
  });

  it("includes weather in the repeat-prevention signature", () => {
    const race = { id: "a1", date: "2026-07-02", name: "Main Race", priority: "A", locationName: "Guangzhou" };
    const dry = raceBriefingSignature({ race }, { kind: "forecast", precipMm: 0 });
    const wet = raceBriefingSignature({ race }, { kind: "forecast", precipMm: 15 });

    expect(dry).not.toEqual(wet);
  });

  it("builds a Chinese markdown prompt with safety boundaries", () => {
    const prompt = buildRaceBriefingPrompt({
      summary: {
        daysToRace: 7,
        race: { name: "Main Race", date: "2026-07-02", category: "Trail", distance: 30, ascent: 1600 },
      },
      dataBlock: "[Recent Workouts]\n2026-06-24 Trail Run",
      coachPreferenceBlock: "[Weekly Training Preferences]\nSunday AM: Trail Run",
      now: new Date("2026-06-25T10:00:00+08:00"),
    });

    expect(prompt).toContain("## 装备检查");
    expect(prompt).toContain("Sunday AM: Trail Run");
    expect(prompt).toContain("Do not create calendar plans");
    expect(prompt).toContain("Do not diagnose injury or illness");
  });
});
