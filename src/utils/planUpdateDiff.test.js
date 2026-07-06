import { describe, expect, it } from "vitest";
import { filterNoopPlanUpdates, isNoopPlanUpdate } from "./planUpdateDiff";

describe("plan update diff helpers", () => {
  const existingStrength = {
    id: "plan-2026-07-10-strength",
    isPlanned: true,
    date: "2026-07-10",
    type: "Strength",
    subTypes: ["Upper Body", "Core"],
    distance: 0,
    ascent: 0,
    duration: 0,
    startedAt: "2026-07-10T18:00:00",
    planDetail: null,
  };

  it("treats an identical targeted strength replacement as a no-op", () => {
    const proposal = {
      action: "update",
      targetPlanId: existingStrength.id,
      date: "2026-07-10",
      type: "Strength",
      subTypes: ["Core", "Upper Body"],
      timeOfDay: "pm",
      notes: "保留上肢和核心激活。",
    };

    expect(isNoopPlanUpdate(proposal, [existingStrength])).toBe(true);
    expect(filterNoopPlanUpdates([proposal], [existingStrength])).toEqual([]);
  });

  it("keeps targeted updates when the calendar-visible plan changes", () => {
    const lowerBodyProposal = {
      action: "update",
      targetPlanId: existingStrength.id,
      date: "2026-07-10",
      type: "Strength",
      subTypes: ["Lower Body", "Core"],
      timeOfDay: "pm",
    };
    const morningProposal = {
      action: "update",
      targetPlanId: existingStrength.id,
      date: "2026-07-10",
      type: "Strength",
      subTypes: ["Upper Body", "Core"],
      timeOfDay: "am",
    };

    expect(isNoopPlanUpdate(lowerBodyProposal, [existingStrength])).toBe(false);
    expect(isNoopPlanUpdate(morningProposal, [existingStrength])).toBe(false);
    expect(filterNoopPlanUpdates([lowerBodyProposal, morningProposal], [existingStrength]))
      .toEqual([lowerBodyProposal, morningProposal]);
  });

  it("keeps create items and unmatched targeted updates", () => {
    const create = { date: "2026-07-11", type: "Road Run", distance: 6, timeOfDay: "am" };
    const unmatched = { action: "update", targetPlanId: "missing", date: "2026-07-10", type: "Strength", subTypes: ["Core"] };

    expect(filterNoopPlanUpdates([create, unmatched], [existingStrength])).toEqual([create, unmatched]);
  });
});
