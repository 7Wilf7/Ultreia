import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useT } from "../i18n/LanguageContext";
import { Spinner } from "./Spinner";
import { CalendarIcon, CoachIcon, FootIcon, SettingsIcon, TrophyIcon } from "./Icons";
import { getMobilePagerRenderWindow } from "../utils/mobilePager";

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
 * Each tab is its OWN scroll container. Only the active pane and its immediate
 * neighbors render heavy content; keeping every tab mounted made later swipes
 * re-render Training + Calendar + Coach + Races + Settings together and caused
 * dropped frames on Android/PWA.
 *
 * `coachBusy` — when AI Coach has any in-flight request the AI Coach tab cell
 * shows a small spinner badge.
 */
// Edge resistance when dragging past the first/last tab, snap-animation timing,
// and how far you must drag (fraction of width, capped) to commit a tab change.
const EDGE_RESIST = 0.35;
const SNAP_MS = 320;
const TRACK_SNAP_TRANSITION = `transform ${SNAP_MS}ms cubic-bezier(0.2,0.82,0.18,1)`;
const TAB_HAPTIC_MS = 8;

function triggerTabHaptic() {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(TAB_HAPTIC_MS);
    }
  } catch { /* haptics are best-effort */ }
}

function sameTabWindow(a, b) {
  return Array.isArray(a) && Array.isArray(b)
    && a.length === b.length
    && a.every((value, idx) => value === b[idx]);
}

function readTranslateX(transform) {
  if (!transform || transform === "none") return null;
  const matrix3d = transform.match(/^matrix3d\((.+)\)$/);
  if (matrix3d) {
    const values = matrix3d[1].split(",").map(v => Number.parseFloat(v.trim()));
    return Number.isFinite(values[12]) ? values[12] : null;
  }
  const matrix2d = transform.match(/^matrix\((.+)\)$/);
  if (matrix2d) {
    const values = matrix2d[1].split(",").map(v => Number.parseFloat(v.trim()));
    return Number.isFinite(values[4]) ? values[4] : null;
  }
  return null;
}

export function MobileShell({ tab, setTab, coachBusy = false, renderTab, tabCount = 5, onRefresh = null, refreshing = false, getInnerPager = null }) {
  const t = useT();
  const mainRef = useRef(null);
  const trackRef = useRef(null);
  const paneRefs = useRef({});
  const setPaneRef = (idx) => (el) => { if (el) paneRefs.current[idx] = el; };
  const [visualTab, setVisualTab] = useState(tab);
  const visualTabRef = useRef(tab);
  const [renderedTabs, setRenderedTabs] = useState(() => getMobilePagerRenderWindow(tab, tabCount));
  const renderedTabsRef = useRef(renderedTabs);
  const renderedTabSet = new Set(renderedTabs);
  const activePane = () => paneRefs.current[visualTabRef.current];

  // Horizontal pager drag offset. During finger-following this writes pane
  // transforms directly instead of setState or inherited CSS vars on every
  // touchmove; rendering/style-recalc in the drag loop is what made PWA swipes
  // feel dropped.
  const dragXRef = useRef(0);
  const dragFrameRef = useRef(0);
  const pendingDragXRef = useRef(0);
  const applyPaneTransforms = useCallback((px) => {
    const current = visualTabRef.current;
    const width = mainRef.current?.clientWidth || window.innerWidth || 1;
    for (const [idx, pane] of Object.entries(paneRefs.current)) {
      if (!pane) continue;
      const offset = Number(idx) - current;
      if (!Number.isFinite(offset)) continue;
      if (Math.abs(offset) > 1) continue;
      pane.style.transform = `translate3d(${(offset * width) + px}px, 0, 0)`;
    }
  }, []);
  const setDragXpx = useCallback((px, immediate = false) => {
    dragXRef.current = px;
    pendingDragXRef.current = px;
    const apply = () => {
      dragFrameRef.current = 0;
      applyPaneTransforms(pendingDragXRef.current);
    };
    if (immediate) {
      if (dragFrameRef.current) cancelAnimationFrame(dragFrameRef.current);
      apply();
      return;
    }
    if (!dragFrameRef.current) dragFrameRef.current = requestAnimationFrame(apply);
  }, [applyPaneTransforms]);
  // `instant` suppresses the slide transition for a single render so a bottom-nav
  // tap teleports (no sweep through the empty panes between far tabs) and the
  // post-commit reposition doesn't double-animate.
  const [instant, setInstant] = useState(false);
  const [tapWindow, setTapWindow] = useState(null);
  const tapWindowTimer = useRef(null);
  const snapTimerRef = useRef(null);
  const trackHintTimerRef = useRef(null);
  const lastHapticAt = useRef(0);

  function clearTrackHintTimer() {
    if (trackHintTimerRef.current) {
      clearTimeout(trackHintTimerRef.current);
      trackHintTimerRef.current = null;
    }
  }

  function setTrackDragging(active) {
    const el = trackRef.current;
    if (!el) return;
    if (active) {
      clearTrackHintTimer();
      delete el.dataset.settling;
      el.dataset.dragging = "true";
      return;
    }
    delete el.dataset.dragging;
  }

  function setTrackSettling(active) {
    const el = trackRef.current;
    if (!el) return;
    if (active) {
      clearTrackHintTimer();
      delete el.dataset.dragging;
      el.dataset.settling = "true";
      return;
    }
    delete el.dataset.settling;
  }

  function clearTrackMotionHintSoon(delay = SNAP_MS + 80) {
    clearTrackHintTimer();
    trackHintTimerRef.current = setTimeout(() => {
      trackHintTimerRef.current = null;
      const el = trackRef.current;
      if (!el) return;
      delete el.dataset.dragging;
      delete el.dataset.settling;
    }, delay);
  }

  function currentTrackDragX() {
    const el = paneRefs.current[visualTabRef.current] || trackRef.current;
    const tx = readTranslateX(el ? getComputedStyle(el).transform : "");
    if (!Number.isFinite(tx)) return dragXRef.current || 0;
    return tx;
  }

  useEffect(() => () => {
    if (tapWindowTimer.current) clearTimeout(tapWindowTimer.current);
    if (snapTimerRef.current) clearTimeout(snapTimerRef.current);
    if (trackHintTimerRef.current) clearTimeout(trackHintTimerRef.current);
    if (dragFrameRef.current) cancelAnimationFrame(dragFrameRef.current);
  }, []);

  const lastTabTap = useRef({ idx: -1, at: 0 });
  const pointerDownRef = useRef({ idx: -1, at: 0, switched: false });
  function scrollActiveToTop() {
    activePane()?.scrollTo?.({ top: 0, behavior: "smooth" });
  }

  const commitVisualTab = useCallback((next, { urgent = false } = {}) => {
    const nextRenderedTabs = getMobilePagerRenderWindow(next, tabCount);
    const renderedChanged = !sameTabWindow(nextRenderedTabs, renderedTabsRef.current);
    renderedTabsRef.current = nextRenderedTabs;
    visualTabRef.current = next;

    if (urgent) {
      flushSync(() => {
        if (renderedChanged) setRenderedTabs(nextRenderedTabs);
        setVisualTab(next);
      });
      return;
    }

    if (renderedChanged) setRenderedTabs(nextRenderedTabs);
    setVisualTab(next);
  }, [tabCount]);

  useEffect(() => {
    if (tab === visualTabRef.current) return;
    commitVisualTab(tab);
    setDragXpx(0, true);
    const el = trackRef.current;
    if (el) delete el.dataset.dragging;
    setInstant(true);
    requestAnimationFrame(() => setInstant(false));
  }, [tab, commitVisualTab, setDragXpx]);

  const TABS = [
    { key: "tabs.training", idx: 0, Icon: FootIcon },
    { key: "tabs.calendar", idx: 1, Icon: CalendarIcon },
    { key: "tabs.ai_coach", idx: 2, Icon: CoachIcon },
    { key: "tabs.races",    idx: 3, Icon: TrophyIcon },
    { key: "tabs.settings", idx: 4, Icon: SettingsIcon },
  ];

  // touch.current = { x, y, skip, w, mode }. mode is decided on the first
  // significant move: 'page' (horizontal → tab pager), 'scroll' (vertical → let the pane scroll), or
  // 'ignore' (started inside a horizontal scroller).
  const touch = useRef(null);
  const nativeTouchHandlersRef = useRef(null);

  // Jump to `next` tab. Used by drag-commit AND by bottom-nav taps.
  function go(next, { animate = true, haptic = false, hapticAt = 0 } = {}) {
    const current = visualTabRef.current;
    if (next === current || next < 0 || next >= tabCount) return;
    if (haptic) {
      const at = hapticAt || lastHapticAt.current + 61;
      if (at - lastHapticAt.current > 60) {
        triggerTabHaptic();
        lastHapticAt.current = at;
      }
    }
    if (!animate) {
      setTrackDragging(true);
      setDragXpx(0, true);
      setInstant(true);
      commitVisualTab(next, { urgent: true });
      requestAnimationFrame(() => {
        setInstant(false);
        clearTrackMotionHintSoon(80);
      });
    } else {
      commitVisualTab(next);
      if (tapWindowTimer.current) clearTimeout(tapWindowTimer.current);
      setTrackSettling(true);
      setDragXpx(0, true);
      setTapWindow({ from: Math.min(current, next), to: Math.max(current, next) });
      tapWindowTimer.current = setTimeout(() => {
        setTapWindow(null);
        clearTrackMotionHintSoon(80);
      }, SNAP_MS + 90);
    }
    startTransition(() => setTab(next));
  }

  function onTouchStart(e) {
    const interruptX = (snapTimerRef.current || trackHintTimerRef.current) ? currentTrackDragX() : 0;
    if (snapTimerRef.current) {
      clearTimeout(snapTimerRef.current);
      snapTimerRef.current = null;
    }
    if (trackHintTimerRef.current) clearTrackHintTimer();
    if (e.touches.length !== 1) {
      touch.current = null;
      return;
    }
    const p = e.touches[0];
    touch.current = {
      x: p.clientX, y: p.clientY,
      t: e.timeStamp || 0,
      skip: inHorizontalScroller(e.target),
      w: mainRef.current?.clientWidth || 1,
      mode: null,
      startDragX: interruptX,
      interrupted: Math.abs(interruptX) > 0.5,
    };
    setDragXpx(interruptX, true);
  }

  function onTouchMove(e) {
    if (e.touches.length !== 1) return;
    const st = touch.current;
    if (!st || st.skip) return;
    const p = e.touches[0];
    const gestureDx = p.clientX - st.x;
    const dy = p.clientY - st.y;

    if (st.mode === null) {
      if (Math.abs(gestureDx) > Math.abs(dy) * 1.08 && Math.abs(gestureDx) > 8) {
        // Horizontal. If the current tab has an inner toggle (Training's
        // Activities/Charts, Races' Races/PR) that can still move in this
        // direction, leave it to that tab's own swipe handler — the top pager
        // only takes over once the inner toggle is at its edge. ('inner' = stay
        // out of the way; we don't move the outer track at all.)
        const current = visualTabRef.current;
        const inner = getInnerPager?.(current);
        const dir = gestureDx < 0 ? 1 : -1;
        const innerCanMove = inner && ((dir > 0 && inner.index < inner.count - 1) || (dir < 0 && inner.index > 0));
        st.mode = innerCanMove ? "inner" : "page";
      }
      else if (Math.abs(dy) > 6 || Math.abs(gestureDx) > 6) st.mode = "scroll";
      else return; // too small to classify yet
      if (st.mode === "page") setTrackDragging(true);
    }

    if (st.mode === "page") {
      e.preventDefault?.();
      const current = visualTabRef.current;
      const atFirst = current <= 0, atLast = current >= tabCount - 1;
      const rawDx = (st.startDragX || 0) + gestureDx;
      const resistedDx = ((atFirst && rawDx > 0) || (atLast && rawDx < 0)) ? rawDx * EDGE_RESIST : rawDx;
      const W = st.w || 1;
      const d = Math.max(-W, Math.min(W, resistedDx));
      setDragXpx(d, true);
    }
  }

  function onTouchEnd(e) {
    const st = touch.current;
    touch.current = null;
    if (!st) return;

    if (st.mode === "page" || st.interrupted) {
      const W = st.w || 1;
      const dx = dragXRef.current;
      const dt = Math.max(1, (e.timeStamp || 0) - (st.t || 0));
      const p = e.changedTouches?.[0];
      const gestureDx = p ? p.clientX - st.x : dx - (st.startDragX || 0);
      const velocity = st.mode === "page" ? gestureDx / dt : 0;
      const threshold = Math.min(W * 0.16, 58);
      const current = visualTabRef.current;
      let dir = 0;
      if ((dx <= -threshold || velocity < -0.38) && current < tabCount - 1) dir = 1;
      else if ((dx >= threshold || velocity > 0.38) && current > 0) dir = -1;
      setTrackSettling(true);
      if (dir !== 0) {
        const next = current + dir;
        const finalX = dir === 1 ? -W : W;
        if ((e.timeStamp || 0) - lastHapticAt.current > 60) {
          triggerTabHaptic();
          lastHapticAt.current = e.timeStamp || 0;
        }
        // Keep React out of the critical snap frames: the already-rendered
        // neighbor glides into place using only the compositor, then we commit
        // the logical tab after the transition has landed.
        setDragXpx(finalX, true);
        snapTimerRef.current = setTimeout(() => {
          snapTimerRef.current = null;
          setTrackDragging(true);
          setInstant(true);
          commitVisualTab(next, { urgent: true });
          setDragXpx(0, true);
          startTransition(() => setTab(next));
          requestAnimationFrame(() => {
            setInstant(false);
            clearTrackMotionHintSoon(80);
          });
        }, SNAP_MS);
      } else {
        setDragXpx(0, true); // snap back
        clearTrackMotionHintSoon();
      }
      return;
    }
    // 'scroll' / 'ignore' / unclassified — nothing to settle.
    setTrackDragging(false);
  }

  useEffect(() => {
    nativeTouchHandlersRef.current = {
      start: onTouchStart,
      move: onTouchMove,
      end: onTouchEnd,
    };
  });

  useEffect(() => {
    const el = mainRef.current;
    if (!el) return undefined;
    const startOptions = { passive: true, capture: true };
    const moveOptions = { passive: false, capture: true };
    const endOptions = { passive: true, capture: true };
    const handleStart = (event) => nativeTouchHandlersRef.current?.start?.(event);
    const handleMove = (event) => nativeTouchHandlersRef.current?.move?.(event);
    const handleEnd = (event) => nativeTouchHandlersRef.current?.end?.(event);
    el.addEventListener("touchstart", handleStart, startOptions);
    el.addEventListener("touchmove", handleMove, moveOptions);
    el.addEventListener("touchend", handleEnd, endOptions);
    el.addEventListener("touchcancel", handleEnd, endOptions);
    return () => {
      el.removeEventListener("touchstart", handleStart, startOptions);
      el.removeEventListener("touchmove", handleMove, moveOptions);
      el.removeEventListener("touchend", handleEnd, endOptions);
      el.removeEventListener("touchcancel", handleEnd, endOptions);
    };
  }, []);

  function onTabTap(idx, e) {
    const now = e?.timeStamp ?? 0;
    const current = visualTabRef.current;
    const pointerDown = pointerDownRef.current;
    if (pointerDown.switched && pointerDown.idx === idx && idx === current && now - pointerDown.at < 500) {
      pointerDownRef.current = { idx: -1, at: 0, switched: false };
      return;
    }
    const prev = lastTabTap.current;
    lastTabTap.current = { idx, at: now };
    if (idx === current && prev.idx === idx && now - prev.at < 320) {
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
    go(idx, { animate: false, haptic: true, hapticAt: now });
  }

  function commitTabPress(idx, e) {
    const current = visualTabRef.current;
    const switched = idx !== current;
    const at = e.timeStamp || 0;
    const previous = pointerDownRef.current;
    if (!switched && previous.switched && previous.idx === idx && at - previous.at < 140) {
      return;
    }
    pointerDownRef.current = { idx, at, switched };
    if (switched) {
      lastTabTap.current = { idx: -1, at: 0 };
      go(idx, { animate: false, haptic: true, hapticAt: at });
    }
  }

  function onTabPointerDown(idx, e) {
    if (e.pointerType === "mouse") return;
    commitTabPress(idx, e);
  }

  function onTabTouchStart(idx, e) {
    commitTabPress(idx, e);
  }

  const pullY = refreshing ? 44 : 0;
  const trackTransition = instant ? "none" : TRACK_SNAP_TRANSITION;

  return (
    <div style={{
      height: "100dvh",
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
      position: "relative",
      isolation: "isolate",
      background: "linear-gradient(180deg, oklch(0.105 0.008 145 / 0.82), oklch(0.074 0.008 145 / 0.72))",
    }}>
      <div className="ultreia-ambient-layer" aria-hidden="true" />
      <main
        ref={mainRef}
        style={{
          flex: 1, minHeight: 0,
          overflow: "hidden",
          position: "relative",
          zIndex: 1,
          background: "transparent",
          touchAction: "pan-y",
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

        {/* Pager surface. Each tab pane is an independent 100%-width layer, so
            a swipe moves only the visible current/neighbor panes instead of a
            five-viewport-wide strip. */}
        <div style={{
          position: "relative",
          height: "100%",
          width: "100%",
          overflow: "hidden",
          transform: pullY ? `translate3d(0, ${pullY}px, 0)` : "translate3d(0, 0, 0)",
          transition: refreshing ? TRACK_SNAP_TRANSITION : "none",
          willChange: refreshing ? "transform" : undefined,
        }} ref={trackRef} className="ultreia-pager-track">
          {TABS.map(({ idx }) => {
            const shouldRender = renderedTabSet.has(idx) || (tapWindow
              ? idx >= tapWindow.from && idx <= tapWindow.to
              : Math.abs(idx - visualTab) <= 1);
            const offset = idx - visualTab;
            return (
              <div
                key={idx}
                ref={setPaneRef(idx)}
                className="ultreia-pager-pane"
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  overflowY: "auto",
                  overflowX: "hidden",
                  overscrollBehavior: "contain",
                  WebkitOverflowScrolling: "touch",
                  touchAction: "pan-y",
                  contain: "layout paint style",
                  backfaceVisibility: "hidden",
                  transform: `translate3d(${offset * 100}%, 0, 0)`,
                  transition: instant ? "none" : trackTransition,
                  willChange: (refreshing || instant || Math.abs(offset) <= 1) ? "transform" : undefined,
                  pointerEvents: idx === visualTab ? "auto" : "none",
                  visibility: shouldRender ? "visible" : "hidden",
                  background: "linear-gradient(180deg, oklch(0.105 0.008 145 / 0.54), oklch(0.078 0.008 145 / 0.42))",
                  padding: "14px 14px 0",
                  paddingTop: "max(env(safe-area-inset-top), 14px)",
                  paddingBottom: "calc(76px + env(safe-area-inset-bottom))",
                }}>
                {shouldRender ? renderTab(idx) : null}
              </div>
            );
          })}
        </div>
      </main>

      {/* ── Bottom tab bar ───────────────────────────────────────────────── */}
      <nav style={{
        position: "fixed", left: 0, right: 0, bottom: 0,
        zIndex: 20,
        background: "linear-gradient(180deg, oklch(0.18 0.014 145 / 0.99), oklch(0.125 0.012 145 / 0.99))",
        borderTop: "1px solid var(--rule)",
        boxShadow: "0 -14px 38px oklch(0 0 0 / 0.32), 0 -1px 22px oklch(0.38 0.060 138 / 0.12)",
        backdropFilter: "none",
        WebkitBackdropFilter: "none",
        paddingBottom: "env(safe-area-inset-bottom)",
        display: "grid",
        gridTemplateColumns: "repeat(5, 1fr)",
        touchAction: "manipulation",
        WebkitTapHighlightColor: "transparent",
      }}>
        {TABS.map(({ key, idx, Icon }) => {
          const active = visualTab === idx;
          const showSpinner = idx === 2 && coachBusy;
          return (
            <button
              key={key}
              onPointerDown={(e) => onTabPointerDown(idx, e)}
              onTouchStart={(e) => onTabTouchStart(idx, e)}
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
                background: active
                  ? "linear-gradient(180deg, oklch(0.27 0.045 138 / 0.90), var(--accent-soft))"
                  : "transparent",
                border: active ? "1px solid var(--accent)" : "1px solid transparent",
                color: active ? "var(--accent-dark)" : "var(--ink-3)",
                transform: active ? "translateY(-1px)" : "none",
                boxShadow: active ? "0 0 0 1px oklch(0.54 0.055 138 / 0.13), 0 0 22px oklch(0.38 0.060 138 / 0.18)" : "none",
                transition: "transform 90ms var(--ease-out), box-shadow 90ms var(--ease-out)",
              }}>
                <Icon size={20} />
                {showSpinner && (
                  <span style={{
                    position: "absolute",
                    right: -10,
                    top: -6,
                    color: "var(--accent)",
                    background: "var(--bg-elevated)",
                    borderRadius: 8,
                    lineHeight: 0,
                  }}>
                    <Spinner size={11} thickness={1.4} color="var(--accent)" />
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
