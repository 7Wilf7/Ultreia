import { startTransition, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useT } from "../i18n/LanguageContext";
import { Spinner } from "./Spinner";
import { CalendarIcon, CoachIcon, FootIcon, SettingsIcon, TrophyIcon } from "./Icons";
import {
  getMobilePagerJumpWindow,
  getMobilePagerRenderWindow,
  getMobilePagerScrollWindow,
  mergeTabWindows,
} from "../utils/mobilePager";

/**
 * Mobile chrome — no top header, a native horizontal tab pager, fixed bottom
 * 5-tab nav. `renderTab(idx)` paints any tab by index so the pager can show the
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
const REFRESH_SNAP_TRANSITION = "transform 300ms cubic-bezier(0.2,0.82,0.18,1)";
const SCROLL_SETTLE_MS = 130;
const PAGER_SETTLE_MS = 560;
const TAB_HAPTIC_MS = 8;
const PAGER_INTENT_PX = 5;
const PAGER_AXIS_RATIO = 1.08;

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

function easeOutQuart(x) {
  return 1 - Math.pow(1 - x, 4);
}

export function MobileShell({ tab, setTab, coachBusy = false, renderTab, tabCount = 5, onRefresh = null, refreshing = false }) {
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
  const scrollSettleTimerRef = useRef(null);
  const settleFrameRef = useRef(0);
  const scrollRenderFrameRef = useRef(0);
  const renderTrimTimerRef = useRef(null);
  const pagerTouchActiveRef = useRef(false);
  const pagerGestureRef = useRef(null);
  const tabPropRef = useRef(tab);
  const lastHapticAt = useRef(0);
  const lastTabTap = useRef({ idx: -1, at: 0 });
  const pointerDownRef = useRef({ idx: -1, at: 0, switched: false });
  const pullY = refreshing ? 44 : 0;

  const measurePagerWidth = useCallback(() => {
    return trackRef.current?.clientWidth || mainRef.current?.clientWidth || window.innerWidth || 1;
  }, []);

  function scrollActiveToTop() {
    activePane()?.scrollTo?.({ top: 0, behavior: "smooth" });
  }

  const setRenderedWindow = useCallback((nextRenderedTabs) => {
    if (sameTabWindow(nextRenderedTabs, renderedTabsRef.current)) return;
    renderedTabsRef.current = nextRenderedTabs;
    setRenderedTabs(nextRenderedTabs);
  }, []);

  const ensureRenderedWindow = useCallback((next, { keepCurrent = true } = {}) => {
    const clamped = Math.max(0, Math.min(tabCount - 1, next));
    const targetWindow = getMobilePagerRenderWindow(clamped, tabCount);
    const currentWindow = keepCurrent
      ? getMobilePagerRenderWindow(visualTabRef.current, tabCount)
      : [];
    const nextRenderedTabs = mergeTabWindows(targetWindow, currentWindow);
    setRenderedWindow(nextRenderedTabs);
    return clamped;
  }, [setRenderedWindow, tabCount]);

  const commitVisualTab = useCallback((next, { renderedWindow = null } = {}) => {
    const clamped = Math.max(0, Math.min(tabCount - 1, next));
    const nextRenderedTabs = renderedWindow
      ? mergeTabWindows(renderedWindow)
      : getMobilePagerRenderWindow(clamped, tabCount);
    visualTabRef.current = clamped;

    setRenderedWindow(nextRenderedTabs);
    setVisualTab(clamped);
  }, [setRenderedWindow, tabCount]);

  const clearPagerTimers = useCallback(() => {
    if (scrollSettleTimerRef.current) {
      clearTimeout(scrollSettleTimerRef.current);
      scrollSettleTimerRef.current = null;
    }
    if (settleFrameRef.current) {
      cancelAnimationFrame(settleFrameRef.current);
      settleFrameRef.current = 0;
    }
    if (scrollRenderFrameRef.current) {
      cancelAnimationFrame(scrollRenderFrameRef.current);
      scrollRenderFrameRef.current = 0;
    }
    if (renderTrimTimerRef.current) {
      clearTimeout(renderTrimTimerRef.current);
      renderTrimTimerRef.current = null;
    }
  }, []);

  const clearPagingState = useCallback(() => {
    const track = trackRef.current;
    if (track) {
      delete track.dataset.paging;
      delete track.dataset.touching;
    }
    pagerGestureRef.current = null;
  }, []);

  const markPagingState = useCallback(() => {
    const track = trackRef.current;
    if (track) track.dataset.paging = "true";
  }, []);

  const nearestScrollTab = useCallback(() => {
    const el = trackRef.current;
    if (!el) return visualTabRef.current;
    const width = measurePagerWidth();
    return Math.max(0, Math.min(tabCount - 1, Math.round(el.scrollLeft / width)));
  }, [measurePagerWidth, tabCount]);

  const scrollToTab = useCallback((next, behavior = "auto") => {
    const el = trackRef.current;
    if (!el) return;
    const left = Math.max(0, Math.min(tabCount - 1, next)) * measurePagerWidth();
    if (Math.abs(el.scrollLeft - left) < 1) return;
    el.scrollTo({ left, behavior });
  }, [measurePagerWidth, tabCount]);

  const syncRenderedWindowToScroll = useCallback(() => {
    scrollRenderFrameRef.current = 0;
    const el = trackRef.current;
    if (!el) return;
    const scrollWindow = getMobilePagerScrollWindow(el.scrollLeft, measurePagerWidth(), tabCount);
    const currentWindow = getMobilePagerRenderWindow(visualTabRef.current, tabCount);
    setRenderedWindow(mergeTabWindows(scrollWindow, currentWindow));
  }, [measurePagerWidth, setRenderedWindow, tabCount]);

  const scheduleScrollRenderWindow = useCallback(() => {
    if (scrollRenderFrameRef.current) return;
    scrollRenderFrameRef.current = requestAnimationFrame(syncRenderedWindowToScroll);
  }, [syncRenderedWindowToScroll]);

  const scheduleRenderedWindowTrim = useCallback((next, delay = 180) => {
    if (renderTrimTimerRef.current) clearTimeout(renderTrimTimerRef.current);
    const clamped = Math.max(0, Math.min(tabCount - 1, next));
    renderTrimTimerRef.current = setTimeout(() => {
      renderTrimTimerRef.current = null;
      if (pagerTouchActiveRef.current || settleFrameRef.current || visualTabRef.current !== clamped) return;
      setRenderedWindow(getMobilePagerRenderWindow(clamped, tabCount));
    }, delay);
  }, [setRenderedWindow, tabCount]);

  const finishSettledTab = useCallback((next) => {
    const clamped = Math.max(0, Math.min(tabCount - 1, next));
    pagerTouchActiveRef.current = false;
    clearPagingState();
    commitVisualTab(clamped);
    scrollToTab(clamped, "auto");
    if (clamped !== tabPropRef.current) {
      tabPropRef.current = clamped;
      startTransition(() => setTab(clamped));
    }
  }, [clearPagingState, commitVisualTab, scrollToTab, setTab, tabCount]);

  const animateScrollToTab = useCallback((next) => {
    const el = trackRef.current;
    if (!el) return;
    clearPagerTimers();
    const clamped = Math.max(0, Math.min(tabCount - 1, next));
    ensureRenderedWindow(clamped);
    const from = el.scrollLeft;
    const to = clamped * measurePagerWidth();
    const distance = to - from;
    if (Math.abs(distance) < 1) {
      el.scrollLeft = to;
      finishSettledTab(clamped);
      return;
    }
    const started = performance.now();
    const step = (now) => {
      const progress = Math.min(1, (now - started) / PAGER_SETTLE_MS);
      el.scrollLeft = from + distance * easeOutQuart(progress);
      if (progress < 1) {
        settleFrameRef.current = requestAnimationFrame(step);
        return;
      }
      settleFrameRef.current = 0;
      el.scrollLeft = to;
      finishSettledTab(clamped);
    };
    settleFrameRef.current = requestAnimationFrame(step);
  }, [clearPagerTimers, ensureRenderedWindow, finishSettledTab, measurePagerWidth, tabCount]);

  const settleScrollTab = useCallback(() => {
    animateScrollToTab(nearestScrollTab());
  }, [animateScrollToTab, nearestScrollTab]);

  const scheduleScrollSettle = useCallback((delay = SCROLL_SETTLE_MS) => {
    if (scrollSettleTimerRef.current) clearTimeout(scrollSettleTimerRef.current);
    scrollSettleTimerRef.current = setTimeout(() => {
      scrollSettleTimerRef.current = null;
      settleScrollTab();
    }, delay);
  }, [settleScrollTab]);

  function onPagerScroll() {
    scheduleScrollRenderWindow();
    if (settleFrameRef.current) return;
    if (!pagerTouchActiveRef.current) scheduleScrollSettle();
  }

  function onPagerTouchStart() {
    pagerTouchActiveRef.current = true;
    clearPagerTimers();
    clearPagingState();
    const track = trackRef.current;
    if (track) track.dataset.touching = "true";
    ensureRenderedWindow(visualTabRef.current);
  }

  function onPagerTouchEnd() {
    pagerTouchActiveRef.current = false;
    scheduleScrollRenderWindow();
    scheduleScrollSettle();
  }

  useLayoutEffect(() => {
    tabPropRef.current = tab;
    if (tab === visualTabRef.current) return undefined;
    commitVisualTab(tab);
    const frame = requestAnimationFrame(() => scrollToTab(tab, "auto"));
    return () => cancelAnimationFrame(frame);
  }, [tab, commitVisualTab, scrollToTab]);

  useEffect(() => () => {
    clearPagerTimers();
    clearPagingState();
  }, [clearPagerTimers, clearPagingState]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return undefined;

    const onTouchStart = (event) => {
      if (event.touches.length !== 1) {
        pagerGestureRef.current = null;
        return;
      }
      const touch = event.touches[0];
      pagerGestureRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        mode: "pending",
      };
    };

    const onTouchMove = (event) => {
      const gesture = pagerGestureRef.current;
      if (!gesture || gesture.mode !== "pending" || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const dx = touch.clientX - gesture.x;
      const dy = touch.clientY - gesture.y;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);
      if (absDx >= PAGER_INTENT_PX && absDx > absDy * PAGER_AXIS_RATIO) {
        gesture.mode = "paging";
        const current = visualTabRef.current;
        const target = dx < 0 ? current + 1 : current - 1;
        if (target >= 0 && target < tabCount) ensureRenderedWindow(target);
        markPagingState();
        return;
      }
      if (absDy >= PAGER_INTENT_PX && absDy > absDx * PAGER_AXIS_RATIO) {
        gesture.mode = "scrolling";
      }
    };

    const onTouchEnd = () => {
      pagerGestureRef.current = null;
    };

    track.addEventListener("touchstart", onTouchStart, { passive: true });
    track.addEventListener("touchmove", onTouchMove, { passive: true });
    track.addEventListener("touchend", onTouchEnd, { passive: true });
    track.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      track.removeEventListener("touchstart", onTouchStart);
      track.removeEventListener("touchmove", onTouchMove);
      track.removeEventListener("touchend", onTouchEnd);
      track.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [ensureRenderedWindow, markPagingState, tabCount]);

  useEffect(() => {
    const onResize = () => scrollToTab(visualTabRef.current, "auto");
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [scrollToTab]);

  const TABS = [
    { key: "tabs.training", idx: 0, Icon: FootIcon },
    { key: "tabs.calendar", idx: 1, Icon: CalendarIcon },
    { key: "tabs.ai_coach", idx: 2, Icon: CoachIcon },
    { key: "tabs.races",    idx: 3, Icon: TrophyIcon },
    { key: "tabs.settings", idx: 4, Icon: SettingsIcon },
  ];

  // Jump to `next` tab. Bottom-nav taps stay instant; finger drags are owned by
  // the browser's native horizontal scroll path.
  function go(next, { haptic = false, hapticAt = 0 } = {}) {
    const current = visualTabRef.current;
    if (next === current || next < 0 || next >= tabCount) return;
    if (haptic) {
      const at = hapticAt || lastHapticAt.current + 61;
      if (at - lastHapticAt.current > 60) {
        triggerTabHaptic();
        lastHapticAt.current = at;
      }
    }
    clearPagerTimers();
    const jumpWindow = getMobilePagerJumpWindow(current, next, tabCount);
    flushSync(() => commitVisualTab(next, { renderedWindow: jumpWindow }));
    scrollToTab(next, "auto");
    scheduleRenderedWindowTrim(next);
    tabPropRef.current = next;
    startTransition(() => setTab(next));
  }

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
    go(idx, { haptic: true, hapticAt: now });
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
      go(idx, { haptic: true, hapticAt: at });
    }
  }

  function onTabPointerDown(idx, e) {
    if (e.pointerType === "mouse") return;
    commitTabPress(idx, e);
  }

  function onTabTouchStart(idx, e) {
    commitTabPress(idx, e);
  }

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
          touchAction: "pan-x pan-y",
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

        {/* Horizontal paging uses native scroll while the finger is down. There
            is no scroll-snap during touch; React only settles to the nearest tab
            after release, so holding between panes remains fully finger-driven. */}
        <div
          ref={trackRef}
          className="ultreia-pager-track"
          onScroll={onPagerScroll}
          onTouchStartCapture={onPagerTouchStart}
          onTouchEndCapture={onPagerTouchEnd}
          onTouchCancelCapture={onPagerTouchEnd}
          style={{
          display: "flex",
          height: "100%",
          width: "100%",
          overflowX: "auto",
          overflowY: "hidden",
          scrollSnapType: "none",
          scrollBehavior: "auto",
          overscrollBehaviorX: "contain",
          WebkitOverflowScrolling: "touch",
          touchAction: "pan-x pan-y",
          overflowAnchor: "none",
          scrollbarWidth: "none",
          msOverflowStyle: "none",
          transform: pullY ? `translate3d(0, ${pullY}px, 0)` : "translate3d(0, 0, 0)",
          transition: refreshing ? REFRESH_SNAP_TRANSITION : "none",
          willChange: refreshing ? "transform" : undefined,
          backfaceVisibility: "hidden",
        }}>
          {TABS.map(({ idx }) => {
            const shouldRender = renderedTabSet.has(idx);
            return (
              <div
                key={idx}
                ref={setPaneRef(idx)}
                className="ultreia-pager-pane"
                style={{
                  position: "relative",
                  flex: "0 0 100%",
                  width: "100%",
                  height: "100%",
                  overflowY: "auto",
                  overflowX: "hidden",
                  overscrollBehavior: "contain",
                  WebkitOverflowScrolling: "touch",
                  touchAction: "pan-x pan-y",
                  contain: "layout paint style",
                  overflowAnchor: "none",
                  backfaceVisibility: "hidden",
                  pointerEvents: shouldRender ? "auto" : "none",
                  background: "linear-gradient(180deg, oklch(0.105 0.008 145), oklch(0.078 0.008 145))",
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
