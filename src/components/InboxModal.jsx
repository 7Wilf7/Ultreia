import { useEffect, useRef, useCallback, useMemo } from "react";
import { s } from "../styles";
import { useT } from "../i18n/LanguageContext";
import { ModalRoot } from "./ModalRoot";
import * as db from "../lib/db";
import { useAppDialog } from "./AppDialogContext";
import { weekWindow } from "../utils/weeklyReport";

function isWeeklyInboxItem(item) {
  const text = `${item?.title || ""} ${item?.body || ""}`.toLowerCase();
  return text.includes("周复盘") || text.includes("weekly report") || text.includes("weekly recap");
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
// page is immediate. Daily push messages retain the existing read semantics:
// a message marks read only after it is fully visible in the scroll area.
export function InboxModal({
  items,
  setItems,
  onClose,
  onOpenPushSettings,
  reports,
  now,
  onOpenWeeklyReport,
  onOpenWeeklyReportSettings,
  onClearWeeklyReports,
  activeTab = "daily",
  onTabChange,
}) {
  const t = useT();
  const appDialog = useAppDialog();
  const tab = activeTab === "weekly" ? "weekly" : "daily";
  const scrollRef = useRef(null);
  const ioRef = useRef(null);
  const rowEls = useRef(new Map());
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);

  useEffect(() => {
    let cancelled = false;
    db.pushInbox.listMine().then(rows => { if (!cancelled) setItems(rows); }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dailyItems = useMemo(
    () => (items || []).filter(item => !isWeeklyInboxItem(item)),
    [items],
  );
  const weeklyItems = useMemo(
    () => (items || []).filter(isWeeklyInboxItem),
    [items],
  );
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
    if (!root || tab !== "daily") return undefined;
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

  const actionBar = tab === "daily" ? (
    <>
      <button
        onClick={handleClearDaily}
        disabled={!dailyItems.length}
        style={{ ...styles.bottomButton, color: "var(--danger)", borderColor: dailyItems.length ? "var(--danger)" : "var(--rule)", opacity: dailyItems.length ? 1 : 0.45 }}
      >
        {t("inbox.clear_all")}
      </button>
      <button onClick={onOpenPushSettings} style={{ ...styles.bottomButton, flex: 1 }}>
        {t("inbox.go_push_settings")}
      </button>
    </>
  ) : (
    <>
      <button
        onClick={handleClearWeekly}
        disabled={!hasWeeklyContent}
        style={{ ...styles.bottomButton, color: "var(--danger)", borderColor: hasWeeklyContent ? "var(--danger)" : "var(--rule)", opacity: hasWeeklyContent ? 1 : 0.45 }}
      >
        {t("inbox.clear_all")}
      </button>
      <button onClick={onOpenWeeklyReportSettings} style={{ ...styles.bottomButton, flex: 1 }}>
        {t("inbox.weekly_settings")}
      </button>
    </>
  );

  return (
    <ModalRoot onClose={onClose}>
      <div className="ultreia-overlay-in" style={styles.page}>
        <div style={styles.header}>
          <h2 style={styles.title}>{t("inbox.title")}</h2>
          <button onClick={onClose} style={{ ...s.modalCloseBtn, marginTop: 0 }} aria-label="Close">×</button>
        </div>

        <div style={styles.tabs}>
          <button onClick={() => onTabChange?.("daily")} style={tabButtonStyle(tab === "daily")}>
            {t("inbox.tab_daily")}
          </button>
          <button onClick={() => onTabChange?.("weekly")} style={tabButtonStyle(tab === "weekly")}>
            {t("inbox.tab_weekly")}
          </button>
        </div>

        <div ref={scrollRef} style={styles.body}>
          {tab === "daily" ? (
            dailyItems.length === 0 ? (
              <div style={styles.empty}>{t("inbox.daily_empty")}</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {dailyItems.map(item => (
                  <div
                    key={item.id}
                    ref={el => registerRow(el, item.id)}
                    onClick={() => markReadById(item.id)}
                    style={styles.row}
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
                      onClick={(e) => handleDelete(item, e)}
                      aria-label={t("inbox.delete")}
                      style={styles.deleteButton}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )
          ) : (
            weeklyRanges.length === 0 ? (
              <div style={styles.empty}>{t("inbox.weekly_empty")}</div>
            ) : (
              <div style={styles.weekList}>
                {weeklyRanges.map(range => {
                  const active = rangesEqual(range, weekWindow(now || new Date(), -1));
                  return (
                    <button
                      key={`${range.start}:${range.end}`}
                      onClick={() => onOpenWeeklyReport?.(range)}
                      style={{
                        ...styles.weekChip,
                        borderColor: active ? "var(--accent)" : "var(--rule-soft)",
                        background: active ? "var(--accent-soft)" : "transparent",
                        color: active ? "var(--accent-dark)" : "var(--ink-1)",
                      }}
                    >
                      <span>{shortRange(range.start, range.end)}</span>
                    </button>
                  );
                })}
              </div>
            )
          )}
        </div>

        <div style={styles.actionBar}>
          {actionBar}
        </div>
      </div>
    </ModalRoot>
  );
}

function tabButtonStyle(active) {
  return {
    ...styles.tabButton,
    background: active ? "var(--accent-soft)" : "transparent",
    borderColor: active ? "var(--accent)" : "var(--rule)",
    color: active ? "var(--accent-dark)" : "var(--ink-2)",
  };
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
    gridTemplateColumns: "1fr 1fr",
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
    marginBottom: 8,
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
