import { describe, expect, it, vi } from "vitest";
import { coachProxyActionErrorCode } from "../lib/db/usage";
import { calculateCoachBaseContextUsage, scheduleCoachContextCalculation } from "./coachContextUsage";

const baseArgs = {
  logs: [],
  races: [],
  now: new Date("2026-07-13T10:00:00+08:00"),
  currentWeather: null,
  forecastByDate: null,
  dailyNotes: [],
  agentActions: [],
  memoryFacts: [],
  profile: {},
  coachConfig: {},
  fixedOverheadTokens: 2500,
};

describe("coach context usage", () => {
  it("counts the system prompt once and each visible history message once", () => {
    const calls = [];
    const countTokens = (text) => {
      calls.push(text);
      return text.length;
    };
    const result = calculateCoachBaseContextUsage({
      ...baseArgs,
      chatMessages: [
        { role: "user", content: "Visible question" },
        { role: "assistant", content: "Visible answer\n<!-- ultreia-meta:{\"provider\":\"desktop_codex\"} -->" },
      ],
    }, countTokens);

    expect(result.systemTokens).toBeGreaterThan(0);
    expect(result.historyTokens).toBe("[user]\nVisible question".length + "[assistant]\nVisible answer".length);
    expect(calls).toHaveLength(3);
    expect(calls[2]).not.toContain("ultreia-meta");
  });

  it("keeps the fixed fallback when system prompt construction fails", () => {
    const result = calculateCoachBaseContextUsage({
      ...baseArgs,
      now: null,
      chatMessages: [{ role: "user", content: "hello" }],
    }, text => text.length);

    expect(result).toEqual({
      systemTokens: 2500,
      historyTokens: "[user]\nhello".length,
    });
  });

  it("defers calculation until idle and ignores a cancelled stale callback", () => {
    const callbacks = [];
    const host = {
      requestIdleCallback: vi.fn((callback) => {
        callbacks.push(callback);
        return callbacks.length;
      }),
      cancelIdleCallback: vi.fn(),
    };
    const staleCommit = vi.fn();
    const freshCommit = vi.fn();
    const cancelStale = scheduleCoachContextCalculation({
      host,
      calculate: () => "stale",
      commit: staleCommit,
    });
    cancelStale();
    scheduleCoachContextCalculation({
      host,
      calculate: () => "fresh",
      commit: freshCommit,
    });

    expect(staleCommit).not.toHaveBeenCalled();
    expect(freshCommit).not.toHaveBeenCalled();
    callbacks[0]();
    callbacks[1]();
    expect(staleCommit).not.toHaveBeenCalled();
    expect(freshCommit).toHaveBeenCalledWith("fresh");
    expect(host.cancelIdleCallback).toHaveBeenCalledWith(1);
  });

  it("uses the delayed fallback when requestIdleCallback is unavailable", () => {
    let callback;
    const host = {
      setTimeout: vi.fn((next) => {
        callback = next;
        return 7;
      }),
      clearTimeout: vi.fn(),
    };
    const commit = vi.fn();
    const cancel = scheduleCoachContextCalculation({
      host,
      calculate: () => 42,
      commit,
    });

    expect(host.setTimeout).toHaveBeenCalledWith(expect.any(Function), 120);
    expect(commit).not.toHaveBeenCalled();
    callback();
    expect(commit).toHaveBeenCalledWith(42);
    cancel();
    expect(host.clearTimeout).toHaveBeenCalledWith(7);
  });
});

describe("durable coach job responses", () => {
  it("treats a successful failed-job envelope as job state, not an HTTP failure", () => {
    expect(coachProxyActionErrorCode(
      { ok: true, status: 202 },
      { status: "expired", error: "user_cancelled" },
    )).toBeNull();
  });

  it("keeps transport and authorization failures exceptional", () => {
    expect(coachProxyActionErrorCode(
      { ok: false, status: 403 },
      { error: "async_sink_forbidden" },
    )).toBe("async_sink_forbidden");
  });
});
