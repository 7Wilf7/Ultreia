import { describe, expect, it } from "vitest";
import { hasActionableCalendarSuggestion } from "./calendarSuggestion";

describe("calendar suggestion visibility", () => {
  it.each([
    "明天安排 8km Easy Run，周三休息。",
    "建议 2026-07-13 做 6km 节奏跑。",
    "Move Friday's strength session to Saturday.",
  ])("shows for dated actionable training advice: %s", (text) => {
    expect(hasActionableCalendarSuggestion(text)).toBe(true);
  });

  it.each([
    "你最近的有氧基础保持得不错。",
    "今天感觉怎么样？",
    "注意补水和早点睡。",
    "周三的训练完成得很好。",
  ])("stays hidden for analysis or vague advice: %s", (text) => {
    expect(hasActionableCalendarSuggestion(text)).toBe(false);
  });
});
