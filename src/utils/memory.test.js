import { describe, expect, it } from "vitest";
import {
  buildMemoryUpdatePrompt,
  extractMemoryFacts,
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

describe("extractMemoryFacts", () => {
  it("extracts aligned bilingual facts with categories", () => {
    const facts = extractMemoryFacts({
      en: "[Injuries / Health]\n- Right achilles is sensitive on back-to-back trail days\n[Goals / Races]\n- Target race is 2026 UTMB CCC\n[Training Preferences]\n- None",
      zh: "[伤病 / 健康]\n- 右脚跟腱在连日越野后敏感\n[目标 / 比赛]\n- 目标赛是 2026 UTMB CCC\n[训练偏好]\n- 无",
    }, { clientPrefix: "test", memoryActionId: "action-1" });

    expect(facts).toHaveLength(2);
    expect(facts[0]).toMatchObject({
      clientId: "test-injury_health-1",
      category: "injury_health",
      contentEn: "Right achilles is sensitive on back-to-back trail days",
      contentZh: "右脚跟腱在连日越野后敏感",
      status: "active",
    });
    expect(facts[1]).toMatchObject({
      category: "goals_races",
      contentEn: "Target race is 2026 UTMB CCC",
      contentZh: "目标赛是 2026 UTMB CCC",
    });
  });

  it("supports Chinese-only memory text", () => {
    const facts = extractMemoryFacts({
      zh: "[训练偏好]\n- 偏好早晨空腹跑",
    });

    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      category: "training_preferences",
      contentEn: "",
      contentZh: "偏好早晨空腹跑",
    });
  });
});

describe("buildMemoryUpdatePrompt", () => {
  it("asks the model to update reviewed facts under stable sections", () => {
    const prompt = buildMemoryUpdatePrompt({
      memoryFacts: [
        {
          category: "coaching_style",
          status: "active",
          contentEn: "Prefers short replies.",
          contentZh: "偏好简短回复。",
        },
      ],
      chatTranscript: "[user]\nMy knee still feels sensitive on descents.",
    });

    for (const section of MEMORY_SECTIONS) {
      expect(prompt).toContain(section.en);
      expect(prompt).toContain(section.zh);
    }
    expect(prompt).toContain("Existing active Memory facts:");
    expect(prompt).toContain("Prefers short replies.");
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
