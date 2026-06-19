import { describe, expect, it } from "vitest";
import { appendCoachMessageMeta, messageContentForCoach, normalizeTokenUsage, parseCoachMessageMeta } from "./coachPrompt";

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
