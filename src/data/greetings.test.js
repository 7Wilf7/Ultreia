import { beforeEach, describe, expect, it } from "vitest";
import { GREETINGS, pickGreeting } from "./greetings";

function makeStorage() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
  };
}

describe("splash greetings", () => {
  beforeEach(() => {
    globalThis.localStorage = makeStorage();
  });

  it("uses a full shuffled deck before repeating a greeting", () => {
    const seen = new Set();
    for (let i = 0; i < GREETINGS.length; i++) {
      const greeting = pickGreeting(new Date("2026-06-25T08:00:00+08:00"), "test-user");
      const key = `${greeting.en}|${greeting.zh}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }

    expect(seen.size).toBe(GREETINGS.length);
  });

  it("keeps status-bound training phrases out of the splash pool", () => {
    const text = GREETINGS.map(g => `${g.en} ${g.zh}`).join("\n").toLowerCase();

    [
      "taper",
      "rest day",
      "streak",
      "zone 2",
      "easy run",
      "hard day",
      "respect the plan",
      "减量",
      "休息日",
      "连胜",
      "轻松跑",
      "强度日",
      "尊重计划",
    ].forEach(phrase => {
      expect(text).not.toContain(phrase);
    });
  });
});
