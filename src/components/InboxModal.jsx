import { useEffect } from "react";
import { s } from "../styles";
import { useT } from "../i18n/LanguageContext";
import { ModalRoot } from "./ModalRoot";
import * as db from "../lib/db";

// In-app inbox of delivered coach pushes. Rows are written server-side by the
// daily-coach-dispatch Edge Function. `items` / `setItems` are lifted to
// AppShell (loaded once at startup) so this opens instantly and the unread
// badge derives from the same list — marking read updates the badge with no
// DB round-trip (that round-trip used to race the write and leave the badge
// stuck). On open we do a silent background refresh to pick up new pushes.
export function InboxModal({ items, setItems, onClose, onGoToPushSettings }) {
  const t = useT();

  useEffect(() => {
    let cancelled = false;
    db.pushInbox.listMine().then(rows => { if (!cancelled) setItems(rows); }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function fmtDate(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // All handlers update the lifted list optimistically (badge recomputes from
  // it instantly) and persist in the background, rolling back on failure.
  async function handleTap(item) {
    if (item.read) return;
    setItems(prev => prev.map(i => (i.id === item.id ? { ...i, read: true } : i)));
    try {
      await db.pushInbox.markRead(item.id);
    } catch {
      setItems(prev => prev.map(i => (i.id === item.id ? { ...i, read: false } : i)));
    }
  }

  async function handleDelete(item, e) {
    e.stopPropagation();
    const snapshot = items;
    setItems(prev => prev.filter(i => i.id !== item.id));
    try {
      await db.pushInbox.deleteOne(item.id);
    } catch {
      setItems(snapshot); // restore on failure
    }
  }

  async function handleMarkAllRead() {
    if (!items.some(i => !i.read)) return;
    const snapshot = items;
    setItems(prev => prev.map(i => ({ ...i, read: true })));
    try {
      await db.pushInbox.markAllRead();
    } catch {
      setItems(snapshot);
    }
  }

  async function handleClearAll() {
    if (!items.length) return;
    if (!window.confirm(t("inbox.clear_confirm"))) return;
    const snapshot = items;
    setItems([]);
    try {
      await db.pushInbox.clearAll();
    } catch {
      setItems(snapshot);
    }
  }

  const hasUnread = items.some(i => !i.read);

  return (
    <ModalRoot onClose={onClose}>
      <div onClick={onClose} className="ts-overlay-in" style={{
        position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
        background: "rgba(20,20,19,0.45)",
        backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 9999, padding: 16, overscrollBehavior: "contain",
      }}>
        <div onClick={e => e.stopPropagation()} className="ts-modal-in" style={{
          background: "var(--bg-elevated)", border: "1px solid var(--rule)",
          borderRadius: 4, boxShadow: "0 18px 50px rgba(0,0,0,0.25)",
          // Was full-height; trimmed ~1/3 so it reads as a card, not a page.
          width: "100%", maxWidth: 420, maxHeight: "min(560px, 66dvh)",
          display: "flex", flexDirection: "column",
          padding: "22px 24px 20px", boxSizing: "border-box",
          fontFamily: "var(--font-sans)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
            <h2 style={{ fontSize: 19, fontWeight: 500, margin: 0 }}>{t("inbox.title")}</h2>
            <button onClick={onClose} style={s.modalCloseBtn} aria-label="Close">×</button>
          </div>

          {/* Bulk actions — only when there's something to act on. */}
          {items.length > 0 && (
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <button onClick={handleMarkAllRead} disabled={!hasUnread}
                style={{ ...s.btnGhost, fontSize: 12, padding: "5px 10px", opacity: hasUnread ? 1 : 0.45 }}>
                {t("inbox.mark_all_read")}
              </button>
              <button onClick={handleClearAll}
                style={{ ...s.btnGhost, fontSize: 12, padding: "5px 10px", color: "var(--danger)", borderColor: "var(--danger)" }}>
                {t("inbox.clear_all")}
              </button>
            </div>
          )}

          <div style={{ overflowY: "auto", flex: 1, margin: "0 -4px", padding: "0 4px" }}>
            {items.length === 0 ? (
              <div style={{ ...s.muted, fontSize: 13, padding: "24px 4px", lineHeight: 1.6 }}>
                {t("inbox.empty")}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {items.map(item => (
                  <div key={item.id} onClick={() => handleTap(item)} style={{
                    display: "flex", alignItems: "flex-start", gap: 10,
                    padding: "12px 2px",
                    borderBottom: "1px solid var(--rule-soft)",
                    cursor: item.read ? "default" : "pointer",
                  }}>
                    {/* Unread dot — reserves width even when read, so text aligns. */}
                    <span style={{
                      width: 7, height: 7, borderRadius: "50%", marginTop: 7, flexShrink: 0,
                      background: item.read ? "transparent" : "var(--moss)",
                    }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 14, lineHeight: 1.5,
                        color: "var(--ink-1)",
                        fontWeight: item.read ? 400 : 500,
                      }}>
                        {item.body}
                      </div>
                      <div style={{
                        fontFamily: "var(--font-mono)", fontSize: 11,
                        color: "var(--ink-3)", marginTop: 4,
                      }}>
                        {fmtDate(item.createdAt)}
                      </div>
                    </div>
                    <button onClick={(e) => handleDelete(item, e)} aria-label={t("inbox.delete")}
                      style={{
                        border: "none", background: "none", color: "var(--ink-3)",
                        cursor: "pointer", fontSize: 16, padding: "0 4px", lineHeight: 1, flexShrink: 0,
                      }}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Shortcut to the daily-push setting — on mobile this jumps to the
              Settings tab and flashes the cell so the user learns where it is. */}
          {onGoToPushSettings && (
            <button onClick={onGoToPushSettings}
              style={{
                ...s.btnGhost, marginTop: 14, width: "100%",
                fontSize: 12, padding: "8px 12px",
              }}>
              {t("inbox.go_push_settings")}
            </button>
          )}
        </div>
      </div>
    </ModalRoot>
  );
}
