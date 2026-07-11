import { describe, expect, it } from "vitest";
import { evaluatePlanOutcome, matchPlansToActuals, PLAN_DONE_RATIO } from "./planMatch";

const plan = (id, extra = {}) => ({ id, isPlanned: true, date: "2026-06-20", type: "Road Run", ...extra });
const actual = (id, extra = {}) => ({ id, isPlanned: false, date: "2026-06-20", type: "Road Run", ...extra });

describe("one-to-one plan matching", () => {
  it("keeps explicit done as a manual override", () => {
    expect(evaluatePlanOutcome(plan("p1", { planStatus: "done", distance: 10 }), [], { isPast: true }))
      .toEqual({ outcome: "done", ratio: null });
  });

  it("does not let one actual complete two same-day Road Run plans", () => {
    const results = matchPlansToActuals([
      plan("p5", { distance: 5 }),
      plan("p10", { distance: 10 }),
    ], [actual("a9", { distance: 9 })], { isPast: true });

    expect(results.map(result => [result.plan.id, result.actual?.id || null, result.outcome]))
      .toEqual([
        ["p5", null, "missed"],
        ["p10", "a9", "done"],
      ]);
  });

  it("keeps Tempo and Easy content from cross-matching", () => {
    const results = matchPlansToActuals([
      plan("tempo", { distance: 8, subTypes: ["Tempo Run"] }),
      plan("easy", { distance: 6, subTypes: ["Easy Run"] }),
    ], [
      actual("easy-actual", { distance: 6, subTypes: ["Easy Run"] }),
      actual("tempo-actual", { distance: 8, subTypes: ["Tempo Run"] }),
    ], { isPast: true });

    expect(results.map(result => [result.plan.id, result.actual?.id]))
      .toEqual([["tempo", "tempo-actual"], ["easy", "easy-actual"]]);
    expect(matchPlansToActuals(
      [plan("tempo-only", { distance: 8, subTypes: ["Tempo Run"] })],
      [actual("easy-only", { distance: 8, subTypes: ["Easy Run"] })],
      { isPast: true },
    )[0]).toMatchObject({ outcome: "missed", actual: null });
  });

  it("assigns multiple plans and actuals by closest target", () => {
    const results = matchPlansToActuals([
      plan("short", { distance: 5 }),
      plan("long", { distance: 12 }),
    ], [
      actual("long-actual", { distance: 11 }),
      actual("short-actual", { distance: 4.2 }),
    ], { isPast: true });

    expect(results.map(result => [result.plan.id, result.actual.id, result.outcome]))
      .toEqual([["short", "short-actual", "done"], ["long", "long-actual", "done"]]);
  });

  it("reports partial, over-complete and metric-less outcomes", () => {
    const results = matchPlansToActuals([
      plan("partial", { distance: 10, subTypes: ["Easy Run"] }),
      plan("over", { distance: 5, subTypes: ["Tempo Run"] }),
      { id: "hiit", isPlanned: true, date: "2026-06-20", type: "HIIT" },
    ], [
      actual("partial-actual", { distance: 6, subTypes: ["Easy Run"] }),
      actual("over-actual", { distance: 8, subTypes: ["Tempo Run"] }),
      { id: "hiit-actual", isPlanned: false, date: "2026-06-20", type: "HIIT", duration: 1200 },
    ], { isPast: true });

    expect(PLAN_DONE_RATIO).toBe(0.8);
    expect(results.map(result => [result.plan.id, result.outcome, result.ratio]))
      .toEqual([
        ["partial", "partial", 0.6],
        ["over", "done", 1.6],
        ["hiit", "done", null],
      ]);
  });

  it("uses time of day to break otherwise similar matches", () => {
    const results = matchPlansToActuals([
      plan("morning", { distance: 6, startedAt: "2026-06-20T07:00:00+08:00" }),
      plan("evening", { distance: 6, startedAt: "2026-06-20T19:00:00+08:00" }),
    ], [
      actual("pm", { distance: 6, startedAt: "2026-06-20T19:30:00+08:00" }),
      actual("am", { distance: 6, startedAt: "2026-06-20T07:30:00+08:00" }),
    ], { isPast: true });
    expect(results.map(result => [result.plan.id, result.actual.id]))
      .toEqual([["morning", "am"], ["evening", "pm"]]);
  });

  it("separates current/future pending from historical missed", () => {
    const noActual = [plan("p", { distance: 10 })];
    expect(matchPlansToActuals(noActual, [], { isPast: true })[0].outcome).toBe("missed");
    expect(matchPlansToActuals(noActual, [], { isPast: false })[0].outcome).toBe("pending");
  });

  it("does not aggregate several actual workouts into one plan", () => {
    expect(evaluatePlanOutcome(plan("p", { distance: 10 }), [
      actual("a1", { distance: 4 }),
      actual("a2", { distance: 4 }),
    ], { isPast: true })).toEqual({ outcome: "partial", ratio: 0.4 });
  });
});
