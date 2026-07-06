import { describe, expect, it } from "vitest";
import { countInboxUnreadByTab, firstUnreadInboxTab, getInboxItemTab } from "../utils/inboxTabs";

describe("InboxModal unread tab helpers", () => {
  it("classifies push inbox items with the same buckets used by the inbox tabs", () => {
    expect(getInboxItemTab({ title: "Daily check-in", body: "Morning coach push" })).toBe("daily");
    expect(getInboxItemTab({ title: "AI 周复盘完成", body: "weekly report is ready" })).toBe("weekly");
    expect(getInboxItemTab({ title: "Memory update ready", body: "长期记忆建议" })).toBe("other");
  });

  it("counts unread messages per visible inbox tab", () => {
    const counts = countInboxUnreadByTab([
      { title: "Daily check-in", read: false },
      { title: "AI 周复盘完成", read: false },
      { title: "Memory update ready", read: false },
      { title: "Memory update already read", read: true },
    ]);

    expect(counts).toEqual({ daily: 1, weekly: 1, other: 1, total: 3 });
  });

  it("opens the first tab that contains unread messages", () => {
    expect(firstUnreadInboxTab({ daily: 0, weekly: 1, other: 1 })).toBe("weekly");
    expect(firstUnreadInboxTab({ daily: 0, weekly: 0, other: 1 })).toBe("other");
    expect(firstUnreadInboxTab({ daily: 0, weekly: 0, other: 0 })).toBe("daily");
  });
});
