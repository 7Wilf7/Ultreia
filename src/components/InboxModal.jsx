import { useEffect, useRef, useCallback, useMemo, useState } from "react";
import { s } from "../styles";
import { useT } from "../i18n/LanguageContext";
import { ModalRoot } from "./ModalRoot";
import * as db from "../lib/db";
import { useAppDialog } from "./AppDialogContext";
import { weekWindow } from "../utils/weeklyReport";
import { isMemoryUpdateAction, isRaceBriefingAction } from "../utils/agentActions";
import { useInstantPress, useInstantTap } from "../hooks/useInstantPress";

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

function shortRange(start, end) {
  const fmt = (value) => {
    const d = new Date(`${value}T00:00:00`);
    if (Number.isNaN(d.getTime())) return value || "";
    return `${d.getMonth() + 1}.${d.getDate()}`;
  };
  return `${fmt(start)}-${fmt(end)}`;
}

function rangesEqual(a, b) {
  return !!a && !!b && a.start === b.start && a.end === b.end;
}

function reportSortValue(report) {
  return String(report?.generatedAt || report?.createdAt || report?.updatedAt || "");
}

function buildWeeklyRanges(reports, now) {
  const thisWeek = weekWindow(now || new Date(), 0);
  const lastWeek = weekWindow(now || new Date(), -1);
  const byKey = new Map();
  for (const range of [thisWeek, lastWeek]) {
    byKey.set(`${range.start}:${range.end}`, {
      ...range,
      reports: [],
      latest: null,
      defaultRange: rangesEqual(range, lastWeek),
    });
  }
  for (const report of reports || []) {
    if (!report?.start || !report?.end) continue;
    const key = `${report.start}:${report.end}`;
    const current = byKey.get(key) || {
      start: report.start,
      end: report.end,
      nextStart: report.nextStart,
      nextEnd: report.nextEnd,
      reports: [],
      latest: null,
      defaultRange: false,
    };
    current.nextStart ||= report.nextStart;
    current.nextEnd ||= report.nextEnd;
    current.reports.push(report);
    if (!current.latest || reportSortValue(report) > reportSortValue(current.latest)) current.latest = report;
    byKey.set(key, current);
  }
  return [...byKey.values()].sort((a, b) => String(b.start).localeCompare(String(a.start)));
}

// Full-screen in-app inbox. Rows are written server-side by the
// daily-coach-dispatch Edge Function and are lifted to AppShell so opening this
// page is immediate. Message-list tabs retain the existing read semantics: a
// message marks read only after it is fully visible in the scroll area.
export function InboxModal({
  items,
  setItems,
  agentActions = [],
  onClose,
  onOpenPushSettings,
  reports,
  now,
  onOpenWeeklyReport,
  onOpenMemoryAction,
  onOpenRaceBriefingAction,
  onOpenWeeklyReportSettings,
  onClearWeeklyReports,
  activeTab = "daily",
  onTabChange,
  weeklyReportLoading = false,
  activeWeeklyReportRange = null,
}) {
  const t = useT();
  const appDialog = useAppDialog();
  const scrollRef = useRef(null);
  const ioRef = useRef(null);
  const rowEls = useRef(new Map());
  const itemsRef = useRef(items);
  const recentPointerTabPressRef = useRef({});
  const parentTabRef = useRef(activeTab === "weekly" || activeTab === "other" ? activeTab : "daily");
  const deferredParentTabFrameRef = useRef(0);
  const deferredParentTabRef = useRef(null);
  const instantPress = useInstantPress();
  const instantTap = useInstantTap();
  const externalTab = activeTab === "weekly" || activeTab === "other" ? activeTab : "daily";
  const [localTab, setLocalTab] = useState(externalTab);
  const tab = localTab;
  useEffect(() => { itemsRef.current = items; }, [items]);

  const cancelDeferredParentTabChange = useCallback(() => {
    if (deferredParentTabFrameRef.current) {
      cancelAnimationFrame(deferredParentTabFrameRef.current);
      deferredParentTabFrameRef.current = 0;
    }
    deferredParentTabRef.current = null;
  }, []);

  const scheduleParentTabChange = useCallback((next) => {
    cancelDeferredParentTabChange();
    if (next === parentTabRef.current) return;
    deferredParentTabRef.current = next;
    // Keep the full-screen inbox tab switch visible before AppShell rerenders.
    deferredParentTabFrameRef.current = requestAnimationFrame(() => {
      deferredParentTabFrameRef.current = 0;
      const pending = deferredParentTabRef.current;
      deferredParentTabRef.current = null;
      if (pending == null || pending === parentTabRef.current) return;
      parentTabRef.current = pending;
      onTabChange?.(pending);
    });
  }, [cancelDeferredParentTabChange, onTabChange]);

  useEffect(() => {
    let cancelled = false;
    const pendingParentTab = deferredParentTabRef.current;
    if (pendingParentTab != null && externalTab !== pendingParentTab) {
      cancelDeferredParentTabChange();
    }
    parentTabRef.current = externalTab;
    queueMicrotask(() => {
      if (!cancelled) setLocalTab(externalTab);
    });
    return () => { cancelled = true; };
  }, [cancelDeferredParentTabChange, externalTab]);

  useEffect(() => () => {
    cancelDeferredParentTabChange();
  }, [cancelDeferredParentTabChange]);

  const selectTab = useCallback((next) => {
    setLocalTab(next);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    scheduleParentTabChange(next);
  }, [scheduleParentTabChange]);

  const pressTab = useCallback((next, event) => {
    if (event?.pointerType === "mouse") return;
    const at = event?.timeStamp || 0;
    recentPointerTabPressRef.current[next] = at;
    event?.preventDefault?.();
    selectTab(next);
  }, [selectTab]);

  const clickTab = useCallback((next, event) => {
    const at = event?.timeStamp || 0;
    const recentAt = recentPointerTabPressRef.current[next] || 0;
    if (at - recentAt < 750) {
      event?.preventDefault?.();
      return;
    }
    selectTab(next);
  }, [selectTab]);

  useEffect(() => {
    let cancelled = false;
    db.pushInbox.listMine().then(rows => { if (!cancelled) setItems(rows); }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dailyItems = useMemo(
    () => (items || []).filter(item => !isWeeklyInboxItem(item) && !isOtherInboxItem(item)),
    [items],
  );
  const weeklyItems = useMemo(
    () => (items || []).filter(isWeeklyInboxItem),
    [items],
  );
  const otherItems = useMemo(
    () => (items || []).filter(item => !isWeeklyInboxItem(item) && isOtherInboxItem(item)),
    [items],
  );
  const otherAgentActions = useMemo(
    () => (agentActions || [])
      .filter(action => isMemoryUpdateAction(action) || isRaceBriefingAction(action))
      .filter(action => action?.status !== "rejected" && action?.status !== "cancelled")
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
      .slice(0, 20),
    [agentActions],
  );
  const otherEntries = useMemo(() => [
    ...otherAgentActions.map(action => ({ kind: "agent", action, sortAt: action.createdAt || "" })),
    ...otherItems.map(item => ({ kind: "inbox", item, sortAt: item.createdAt || "" })),
  ].sort((a, b) => String(b.sortAt || "").localeCompare(String(a.sortAt || ""))), [otherAgentActions, otherItems]);
  const weeklyRanges = useMemo(
    () => buildWeeklyRanges(reports || [], now),
    [reports, now],
  );
  const hasWeeklyReports = weeklyRanges.some(range => range.latest);
  const hasWeeklyContent = hasWeeklyReports || weeklyItems.length > 0;

  function markReadById(id) {
    const it = itemsRef.current.find(i => i.id === id);
    if (!it || it.read) return;
    setItems(prev => prev.map(i => (i.id === id ? { ...i, read: true } : i)));
    db.pushInbox.markRead(id).catch(() => {
      setItems(prev => prev.map(i => (i.id === id ? { ...i, read: false } : i)));
    });
  }

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || (tab !== "daily" && tab !== "other")) return undefined;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting && e.intersectionRatio >= 0.99) {
          markReadById(e.target.dataset.inboxId);
        }
      }
    }, { root, threshold: 0.99 });
    ioRef.current = io;
    for (const el of rowEls.current.values()) io.observe(el);
    return () => { io.disconnect(); ioRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const registerRow = useCallback((el, id) => {
    const map = rowEls.current;
    if (el) {
      el.dataset.inboxId = id;
      map.set(id, el);
      ioRef.current?.observe(el);
    } else {
      const prev = map.get(id);
      if (prev) { ioRef.current?.unobserve(prev); map.delete(id); }
    }
  }, []);

  function fmtDate(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  async function handleDelete(item, e) {
    e.stopPropagation();
    const snapshot = items;
    setItems(prev => prev.filter(i => i.id !== item.id));
    try {
      await db.pushInbox.deleteOne(item.id);
    } catch {
      setItems(snapshot);
    }
  }

  async function handleClearDaily() {
    if (!dailyItems.length) return;
    if (!await appDialog.confirm(t("inbox.clear_confirm"), { danger: true, confirmLabel: t("common.delete") })) return;
    const snapshot = items;
    const dailyIds = new Set(dailyItems.map(item => item.id));
    setItems(prev => prev.filter(item => !dailyIds.has(item.id)));
    try {
      await Promise.all(dailyItems.map(item => db.pushInbox.deleteOne(item.id)));
    } catch {
      setItems(snapshot);
    }
  }

  async function handleClearWeekly() {
    if (!hasWeeklyContent) return;
    if (!await appDialog.confirm(t("inbox.clear_weekly_confirm"), { danger: true, confirmLabel: t("common.delete") })) return;
    const snapshot = items;
    const weeklyIds = new Set(weeklyItems.map(item => item.id));
    if (weeklyIds.size) setItems(prev => prev.filter(item => !weeklyIds.has(item.id)));
    const reportsCleared = await onClearWeeklyReports?.();
    if (reportsCleared === false) {
      setItems(snapshot);
      return;
    }
    try {
      await Promise.all(weeklyItems.map(item => db.pushInbox.deleteOne(item.id)));
    } catch {
      setItems(snapshot);
    }
  }

  async function handleClearOther() {
    if (!otherItems.length) return;
    if (!await appDialog.confirm(t("inbox.clear_other_confirm"), { danger: true, confirmLabel: t("common.delete") })) return;
    const snapshot = items;
    const otherIds = new Set(otherItems.map(item => item.id));
    setItems(prev => prev.filter(item => !otherIds.has(item.id)));
    try {
      await Promise.all(otherItems.map(item => db.pushInbox.deleteOne(item.id)));
    } catch {
      setItems(snapshot);
    }
  }

  const renderMessageRows = (list, emptyLabel) => (
    list.length === 0 ? (
      <div style={styles.empty}>{emptyLabel}</div>
    ) : (
      <div style={{ display: "flex", flexDirection: "column" }}>
        {list.map(item => (
          <InboxMessageRow
            key={item.id}
            item={item}
            t={t}
            registerRow={registerRow}
            markReadById={markReadById}
            onDelete={handleDelete}
            fmtDate={fmtDate}
            tapKeyPrefix="inbox-message-row"
          />
        ))}
      </div>
    )
  );

  const renderOtherRows = () => (
    otherEntries.length === 0 ? (
      <div style={styles.empty}>{t("inbox.other_empty")}</div>
    ) : (
      <div style={{ display: "flex", flexDirection: "column" }}>
        {otherEntries.map(entry => (
          entry.kind === "agent" ? (
            <AgentActionInboxRow
              key={`agent-${entry.action.id || entry.action.rowId || entry.action.createdAt}`}
              action={entry.action}
              t={t}
              onOpen={() => {
                if (isMemoryUpdateAction(entry.action)) onOpenMemoryAction?.(entry.action);
                else if (isRaceBriefingAction(entry.action)) onOpenRaceBriefingAction?.(entry.action);
              }}
            />
          ) : (
            <InboxMessageRow
              key={entry.item.id}
              item={entry.item}
              t={t}
              registerRow={registerRow}
              markReadById={markReadById}
              onDelete={handleDelete}
              fmtDate={fmtDate}
              tapKeyPrefix="inbox-other-row"
            />
          )
        ))}
      </div>
    )
  );

  const actionBar = tab === "daily" ? (
    <>
      <button
        {...instantPress("inbox-clear-daily", handleClearDaily)}
        disabled={!dailyItems.length}
        style={{ ...styles.bottomButton, color: "var(--danger)", borderColor: dailyItems.length ? "var(--danger)" : "var(--rule)", opacity: dailyItems.length ? 1 : 0.45 }}
      >
        {t("inbox.clear_all")}
      </button>
      <button {...instantPress("inbox-push-settings", onOpenPushSettings)} style={{ ...styles.bottomButton, flex: 1 }}>
        {t("inbox.go_push_settings")}
      </button>
    </>
  ) : tab === "weekly" ? (
    <>
      <button
        {...instantPress("inbox-clear-weekly", handleClearWeekly)}
        disabled={!hasWeeklyContent}
        style={{ ...styles.bottomButton, color: "var(--danger)", borderColor: hasWeeklyContent ? "var(--danger)" : "var(--rule)", opacity: hasWeeklyContent ? 1 : 0.45 }}
      >
        {t("inbox.clear_all")}
      </button>
      <button {...instantPress("inbox-weekly-settings", onOpenWeeklyReportSettings)} style={{ ...styles.bottomButton, flex: 1 }}>
        {t("inbox.weekly_settings")}
      </button>
    </>
  ) : (
    <button
      {...instantPress("inbox-clear-other", handleClearOther)}
      disabled={!otherItems.length}
      style={{ ...styles.bottomButton, flex: 1, color: "var(--danger)", borderColor: otherItems.length ? "var(--danger)" : "var(--rule)", opacity: otherItems.length ? 1 : 0.45 }}
    >
      {t("inbox.clear_all")}
    </button>
  );

  return (
    <ModalRoot onClose={onClose}>
      <div className="ultreia-overlay-in" style={styles.page}>
        <div style={styles.header}>
          <h2 style={styles.title}>{t("inbox.title")}</h2>
          <button {...instantPress("inbox-close", onClose)} style={{ ...s.modalCloseBtn, marginTop: 0 }} aria-label="Close">×</button>
        </div>

        <div style={styles.tabs}>
          <button onPointerDown={(event) => pressTab("daily", event)} onClick={(event) => clickTab("daily", event)} style={tabButtonStyle(tab === "daily")}>
            {t("inbox.tab_daily")}
          </button>
          <button onPointerDown={(event) => pressTab("weekly", event)} onClick={(event) => clickTab("weekly", event)} style={tabButtonStyle(tab === "weekly", weeklyReportLoading)}>
            {t("inbox.tab_weekly")}
            {weeklyReportLoading && (
              <span className="ultreia-spinner" style={{ width: 10, height: 10, borderWidth: 1.5, marginLeft: 6 }} />
            )}
          </button>
          <button onPointerDown={(event) => pressTab("other", event)} onClick={(event) => clickTab("other", event)} style={tabButtonStyle(tab === "other")}>
            {t("inbox.tab_other")}
          </button>
        </div>

        <div ref={scrollRef} style={styles.body}>
          {tab === "daily" ? (
            renderMessageRows(dailyItems, t("inbox.daily_empty"))
          ) : tab === "weekly" ? (
            weeklyRanges.length === 0 ? (
              <div style={styles.empty}>{t("inbox.weekly_empty")}</div>
            ) : (
              <div style={styles.weekList}>
                {weeklyRanges.map(range => {
                  const active = rangesEqual(range, weekWindow(now || new Date(), -1));
                  const running = weeklyReportLoading && (!activeWeeklyReportRange || rangesEqual(range, activeWeeklyReportRange));
                  return (
                    <button
                      key={`${range.start}:${range.end}`}
                      {...instantTap(`weekly-range-${range.start}:${range.end}`, () => onOpenWeeklyReport?.(range))}
                      style={{
                        ...styles.weekChip,
                        borderColor: running || active ? "var(--accent)" : "var(--rule-soft)",
                        background: running || active ? "var(--accent-soft)" : "transparent",
                        color: running || active ? "var(--accent-dark)" : "var(--ink-1)",
                        boxShadow: running ? "0 0 0 1px oklch(0.54 0.055 138 / 0.12), 0 0 18px oklch(0.38 0.060 138 / 0.16)" : "none",
                      }}
                    >
                      <span>{shortRange(range.start, range.end)}</span>
                      {running && (
                        <span style={styles.weekRunning}>
                          <span className="ultreia-spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} />
                          {t("weekly_report.generating")}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )
          ) : (
            renderOtherRows()
          )}
        </div>

        <div style={styles.actionBar}>
          {actionBar}
        </div>
      </div>
    </ModalRoot>
  );
}

function tabButtonStyle(active, busy = false) {
  return {
    ...styles.tabButton,
    background: active || busy ? "var(--accent-soft)" : "transparent",
    borderColor: active || busy ? "var(--accent)" : "var(--rule)",
    color: active || busy ? "var(--accent-dark)" : "var(--ink-2)",
  };
}

function InboxMessageRow({ item, t, registerRow, markReadById, onDelete, fmtDate, tapKeyPrefix }) {
  const instantTap = useInstantTap();
  return (
    <div
      ref={el => registerRow(el, item.id)}
      {...instantTap(`${tapKeyPrefix}-${item.id}`, () => markReadById(item.id))}
      style={{ ...styles.row, touchAction: "pan-y", WebkitTapHighlightColor: "transparent" }}
    >
      <span style={{
        width: 7,
        height: 7,
        borderRadius: "50%",
        marginTop: 7,
        flexShrink: 0,
        background: item.read ? "transparent" : "var(--moss)",
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        {item.title && (
          <div style={styles.rowTitle}>{item.title}</div>
        )}
        <div style={{
          ...styles.rowBody,
          fontWeight: item.read ? 400 : 500,
        }}>
          {item.body}
        </div>
        <div style={styles.rowDate}>{fmtDate(item.createdAt)}</div>
      </div>
      <button
        onClick={(e) => onDelete(item, e)}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label={t("inbox.delete")}
        style={styles.deleteButton}
      >
        ×
      </button>
    </div>
  );
}

function AgentActionInboxRow({ action, t, onOpen }) {
  const instantTap = useInstantTap();
  const summary = summarizeOtherAgentAction(action, t);
  return (
    <button
      type="button"
      {...instantTap(`agent-row-${action?.id || action?.rowId || action?.createdAt}`, onOpen)}
      style={{
        ...styles.row,
        width: "100%",
        background: "transparent",
        borderTop: "none",
        borderLeft: "none",
        borderRight: "none",
        textAlign: "left",
        fontFamily: "var(--font-sans)",
        touchAction: "manipulation",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <span style={{
        width: 7,
        height: 7,
        borderRadius: "50%",
        marginTop: 7,
        flexShrink: 0,
        background: "var(--accent)",
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={styles.rowTitle}>{summary.title}</div>
        <div style={{ ...styles.rowBody, fontWeight: 500 }}>{summary.body}</div>
        <div style={styles.rowDate}>{summary.meta}</div>
      </div>
      <span style={{ color: "var(--ink-3)", fontSize: 16, lineHeight: 1, paddingTop: 3 }}>&gt;</span>
    </button>
  );
}

function summarizeOtherAgentAction(action, t) {
  const status = t(`coach.agent_action_status_${action?.status || "proposed"}`);
  const when = fmtActionDate(action?.createdAt);
  if (isMemoryUpdateAction(action)) {
    const memory = action?.payload?.memory || {};
    const text = String(memory.zh || memory.en || "").trim();
    return {
      title: t("coach.agent_action_type_memory_update"),
      body: text ? text.split(/\n+/).filter(Boolean).slice(0, 2).join(" / ") : t("coach.memory_ready_banner"),
      meta: [status, when].filter(Boolean).join(" · "),
    };
  }
  const race = action?.payload?.raceBriefing || {};
  return {
    title: t("coach.agent_action_type_race_briefing"),
    body: [race.date, race.name].filter(Boolean).join(" · ") || t("coach.race_briefing_target"),
    meta: [status, when].filter(Boolean).join(" · "),
  };
}

function fmtActionDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const styles = {
  page: {
    position: "fixed",
    inset: 0,
    zIndex: 9000,
    background: "var(--bg)",
    color: "var(--ink-1)",
    fontFamily: "var(--font-sans)",
    display: "flex",
    flexDirection: "column",
    overscrollBehavior: "none",
  },
  header: {
    padding: "calc(max(env(safe-area-inset-top), 14px) + 4px) 18px 10px",
    borderBottom: "1px solid var(--rule)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexShrink: 0,
  },
  title: {
    fontSize: 22,
    fontWeight: 750,
    margin: 0,
    lineHeight: 1.15,
  },
  tabs: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: 8,
    padding: "10px 18px",
    borderBottom: "1px solid var(--rule-soft)",
    flexShrink: 0,
  },
  tabButton: {
    minHeight: 0,
    padding: "9px 6px",
    border: "1px solid var(--rule)",
    borderRadius: 8,
    fontFamily: "var(--font-sans)",
    fontSize: 13,
    fontWeight: 650,
    cursor: "pointer",
    touchAction: "manipulation",
    WebkitTapHighlightColor: "transparent",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  },
  body: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    WebkitOverflowScrolling: "touch",
    overscrollBehaviorY: "contain",
    padding: "4px 18px 86px",
  },
  empty: {
    ...s.muted,
    fontSize: 13,
    padding: "28px 2px",
    lineHeight: 1.6,
  },
  row: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "13px 0",
    borderBottom: "1px solid var(--rule-soft)",
    cursor: "pointer",
  },
  rowTitle: {
    fontSize: 12,
    lineHeight: 1.3,
    marginBottom: 4,
    color: "var(--ink-2)",
    fontWeight: 600,
  },
  rowBody: {
    fontSize: 14,
    lineHeight: 1.5,
    color: "var(--ink-1)",
  },
  rowDate: {
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    color: "var(--ink-3)",
    marginTop: 4,
  },
  deleteButton: {
    border: "none",
    background: "none",
    color: "var(--ink-3)",
    cursor: "pointer",
    fontSize: 18,
    padding: "0 4px",
    lineHeight: 1,
    flexShrink: 0,
  },
  weekList: {
    display: "flex",
    flexDirection: "column",
    paddingTop: 10,
  },
  weekChip: {
    width: "100%",
    minHeight: 0,
    padding: "14px 12px",
    border: "1px solid var(--rule)",
    borderRadius: 6,
    fontFamily: "var(--font-mono)",
    fontSize: 15,
    fontWeight: 650,
    fontVariantNumeric: "tabular-nums",
    textAlign: "left",
    cursor: "pointer",
    touchAction: "manipulation",
    WebkitTapHighlightColor: "transparent",
    marginBottom: 8,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  weekRunning: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontFamily: "var(--font-sans)",
    fontSize: 12,
    fontWeight: 650,
    color: "var(--accent-dark)",
    whiteSpace: "nowrap",
  },
  actionBar: {
    position: "fixed",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 2,
    display: "flex",
    gap: 8,
    padding: "10px 18px calc(env(safe-area-inset-bottom) + 10px)",
    background: "var(--bg)",
    borderTop: "1px solid var(--rule)",
  },
  bottomButton: {
    ...s.btnGhost,
    minHeight: 0,
    padding: "10px 12px",
    fontSize: 12,
    whiteSpace: "nowrap",
  },
};
