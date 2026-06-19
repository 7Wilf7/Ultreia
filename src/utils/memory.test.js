import { describe, expect, it } from "vitest";
import {
  buildMemoryUpdatePrompt,
  fillEmptyMemorySections,
  isMemorySectionHeading,
  MEMORY_SECTIONS,
  parseBilingualMemory,
} from "./memory";

describe("parseBilingualMemory", () => {
  it("splits aligned English and Chinese memory blocks", () => {
    expect(parseBilingualMemory("===EN===\n[Goals]\n- Trail race\n===ZH===\n[目标]\n- 越野赛")).toEqual({
      en: "[Goals]\n- Trail race",
      zh: "[目标]\n- 越野赛",
    });
  });

  it("falls back to the same plain text for both languages", () => {
    expect(parseBilingualMemory("Likes direct coaching.")).toEqual({
      en: "Likes direct coaching.",
      zh: "Likes direct coaching.",
    });
  });
});

describe("buildMemoryUpdatePrompt", () => {
  it("asks the model to keep memory grouped under stable sections", () => {
    const prompt = buildMemoryUpdatePrompt({
      coachMemory: "- Prefers short replies",
      chatTranscript: "[user]\nMy knee still feels sensitive on descents.",
    });

    for (const section of MEMORY_SECTIONS) {
      expect(prompt).toContain(section.en);
      expect(prompt).toContain(section.zh);
    }
    expect(prompt).toContain("Under each heading, write one short fact per line as \"- ...\".");
    expect(prompt).toContain("My knee still feels sensitive on descents.");
  });
});

describe("memory section helpers", () => {
  it("recognizes English and Chinese memory section headings", () => {
    expect(isMemorySectionHeading("[Goals / Races]")).toBe(true);
    expect(isMemorySectionHeading("[目标 / 比赛]")).toBe(true);
    expect(isMemorySectionHeading("- Target race: CCC")).toBe(false);
  });

  it("fills empty memory sections with an explicit none line", () => {
    expect(fillEmptyMemorySections("[Goals / Races]\n[Training Preferences]\n- Easy days easy", "en")).toBe(
      "[Goals / Races]\n- None\n[Training Preferences]\n- Easy days easy",
    );
    expect(fillEmptyMemorySections("[目标 / 比赛]\n[训练偏好]\n- 轻松日必须轻松", "zh")).toBe(
      "[目标 / 比赛]\n- 无\n[训练偏好]\n- 轻松日必须轻松",
    );
  });
});
