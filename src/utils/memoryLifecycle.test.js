import { describe, expect, it } from "vitest";
import {
  expiredShortMemoryFacts,
  memoryDecisionFingerprint,
  parseMemoryDecisionPayload,
  purgeableShortMemoryFacts,
  shortMemoryExpiresAt,
  validateMemoryDecisions,
} from "../../supabase/functions/_shared/memory-lifecycle.ts";

const activeFacts = [
  {
    id: "fact-1",
    category: "training_preferences",
    content_en: "Prefers long trail runs on Saturday mornings.",
    content_zh: "偏好周六上午进行长距离越野跑。",
    metadata: { memoryTier: "long" },
  },
];

describe("autonomous memory lifecycle", () => {
  it("parses fenced decision JSON", () => {
    expect(parseMemoryDecisionPayload("```json\n{\"decisions\":[]}\n```")).toEqual({ decisions: [] });
    expect(parseMemoryDecisionPayload("Result: {\"decisions\":[]} done")).toEqual({ decisions: [] });
  });

  it("rejects duplicate additions and cosmetic rewrites", () => {
    const result = validateMemoryDecisions({ decisions: [
      {
        action: "add",
        category: "training_preferences",
        retention: "long",
        content_en: "The runner prefers long trail runs on Saturday mornings.",
        content_zh: "跑者偏好在周六上午进行长距离越野跑。",
        basis: "explicit_user_statement",
      },
      {
        action: "update",
        memory_id: "fact-1",
        category: "training_preferences",
        retention: "long",
        content_en: "Prefers long trail runs on Saturday morning.",
        content_zh: "偏好周六上午进行长距离越野跑",
        basis: "repeated_observation",
      },
    ] }, activeFacts);

    expect(result.accepted).toEqual([]);
    expect(result.skipped.map((item) => item.reason)).toEqual(["duplicate", "cosmetic_update"]);
  });

  it("requires explicit correction or obsolete source before archiving", () => {
    const rejected = validateMemoryDecisions({ decisions: [{
      action: "archive",
      memory_id: "fact-1",
      basis: "not_mentioned_today",
    }] }, activeFacts);
    const accepted = validateMemoryDecisions({ decisions: [{
      action: "archive",
      memory_id: "fact-1",
      basis: "explicit_correction",
      reason: "The runner explicitly changed this preference.",
    }] }, activeFacts);

    expect(rejected.accepted).toEqual([]);
    expect(rejected.skipped[0].reason).toBe("archive_basis_not_allowed");
    expect(accepted.accepted[0].action).toBe("archive");
  });

  it("clamps short-term retention and finds expired facts", () => {
    const result = validateMemoryDecisions({ decisions: [{
      action: "add",
      category: "injury_health",
      retention: "short",
      ttl_days: 90,
      content_en: "Temporary calf tightness should limit intensity.",
      content_zh: "小腿暂时紧张，近期应限制训练强度。",
      basis: "explicit_user_statement",
    }] }, activeFacts);
    expect(result.accepted[0].ttlDays).toBe(45);

    const expiresAt = shortMemoryExpiresAt("2026-07-01T00:00:00.000Z", 3);
    const expired = expiredShortMemoryFacts([{
      id: "short-1",
      metadata: { memoryTier: "short", expiresAt },
    }], "2026-07-04T00:00:00.000Z");
    expect(expired.map((fact) => fact.id)).toEqual(["short-1"]);

    const purgeable = purgeableShortMemoryFacts([{
      id: "short-1",
      status: "archived",
      metadata: { memoryTier: "short", expiredAt: "2026-06-01T00:00:00.000Z" },
    }, {
      id: "long-1",
      status: "archived",
      metadata: { memoryTier: "long", expiredAt: "2026-06-01T00:00:00.000Z" },
    }], "2026-07-04T00:00:00.000Z");
    expect(purgeable.map((fact) => fact.id)).toEqual(["short-1"]);
  });

  it("uses content rather than model ordering for new fact identity", () => {
    const decision = {
      category: "coaching_style",
      contentEn: "Be direct when recovery data conflicts with the plan.",
      contentZh: "恢复数据与计划冲突时直接指出。",
    };
    expect(memoryDecisionFingerprint(decision)).toBe(memoryDecisionFingerprint({ ...decision }));
    expect(memoryDecisionFingerprint({ ...decision, contentZh: "恢复数据冲突时先提醒。" }))
      .not.toBe(memoryDecisionFingerprint(decision));
  });
});
