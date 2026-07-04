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
  shouldRenderMobilePagerPane,
} from "../utils/mobilePager";

/**
 * Mobile chrome — no top header, a native-scroll tab pager, fixed bottom 5-tab
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
const REFRESH_SNAP_TRANSITION = "transform 300ms cubic-bezier(0.2,0.82,0.18,1)";
const TAB_HAPTIC_MS = 8;
const PAGER_SETTLE_MIN_MS = 620;
const PAGER_SETTLE_MAX_MS = 1120;

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

function settleDurationForDistance(distance, width) {
  const fraction = Math.min(1, Math.abs(distance) / Math.max(1, width));
  return Math.round(PAGER_SETTLE_MIN_MS + (PAGER_SETTLE_MAX_MS - PAGER_SETTLE_MIN_MS) * fraction);
}

function easeOutSine(t) {
  return Math.sin((t * Math.PI) / 2);
}

export function MobileShell({ tab, setTab, coachBusy = false, renderTab, tabCount = 5, onRefresh = null, refreshing = false }) {
  const t = useT();
  const mainRef = useRef(null);
  const trackRef = useRef(null);
  const paneRefs = useRef({});
  const paneRefCallbacksRef = useRef({});
  const [visualTab, setVisualTab] = useState(tab);
  const visualTabRef = useRef(tab);
  const [renderedTabs, setRenderedTabs] = useState(() => getMobilePagerRenderWindow(tab, tabCount));
  const renderedTabsRef = useRef(renderedTabs);
  const activePane = () => paneRefs.current[visualTabRef.current];
  const scrollSettleFrameRef = useRef(0);
  const scrollRenderFrameRef = useRef(0);
  const trackScrollLeftRef = useRef(0);
  const pagerWidthRef = useRef(1);
  const renderTrimTimerRef = useRef(null);
  const freezeTabContentRef = useRef(false);
  const cachedTabContentRef = useRef({});
  const pagerTouchActiveRef = useRef(false);
  const tabPropRef = useRef(tab);
  const lastHapticAt = useRef(0);
  const lastTabTap = useRef({ idx: -1, at: 0 });
  const pointerDownRef = useRef({ idx: -1, at: 0, switched: false });
  const pullY = refreshing ? 44 : 0;

  const setPaneRef = (idx) => {
    if (!paneRefCallbacksRef.current[idx]) {
      paneRefCallbacksRef.current[idx] = (el) => {
        if (!el) {
          delete paneRefs.current[idx];
          return;
        }
        paneRefs.current[idx] = el;
      };
    }
    return paneRefCallbacksRef.current[idx];
  };

  const measurePagerWidth = useCallback(() => {
    const width = trackRef.current?.clientWidth || mainRef.current?.clientWidth || window.innerWidth || 1;
    pagerWidthRef.current = width;
    return width;
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

  const setTrackScrollLeft = useCallback((left) => {
    const track = trackRef.current;
    if (!track) return;
    trackScrollLeftRef.current = left;
    track.scrollLeft = left;
  }, []);

  const alignTrackToTab = useCallback((next) => {
    const clamped = Math.max(0, Math.min(tabCount - 1, next));
    setTrackScrollLeft(clamped * measurePagerWidth());
  }, [measurePagerWidth, setTrackScrollLeft, tabCount]);

  const clearPagerTimers = useCallback(() => {
    if (scrollSettleFrameRef.current) {
      cancelAnimationFrame(scrollSettleFrameRef.current);
      scrollSettleFrameRef.current = 0;
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
    freezeTabContentRef.current = false;
  }, []);

  const scheduleRenderedWindowTrim = useCallback((next, delay = 180) => {
    if (renderTrimTimerRef.current) clearTimeout(renderTrimTimerRef.current);
    const clamped = Math.max(0, Math.min(tabCount - 1, next));
    renderTrimTimerRef.current = setTimeout(() => {
      renderTrimTimerRef.current = null;
      if (pagerTouchActiveRef.current || scrollSettleFrameRef.current || visualTabRef.current !== clamped) return;
      setRenderedWindow(getMobilePagerRenderWindow(clamped, tabCount));
    }, delay);
  }, [setRenderedWindow, tabCount]);

  const finishPagerGesture = useCallback(() => {
    clearPagerTimers();
    clearPagingState();
    pagerTouchActiveRef.current = false;
  }, [clearPagerTimers, clearPagingState]);

  const completePagerSettle = useCallback((next) => {
    const clamped = Math.max(0, Math.min(tabCount - 1, next));
    finishPagerGesture();
    commitVisualTab(clamped);
    alignTrackToTab(clamped);
    if (clamped !== tabPropRef.current) {
      tabPropRef.current = clamped;
      startTransition(() => setTab(clamped));
    }
  }, [alignTrackToTab, commitVisualTab, finishPagerGesture, setTab, tabCount]);

  const settlePagerToTab = useCallback((next) => {
    clearPagerTimers();
    const clamped = Math.max(0, Math.min(tabCount - 1, next));
    ensureRenderedWindow(clamped);
    const width = measurePagerWidth();
    const from = trackRef.current?.scrollLeft ?? trackScrollLeftRef.current;
    const to = clamped * width;
    const distance = to - from;
    if (Math.abs(distance) < 1) {
      setTrackScrollLeft(to);
      completePagerSettle(clamped);
      return;
    }
    const duration = settleDurationForDistance(distance, width);
    const startedAt = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - startedAt) / duration);
      setTrackScrollLeft(from + distance * easeOutSine(t));
      if (t < 1) {
        scrollSettleFrameRef.current = requestAnimationFrame(step);
        return;
      }
      scrollSettleFrameRef.current = 0;
      completePagerSettle(clamped);
    };
    scrollSettleFrameRef.current = requestAnimationFrame(step);
  }, [clearPagerTimers, completePagerSettle, ensureRenderedWindow, measurePagerWidth, setTrackScrollLeft, tabCount]);

  const settlePagerFromNativeScroll = useCallback(() => {
    if (scrollSettleFrameRef.current) return;
    const width = measurePagerWidth();
    const left = trackRef.current?.scrollLeft ?? trackScrollLeftRef.current;
    const currentLeft = visualTabRef.current * width;
    if (!pagerTouchActiveRef.current && Math.abs(left - currentLeft) < 1) return;
    pagerTouchActiveRef.current = true;
    const nearest = Math.max(0, Math.min(tabCount - 1, Math.round(left / Math.max(1, width))));
    settlePagerToTab(nearest);
  }, [measurePagerWidth, settlePagerToTab, tabCount]);

  const syncRenderedWindowToScroll = useCallback(() => {
    scrollRenderFrameRef.current = 0;
    const track = trackRef.current;
    if (!track) return;
    const width = pagerWidthRef.current || measurePagerWidth();
    trackScrollLeftRef.current = track.scrollLeft;
    const scrollWindow = getMobilePagerScrollWindow(track.scrollLeft, width, tabCount);
    const currentWindow = getMobilePagerRenderWindow(visualTabRef.current, tabCount);
    setRenderedWindow(mergeTabWindows(scrollWindow, currentWindow));
  }, [measurePagerWidth, setRenderedWindow, tabCount]);

  const onPagerScroll = useCallback(() => {
    const track = trackRef.current;
    if (!track || scrollSettleFrameRef.current || scrollRenderFrameRef.current) return;
    trackScrollLeftRef.current = track.scrollLeft;
    const width = pagerWidthRef.current || track.clientWidth || 1;
    const currentLeft = visualTabRef.current * width;
    if (!pagerTouchActiveRef.current && Math.abs(track.scrollLeft - currentLeft) > 2) {
      pagerTouchActiveRef.current = true;
      freezeTabContentRef.current = true;
    }
    const page = track.scrollLeft / width;
    const low = Math.max(0, Math.min(tabCount - 1, Math.floor(page)));
    const high = Math.max(0, Math.min(tabCount - 1, Math.ceil(page)));
    const rendered = renderedTabsRef.current;
    if (rendered.includes(low) && rendered.includes(high)) return;
    scrollRenderFrameRef.current = requestAnimationFrame(syncRenderedWindowToScroll);
  }, [syncRenderedWindowToScroll, tabCount]);

  useLayoutEffect(() => {
    tabPropRef.current = tab;
    if (tab !== visualTabRef.current) commitVisualTab(tab);
    const frame = requestAnimationFrame(() => alignTrackToTab(tab));
    return () => cancelAnimationFrame(frame);
  }, [tab, alignTrackToTab, commitVisualTab]);

  useLayoutEffect(() => {
    alignTrackToTab(visualTabRef.current);
  }, [alignTrackToTab, pullY]);

  const onPagerTouchEnd = useCallback(() => {
    settlePagerFromNativeScroll();
  }, [settlePagerFromNativeScroll]);

  const onPagerTouchStart = useCallback(() => {
    clearPagerTimers();
  }, [clearPagerTimers]);

  useEffect(() => () => {
    clearPagerTimers();
    clearPagingState();
  }, [clearPagerTimers, clearPagingState]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return undefined;
    track.addEventListener("touchstart", onPagerTouchStart, { passive: true });
    track.addEventListener("touchend", onPagerTouchEnd, { passive: true });
    track.addEventListener("touchcancel", onPagerTouchEnd, { passive: true });
    track.addEventListener("scroll", onPagerScroll, { passive: true });
    return () => {
      track.removeEventListener("touchstart", onPagerTouchStart);
      track.removeEventListener("touchend", onPagerTouchEnd);
      track.removeEventListener("touchcancel", onPagerTouchEnd);
      track.removeEventListener("scroll", onPagerScroll);
    };
  }, [onPagerScroll, onPagerTouchEnd, onPagerTouchStart]);

  useEffect(() => {
    const onResize = () => alignTrackToTab(visualTabRef.current);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [alignTrackToTab]);

  useEffect(() => {
    const rendered = new Set(renderedTabs);
    Object.keys(cachedTabContentRef.current).forEach((key) => {
      if (!rendered.has(Number(key))) delete cachedTabContentRef.current[key];
    });
  }, [renderedTabs]);

  const TABS = [
    { key: "tabs.training", idx: 0, Icon: FootIcon },
    { key: "tabs.calendar", idx: 1, Icon: CalendarIcon },
    { key: "tabs.ai_coach", idx: 2, Icon: CoachIcon },
    { key: "tabs.races",    idx: 3, Icon: TrophyIcon },
    { key: "tabs.settings", idx: 4, Icon: SettingsIcon },
  ];

  // Jump to `next` tab. Bottom-nav taps stay instant; finger drags stay on the
  // browser's native horizontal scroll path above.
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
    clearPagingState();
    const jumpWindow = getMobilePagerJumpWindow(current, next, tabCount);
    flushSync(() => commitVisualTab(next, { renderedWindow: jumpWindow }));
    alignTrackToTab(next);
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

  function renderPaneContent(idx, shouldRender) {
    if (!shouldRender) return null;
    if (freezeTabContentRef.current && Object.prototype.hasOwnProperty.call(cachedTabContentRef.current, idx)) {
      return cachedTabContentRef.current[idx];
    }
    const content = renderTab(idx);
    cachedTabContentRef.current[idx] = content;
    return content;
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

        {/* Horizontal paging uses native scrolling so finger-follow stays off
            React's render path; React only settles state after release. */}
        <div
          ref={trackRef}
          className="ultreia-pager-track"
          style={{
            display: "flex",
            height: "100%",
            width: "100%",
            overflowX: "auto",
            overflowY: "hidden",
            overscrollBehaviorX: "contain",
            touchAction: "pan-x pan-y",
            scrollSnapType: "none",
            scrollBehavior: "auto",
            WebkitOverflowScrolling: "touch",
            overflowAnchor: "none",
            scrollbarWidth: "none",
            msOverflowStyle: "none",
            backfaceVisibility: "hidden",
            transform: `translate3d(0, ${pullY}px, 0)`,
            transition: refreshing ? REFRESH_SNAP_TRANSITION : "none",
          }}>
          {/* eslint-disable-next-line react-hooks/refs -- Drag-time pane caching intentionally reads refs during render to avoid re-rendering heavy tab trees mid-gesture. */}
          {TABS.map(({ idx }) => {
            const shouldRender = shouldRenderMobilePagerPane(idx, renderedTabs, visualTab, tab);
            return (
              <div
                key={idx}
                ref={setPaneRef(idx)}
                className="ultreia-pager-pane"
                data-rendered={shouldRender ? "true" : "false"}
                aria-hidden={!shouldRender}
                style={{
                  position: "relative",
                  flex: "0 0 100%",
                  minWidth: "100%",
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
                  transform: shouldRender ? "translateZ(0)" : "none",
                  willChange: shouldRender ? "transform" : "auto",
                  isolation: shouldRender ? "isolate" : "auto",
                  visibility: shouldRender ? "visible" : "hidden",
                  pointerEvents: shouldRender ? "auto" : "none",
                  background: shouldRender ? "var(--bg)" : "transparent",
                  padding: "14px 14px 0",
                  paddingTop: "max(env(safe-area-inset-top), 14px)",
                  paddingBottom: "calc(76px + env(safe-area-inset-bottom))",
                }}>
                {renderPaneContent(idx, shouldRender)}
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
