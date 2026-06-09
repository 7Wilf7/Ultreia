import { useRef, useState } from "react";
import { useT } from "../i18n/LanguageContext";
import { Spinner } from "./Spinner";
import { CalendarIcon, CoachIcon, FootIcon, SettingsIcon, TrophyIcon } from "./Icons";

// Walk up from the touch target: if any ancestor is itself horizontally
// scrollable (charts, wide tables, the filter dropdown), a horizontal drag
// there belongs to that element — NOT a tab swipe. Lets us ignore those.
function inHorizontalScroller(node) {
  let el = node;
  while (el && el !== document.body) {
    if (el.scrollWidth > el.clientWidth + 4) {
      const ov = getComputedStyle(el).overflowX;
      if (ov === "auto" || ov === "scroll") return true;
    }
    el = el.parentElement;
  }
  return false;
}

/**
 * Mobile chrome — no top header, a finger-follow tab pager, fixed bottom 5-tab
 * nav. `renderTab(idx)` paints any tab by index so the pager can show the
 * current tab AND a neighbor at once while you drag; the 5th tab (idx=4) is the
 * mobile-only Settings page.
 *
 * Each tab is its OWN scroll container (so scroll position is preserved per tab).
 * Only the active pane and
 * its immediate neighbors render real content — far panes stay empty so we never
 * mount five heavy tabs at once.
 *
 * `coachBusy` — when AI Coach has any in-flight request the AI Coach tab cell
 * shows a small spinner badge.
 */
// Edge resistance when dragging past the first/last tab, snap-animation timing,
// and how far you must drag (fraction of width, capped) to commit a tab change.
const EDGE_RESIST = 0.35;
const SNAP_MS = 220;

export function MobileShell({ tab, setTab, coachBusy = false, renderTab, tabCount = 5, onRefresh = null, refreshing = false, getInnerPager = null }) {
  const t = useT();
  const mainRef = useRef(null);
  const paneRefs = useRef({});
  const setPaneRef = (idx) => (el) => { if (el) paneRefs.current[idx] = el; };
  const activePane = () => paneRefs.current[tab];

  // Horizontal pager drag offset (px) + whether a finger is actively dragging
  // (drives transition: none while following, snap transition on release).
  const [dragX, setDragX] = useState(0);
  const dragXRef = useRef(0);
  const setDragXpx = (px) => { dragXRef.current = px; setDragX(px); };
  const [dragging, setDragging] = useState(false);
  // `instant` suppresses the slide transition for a single render so a bottom-nav
  // tap teleports (no sweep through the empty panes between far tabs) and the
  // post-commit reposition doesn't double-animate.
  const [instant, setInstant] = useState(false);

  const lastTabTap = useRef({ idx: -1, at: 0 });
  function scrollActiveToTop() {
    activePane()?.scrollTo?.({ top: 0, behavior: "smooth" });
  }

  const TABS = [
    { key: "tabs.training", idx: 0, Icon: FootIcon },
    { key: "tabs.calendar", idx: 1, Icon: CalendarIcon },
    { key: "tabs.races",    idx: 2, Icon: TrophyIcon },
    { key: "tabs.ai_coach", idx: 3, Icon: CoachIcon },
    { key: "tabs.settings", idx: 4, Icon: SettingsIcon },
  ];

  // touch.current = { x, y, skip, w, mode }. mode is decided on the first
  // significant move: 'page' (horizontal → tab pager), 'scroll' (vertical → let the pane scroll), or
  // 'ignore' (started inside a horizontal scroller).
  const touch = useRef(null);

  // Jump to `next` tab. Used by drag-commit AND by bottom-nav taps. Taps pass
  // instant=true so a far jump teleports instead of sweeping blank panes.
  function go(next, { teleport = false } = {}) {
    if (next === tab || next < 0 || next >= tabCount) return;
    if (teleport) {
      setInstant(true);
      requestAnimationFrame(() => setInstant(false));
    }
    setTab(next);
  }

  function onTouchStart(e) {
    if (e.touches.length !== 1) {
      touch.current = null;
      return;
    }
    const p = e.touches[0];
    touch.current = {
      x: p.clientX, y: p.clientY,
      t: Date.now(),
      skip: inHorizontalScroller(e.target),
      w: mainRef.current?.clientWidth || 1,
      mode: null,
    };
    if (dragXRef.current) setDragXpx(0);
  }

  function onTouchMove(e) {
    if (e.touches.length !== 1) return;
    const st = touch.current;
    if (!st || st.skip) return;
    const p = e.touches[0];
    const dx = p.clientX - st.x;
    const dy = p.clientY - st.y;

    if (st.mode === null) {
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) {
        // Horizontal. If the current tab has an inner toggle (Training's
        // Activities/Charts, Races' Races/PR) that can still move in this
        // direction, leave it to that tab's own swipe handler — the top pager
        // only takes over once the inner toggle is at its edge. ('inner' = stay
        // out of the way; we don't move the outer track at all.)
        const inner = getInnerPager?.(tab);
        const dir = dx < 0 ? 1 : -1;
        const innerCanMove = inner && ((dir > 0 && inner.index < inner.count - 1) || (dir < 0 && inner.index > 0));
        st.mode = innerCanMove ? "inner" : "page";
      }
      else if (Math.abs(dy) > 6 || Math.abs(dx) > 6) st.mode = "scroll";
      else return; // too small to classify yet
      if (st.mode === "page") setDragging(true);
    }

    if (st.mode === "page") {
      const atFirst = tab <= 0, atLast = tab >= tabCount - 1;
      const d = ((atFirst && dx > 0) || (atLast && dx < 0)) ? dx * EDGE_RESIST : dx;
      setDragXpx(d);
    }
  }

  function onTouchEnd() {
    const st = touch.current;
    touch.current = null;
    if (!st) return;

    if (st.mode === "page") {
      const W = st.w || 1;
      const dx = dragXRef.current;
      const dt = Math.max(1, Date.now() - (st.t || 0));
      const velocity = dx / dt;
      const threshold = Math.min(W * 0.18, 68);
      let dir = 0;
      if ((dx <= -threshold || velocity < -0.45) && tab < tabCount - 1) dir = 1;
      else if ((dx >= threshold || velocity > 0.45) && tab > 0) dir = -1;
      setDragging(false); // re-enable the snap transition
      if (dir !== 0) {
        // Commit immediately so rapid repeated swipes can start from the new
        // tab without waiting for the old 280ms delayed setTab.
        setDragXpx(dx + (dir === 1 ? W : -W));
        setTab(tab + dir);
        requestAnimationFrame(() => setDragXpx(0));
      } else {
        setDragXpx(0); // snap back
      }
      return;
    }
    // 'scroll' / 'ignore' / unclassified — nothing to settle.
    setDragging(false);
  }

  function onTabTap(idx, e) {
    const now = e?.timeStamp ?? 0;
    const prev = lastTabTap.current;
    lastTabTap.current = { idx, at: now };
    if (idx === tab && prev.idx === idx && now - prev.at < 320) {
      if (idx === 0 && onRefresh) {
        const pane = activePane();
        if ((pane?.scrollTop || 0) > 4) {
          scrollActiveToTop();
          return;
        }
        onRefresh();
        return;
      }
      scrollActiveToTop();
      return;
    }
    go(idx, { teleport: true });
  }

  const pullY = refreshing ? 44 : 0;
  const trackTransition = (dragging || instant) ? "none" : `transform ${Math.round(SNAP_MS * 0.93)}ms cubic-bezier(0.2,0.7,0.3,1)`;

  return (
    <div style={{
      height: "100dvh",
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
      background: "var(--bg)",
    }}>
      <main
        ref={mainRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{
          flex: 1, minHeight: 0,
          overflow: "hidden",
          position: "relative",
          background: "var(--bg)",
        }}>
        {/* Refresh indicator shown while a manual sync is running. */}
        {refreshing && (
          <div style={{
            position: "absolute",
            top: "calc(max(env(safe-area-inset-top), 14px) + 8px)",
            left: 0, right: 0,
            height: 44,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            color: "var(--ink-2)", pointerEvents: "none", zIndex: 11,
            fontFamily: "var(--font-sans)", fontSize: 13,
          }}>
            <><Spinner size={16} thickness={2} color="var(--moss)" /><span>{t("sync.syncing")}</span></>
          </div>
        )}

        {/* Pager track — width = tabCount viewports; translateX moves between
            tabs (px during a drag → finger-following), translateY handles the
            manual refresh offset. Each pane is its own scroller. */}
        <div style={{
          display: "flex",
          height: "100%",
          width: `${tabCount * 100}%`,
          transform: `translateX(calc(${(-tab * 100) / tabCount}% + ${dragX}px)) translateY(${pullY}px)`,
          transition: trackTransition,
          willChange: (dragging || refreshing || instant) ? "transform" : undefined,
        }}>
          {TABS.map(({ idx }) => {
            const isAdjacent = Math.abs(idx - tab) <= 1;
            return (
              <div
                key={idx}
                ref={setPaneRef(idx)}
                style={{
                  width: `${100 / tabCount}%`,
                  height: "100%",
                  flexShrink: 0,
                  overflowY: "auto",
                  overflowX: "hidden",
                  overscrollBehavior: "contain",
                  WebkitOverflowScrolling: "touch",
                  touchAction: "pan-y",
                  background: "var(--bg)",
                  padding: "14px 14px 0",
                  paddingTop: "max(env(safe-area-inset-top), 14px)",
                  paddingBottom: "calc(76px + env(safe-area-inset-bottom))",
                }}>
                {isAdjacent ? renderTab(idx) : null}
              </div>
            );
          })}
        </div>
      </main>

      {/* ── Bottom tab bar ───────────────────────────────────────────────── */}
      <nav style={{
        position: "fixed", left: 0, right: 0, bottom: 0,
        zIndex: 20,
        background: "var(--bg-elevated)",
        borderTop: "1px solid var(--rule)",
        boxShadow: "0 -10px 28px rgba(20,20,19,0.08)",
        paddingBottom: "env(safe-area-inset-bottom)",
        display: "grid",
        gridTemplateColumns: "repeat(5, 1fr)",
        touchAction: "manipulation",
        WebkitTapHighlightColor: "transparent",
      }}>
        {TABS.map(({ key, idx, Icon }) => {
          const active = tab === idx;
          const showSpinner = idx === 3 && coachBusy;
          return (
            <button
              key={key}
              onClick={(e) => onTabTap(idx, e)}
              style={{
                background: "transparent",
                border: "none",
                marginTop: 0,
                padding: "8px 4px 10px",
                minHeight: 64,
                fontFamily: "var(--font-sans)",
                fontSize: 12,
                fontWeight: active ? 600 : 500,
                color: active ? "var(--ink-1)" : "var(--ink-3)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 5,
                borderRadius: 0,
                cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
                touchAction: "manipulation",
                minWidth: 0,
              }}
            >
              <span style={{
                position: "relative",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 38,
                height: 28,
                borderRadius: 999,
                background: active ? "var(--moss-bg)" : "transparent",
                border: active ? "1px solid rgba(74,92,55,0.28)" : "1px solid transparent",
                color: active ? "var(--ink-1)" : "var(--ink-3)",
                transform: active ? "translateY(-1px)" : "none",
                transition: "background-color 160ms cubic-bezier(0.2,0.7,0.3,1), border-color 160ms cubic-bezier(0.2,0.7,0.3,1), transform 160ms cubic-bezier(0.2,0.7,0.3,1)",
              }}>
                <Icon size={20} />
                {showSpinner && (
                  <span style={{
                    position: "absolute",
                    right: -10,
                    top: -6,
                    color: "var(--moss)",
                    background: "var(--bg-elevated)",
                    borderRadius: 8,
                    lineHeight: 0,
                  }}>
                    <Spinner size={11} thickness={1.4} color="var(--moss)" />
                  </span>
                )}
              </span>
              <span style={{
                maxWidth: "100%",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}>{t(key)}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
