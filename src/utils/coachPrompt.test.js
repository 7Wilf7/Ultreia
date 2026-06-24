import { describe, expect, it } from "vitest";
import {
  appendCoachMessageMeta,
  buildAgentActionsBlock,
  buildDataBlock,
  buildMemoryFactsBlock,
  messageContentForCoach,
  normalizeTokenUsage,
  parseCoachMessageMeta,
} from "./coachPrompt";

describe("coach message metadata helpers", () => {
  it("appends and parses hidden message metadata", () => {
    const content = appendCoachMessageMeta("Coach reply", { kind: "post_import_review", ids: [1, 2] });

    expect(parseCoachMessageMeta(content)).toEqual({
      text: "Coach reply",
      meta: { kind: "post_import_review", ids: [1, 2] },
    });
  });

  it("strips hidden metadata before sending message content back to the coach", () => {
    const content = "Visible answer\n\n<!-- ultreia-meta:{\"kind\":\"x\"} -->";

    expect(messageContentForCoach(content)).toBe("Visible answer");
  });

  it("keeps visible text when hidden metadata is malformed", () => {
    expect(parseCoachMessageMeta("Visible\n<!-- ultreia-meta:{bad} -->")).toEqual({
      text: "Visible",
      meta: null,
    });
  });
});

describe("normalizeTokenUsage", () => {
  it("normalizes DeepSeek cache token fields", () => {
    expect(normalizeTokenUsage({
      input_tokens: 100,
      output_tokens: 40,
      prompt_cache_hit_tokens: 80,
      prompt_cache_miss_tokens: 20,
    })).toEqual({
      inputTokens: 100,
      outputTokens: 40,
      totalTokens: 140,
      inputCacheHitTokens: 80,
      inputCacheMissTokens: 20,
      inputCacheWriteTokens: 0,
    });
  });

  it("returns null for empty or non-numeric usage", () => {
    expect(normalizeTokenUsage(null)).toBeNull();
    expect(normalizeTokenUsage({ input_tokens: "nope" })).toBeNull();
  });
});

describe("buildAgentActionsBlock", () => {
  it("summarizes recent action outcomes for coach feedback", () => {
    const block = buildAgentActionsBlock([
      {
        type: "create_plans",
        status: "executed",
        updatedAt: "2026-06-23T10:00:00Z",
        payload: { plans: [{ date: "2026-06-24" }, { date: "2026-06-25" }] },
        result: { createdWorkoutCount: 2, plannedRestDates: ["2026-06-25"] },
      },
      {
        type: "memory_update",
        status: "rejected",
        updatedAt: "2026-06-22T10:00:00Z",
      },
    ]);

    expect(block).toContain("create plans");
    expect(block).toContain("status=executed");
    expect(block).toContain("dates=2026-06-24,2026-06-25");
    expect(block).toContain("created=2");
    expect(block).toContain("rest=2026-06-25");
    expect(block).toContain("memory update");
    expect(block).toContain("status=rejected");
  });

  it("limits action feedback lines", () => {
    const actions = Array.from({ length: 8 }, (_, idx) => ({
      type: "create_plans",
      status: "executed",
      updatedAt: `2026-06-${String(idx + 1).padStart(2, "0")}T10:00:00Z`,
    }));

    expect(buildAgentActionsBlock(actions, 3).split("\n")).toHaveLength(3);
  });
});

describe("buildMemoryFactsBlock", () => {
  it("includes only active reviewed facts", () => {
    const block = buildMemoryFactsBlock([
      { category: "injury_health", status: "active", contentEn: "Achilles gets irritated when easy runs become too fast.", updatedAt: "2026-06-24T10:00:00Z" },
      { category: "goals_races", status: "archived", contentEn: "Old race goal.", updatedAt: "2026-06-25T10:00:00Z" },
    ]);

    expect(block).toContain("Achilles");
    expect(block).not.toContain("Old race goal");
  });

  it("adds active facts to the live data block", () => {
    const block = buildDataBlock({
      logs: [],
      races: [],
      dailyNotes: [],
      now: new Date("2026-06-24T08:00:00+08:00"),
      memoryFacts: [
        { category: "training_preferences", status: "active", contentEn: "Prefers direct, data-first coaching.", updatedAt: "2026-06-24T10:00:00Z" },
      ],
    });

    expect(block).toContain("[Memory Facts");
    expect(block).toContain("Prefers direct, data-first coaching");
  });
});
