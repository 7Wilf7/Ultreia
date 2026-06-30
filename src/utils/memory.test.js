import { describe, expect, it } from "vitest";
import {
  buildMemoryUpdatePrompt,
  buildMemoryFactReview,
  buildMemoryFactSnapshotFromReview,
  extractMemoryFacts,
  fillEmptyMemorySections,
  formatCurrentTargetRacesForMemory,
  inferMemoryFactCategory,
  isMemorySectionHeading,
  MEMORY_SECTIONS,
  parseBilingualMemory,
  prepareMemoryFactSnapshot,
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

  it("tightens categories from fact content when the model puts an item under the wrong heading", () => {
    const facts = extractMemoryFacts({
      zh: "[训练偏好]\n- Hyrox 男双 Pro 是当前 A 级赛事\n[长期模式]\n- 偏好教练用若A则B的决策树式指令",
    });

    expect(facts[0]).toMatchObject({ category: "goals_races" });
    expect(facts[1]).toMatchObject({ category: "coaching_style" });
  });

  it("removes structured target-race priority from facts when current races are supplied", () => {
    const facts = extractMemoryFacts({
      en: "[Goals / Races]\n- HYROX Shenzhen is A-level, but should remain auxiliary and must not displace trail-running preparation.",
      zh: "[目标 / 比赛]\n- HYROX 深圳是当前 A 级赛事，但不应取代越野训练主线。",
    }, {
      races: [{ isTarget: true, name: "HYROX Shenzhen", category: "Hyrox", priority: "B" }],
    });

    expect(facts).toHaveLength(1);
    expect(facts[0].contentEn).not.toMatch(/A-level|Priority/i);
    expect(facts[0].contentZh).not.toMatch(/A 级|优先级/);
    expect(facts[0].contentEn).toContain("remain auxiliary");
    expect(facts[0].contentZh).toContain("不应取代越野训练主线");
  });
});

describe("memory snapshot merge", () => {
  it("separates changed facts from unchanged facts for review", () => {
    const oldFacts = [
      {
        rowId: "row-1",
        clientId: "old-1",
        status: "active",
        category: "coaching_style",
        contentZh: "偏好直接、少废话的教练回复。",
        contentEn: "Prefers direct, concise coaching replies.",
      },
      {
        rowId: "row-2",
        clientId: "old-2",
        status: "active",
        category: "injury_health",
        contentZh: "下坡后右膝容易敏感。",
      },
    ];
    const incomingFacts = [
      {
        clientId: "new-1",
        status: "active",
        category: "coaching_style",
        contentZh: "偏好直接、少废话的教练回复。",
        contentEn: "Prefers direct, concise coaching replies.",
      },
      {
        clientId: "new-2",
        status: "active",
        category: "training_preferences",
        contentZh: "周一上午默认休息。",
      },
    ];

    const review = buildMemoryFactReview(incomingFacts, oldFacts);
    expect(review.counts).toMatchObject({ unchanged: 1, new: 1, removed: 1 });

    const selected = new Set(review.entries.filter(entry => entry.kind !== "unchanged").map(entry => entry.key));
    const snapshot = buildMemoryFactSnapshotFromReview(review.entries, selected);

    expect(snapshot).toHaveLength(2);
    expect(snapshot.some(fact => fact.rowId === "row-1")).toBe(true);
    expect(snapshot.some(fact => fact.contentZh === "周一上午默认休息。")).toBe(true);
    expect(snapshot.some(fact => fact.rowId === "row-2")).toBe(false);
  });

  it("reuses matching active fact rows and archives facts missing from the new snapshot", () => {
    const existingFacts = [
      {
        rowId: "row-1",
        clientId: "old-1",
        status: "active",
        category: "injury_health",
        contentZh: "高负荷训练后倾向需要24–48小时恢复窗口；优先按摩、睡眠和营养。",
        acceptedAt: "2026-06-24T00:00:00Z",
      },
      {
        rowId: "row-2",
        clientId: "old-2",
        status: "active",
        category: "goals_races",
        contentZh: "Hyrox仅为交叉训练，无需专项技术训练。",
      },
      {
        rowId: "row-3",
        clientId: "old-3",
        status: "archived",
        category: "training_preferences",
        contentZh: "旧归档不参与替换。",
      },
    ];
    const incomingFacts = [
      {
        clientId: "new-1",
        status: "active",
        category: "recurring_patterns",
        contentZh: "高负荷训练后倾向需要24–48小时恢复；优先按摩、睡眠和营养。",
      },
      {
        clientId: "new-2",
        status: "active",
        category: "training_preferences",
        contentZh: "2026-08-15深圳 Hyrox 是当前 A 级赛事：男双 Pro。",
      },
    ];

    const snapshot = prepareMemoryFactSnapshot(incomingFacts, existingFacts);

    expect(snapshot.facts[0]).toMatchObject({
      rowId: "row-1",
      clientId: "old-1",
      category: "injury_health",
      acceptedAt: "2026-06-24T00:00:00Z",
    });
    expect(snapshot.facts[1]).toMatchObject({
      clientId: "new-2",
      category: "goals_races",
    });
    expect(snapshot.archivedFacts).toHaveLength(1);
    expect(snapshot.archivedFacts[0]).toMatchObject({ rowId: "row-2" });
  });
});

describe("inferMemoryFactCategory", () => {
  it("keeps category boundaries narrow", () => {
    expect(inferMemoryFactCategory({ contentZh: "静息心率约60 bpm；连续3天晨脉>65则降级计划。" }, "training_preferences")).toBe("injury_health");
    expect(inferMemoryFactCategory({ contentZh: "Hyrox 男双 Pro 是当前 A 级赛事。" }, "training_preferences")).toBe("goals_races");
    expect(inferMemoryFactCategory({ contentZh: "周模板：周一恢复跑，周二全休。" }, "recurring_patterns")).toBe("training_preferences");
    expect(inferMemoryFactCategory({ contentZh: "偏好教练使用若A则B的决策树式指令。" }, "recurring_patterns")).toBe("coaching_style");
    expect(inferMemoryFactCategory({ contentZh: "遇到生活冲突时会灵活调整计划，不事后追量。" }, "training_preferences")).toBe("recurring_patterns");
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

  it("treats current target races as source of truth over stale chat priorities", () => {
    const prompt = buildMemoryUpdatePrompt({
      races: [
        {
          isTarget: true,
          name: "HYROX Shenzhen",
          date: "2026-08-15",
          category: "Hyrox",
          subtype: "Doubles Pro",
          priority: "B",
        },
      ],
      chatTranscript: "[user]\nHYROX is A-level, but it should not override trail training.",
    });

    expect(prompt).toContain("Current target races from app settings");
    expect(prompt).toContain("HYROX Shenzhen");
    expect(prompt).toContain("Priority: B");
    expect(prompt).toContain("trust Current target races");
    expect(prompt).toContain("Do not store A/B/C priority");
    expect(prompt).toContain("HYROX should remain auxiliary");
  });
});

describe("memory section helpers", () => {
  it("formats only current target races for memory-update context", () => {
    expect(formatCurrentTargetRacesForMemory([
      { isTarget: false, name: "Past road race", date: "2026-05-01", priority: null },
      { isTarget: true, name: "HYROX Shenzhen", date: "2026-08-15", category: "Hyrox", priority: "B" },
    ])).toBe("- 2026-08-15 | HYROX Shenzhen | Type: Hyrox | Priority: B");
  });

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
