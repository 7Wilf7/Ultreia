function inboxTextParts(item) {
  return {
    title: String(item?.title || "").toLowerCase(),
    body: String(item?.body || "").toLowerCase(),
    combined: `${item?.title || ""} ${item?.body || ""}`.toLowerCase(),
  };
}

function isWeeklyInboxItem(item) {
  const { combined } = inboxTextParts(item);
  return combined.includes("周复盘") || combined.includes("weekly report") || combined.includes("weekly recap");
}

function isOtherInboxItem(item) {
  const { title, combined } = inboxTextParts(item);
  if (title.includes("记忆") || title.includes("memory") || title.includes("memory_update")) return true;
  if (title.includes("简报") || title.includes("briefing") || title.includes("race_briefing")) return true;
  if (title.includes("钱包") || title.includes("wallet") || title.includes("充值") || title.includes("payment")) return true;
  return [
    "记忆更新待审核",
    "长期记忆建议",
    "赛前简报",
    "装备检查",
    "race briefing",
    "wallet_topup_done",
    "wallet_payment_request",
    "充值提醒",
  ].some(keyword => combined.includes(keyword));
}

export function getInboxItemTab(item) {
  if (isWeeklyInboxItem(item)) return "weekly";
  if (isOtherInboxItem(item)) return "other";
  return "daily";
}

export function countInboxUnreadByTab(items) {
  const counts = { daily: 0, weekly: 0, other: 0, total: 0 };
  for (const item of items || []) {
    if (item?.read) continue;
    const tab = getInboxItemTab(item);
    counts[tab] += 1;
    counts.total += 1;
  }
  return counts;
}

export function mergeInboxRefreshRows(currentItems, refreshedItems) {
  const currentById = new Map();
  for (const item of currentItems || []) {
    if (item?.id) currentById.set(item.id, item);
  }
  return (refreshedItems || []).map(item => {
    const current = item?.id ? currentById.get(item.id) : null;
    if (!current) return item;
    return {
      ...item,
      read: item?.read === true || current.read === true,
    };
  });
}

export function firstUnreadInboxTab(unreadByTab) {
  if (unreadByTab?.daily > 0) return "daily";
  if (unreadByTab?.weekly > 0) return "weekly";
  if (unreadByTab?.other > 0) return "other";
  return "daily";
}
