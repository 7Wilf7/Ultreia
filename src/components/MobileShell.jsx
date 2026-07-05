import { memo, startTransition, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useT } from "../i18n/LanguageContext";
import { Spinner } from "./Spinner";
import { CalendarIcon, CoachIcon, FootIcon, SettingsIcon, TrophyIcon } from "./Icons";
import {
  getMobilePagerJumpWindow,
  getMobilePagerRenderWindow,
  mergeTabWindows,
  shouldRenderMobilePagerPane,
} from "../utils/mobilePager";

/**
 * Mobile chrome — no top header, a fixed bottom 5-tab nav, and a native
 * horizontal scroll-snap pager for cross-tab swipes.
 *
 * Each tab is its OWN vertical scroll container. Horizontal finger-follow is
 * handled by the browser's input/compositor path; React only settles the
 * selected tab after native scrolling snaps to a page.
 */
const TAB_HAPTIC_MS = 8;
const PAGER_COMMIT_DEBOUNCE_MS = 140;

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

function clampTabIndex(idx, count) {
  return Math.max(0, Math.min(count - 1, idx));
}

const PagerPaneContent = memo(function PagerPaneContent({
  shouldRender,
  renderTab,
  idx,
}) {
  if (!shouldRender) return null;
  return (
    <div className="ultreia-pager-content-shell" data-full-pane="true">
      <div className="ultreia-pager-full-content">
        {renderTab(idx)}
      </div>
    </div>
  );
});

export function MobileShell({ tab, setTab, coachBusy = false, renderTab, tabCount = 5, onRefresh = null, refreshing = false, onPagerDragActiveChange = null }) {
  const t = useT();
  const mainRef = useRef(null);
  const trackRef = useRef(null);
  const paneRefs = useRef({});
  const [visualTab, setVisualTab] = useState(tab);
  const visualTabRef = useRef(tab);
  const [renderedTabs, setRenderedTabs] = useState(() => getMobilePagerRenderWindow(tab, tabCount));
  const renderedTabsRef = useRef(renderedTabs);
  const activePane = () => paneRefs.current[visualTabRef.current];
  const pagerSettleTimerRef = useRef(null);
  const pagerTouchActiveRef = useRef(false);
  const pagerTouchingRef = useRef(false);
  const pagerDragActiveNotifiedRef = useRef(false);
  const suppressClickUntilRef = useRef(0);
  const trackOffsetRef = useRef(0);
  const pagerWidthRef = useRef(1);
  const renderTrimTimerRef = useRef(null);
  const tabPropRef = useRef(tab);
  const lastHapticAt = useRef(0);
  const lastTabTap = useRef({ idx: -1, at: 0 });
  const pointerDownRef = useRef({ idx: -1, at: 0, switched: false });
  const pullY = refreshing ? 44 : 0;

  const measurePagerWidth = useCallback(() => {
    const width = trackRef.current?.clientWidth || mainRef.current?.clientWidth || window.innerWidth || 1;
    pagerWidthRef.current = width;
    return width;
  }, []);

  const setTrackOffset = useCallback((left) => {
    trackOffsetRef.current = left;
    const track = trackRef.current;
    if (!track) return;
    track.scrollLeft = left;
  }, []);

  function scrollActiveToTop() {
    activePane()?.scrollTo?.({ top: 0, behavior: "smooth" });
  }

  const setRenderedWindow = useCallback((nextRenderedTabs) => {
    if (sameTabWindow(nextRenderedTabs, renderedTabsRef.current)) return;
    renderedTabsRef.current = nextRenderedTabs;
    setRenderedTabs(nextRenderedTabs);
  }, []);

  const commitVisualTab = useCallback((next, { renderedWindow = null } = {}) => {
    const clamped = Math.max(0, Math.min(tabCount - 1, next));
    const nextRenderedTabs = renderedWindow
      ? mergeTabWindows(renderedWindow)
      : getMobilePagerRenderWindow(clamped, tabCount);
    visualTabRef.current = clamped;

    setRenderedWindow(nextRenderedTabs);
    setVisualTab(clamped);
  }, [setRenderedWindow, tabCount]);

  const notifyPagerDragActive = useCallback((active) => {
    if (pagerDragActiveNotifiedRef.current === active) return;
    pagerDragActiveNotifiedRef.current = active;
    onPagerDragActiveChange?.(active);
  }, [onPagerDragActiveChange]);

  const alignTrackToTab = useCallback((next) => {
    const clamped = clampTabIndex(next, tabCount);
    const width = measurePagerWidth();
    setTrackOffset(clamped * width);
  }, [measurePagerWidth, setTrackOffset, tabCount]);

  const clearPagerTimers = useCallback(() => {
    if (pagerSettleTimerRef.current) {
      clearTimeout(pagerSettleTimerRef.current);
      pagerSettleTimerRef.current = null;
    }
    if (renderTrimTimerRef.current) {
      clearTimeout(renderTrimTimerRef.current);
      renderTrimTimerRef.current = null;
    }
  }, []);

  const scheduleRenderedWindowTrim = useCallback((next, delay = 220) => {
    if (renderTrimTimerRef.current) clearTimeout(renderTrimTimerRef.current);
    const clamped = Math.max(0, Math.min(tabCount - 1, next));
    renderTrimTimerRef.current = setTimeout(() => {
      renderTrimTimerRef.current = null;
      if (pagerTouchActiveRef.current || pagerSettleTimerRef.current || visualTabRef.current !== clamped) return;
      setRenderedWindow(getMobilePagerRenderWindow(clamped, tabCount));
    }, delay);
  }, [setRenderedWindow, tabCount]);

  const finishPagerGesture = useCallback(() => {
    pagerTouchActiveRef.current = false;
    pagerTouchingRef.current = false;
    notifyPagerDragActive(false);
  }, [notifyPagerDragActive]);

  const completePagerFromScroll = useCallback(() => {
    if (pagerSettleTimerRef.current) {
      clearTimeout(pagerSettleTimerRef.current);
      pagerSettleTimerRef.current = null;
    }
    const width = measurePagerWidth();
    const left = trackRef.current?.scrollLeft ?? trackOffsetRef.current;
    const clamped = clampTabIndex(Math.round(left / Math.max(1, width)), tabCount);
    flushSync(() => commitVisualTab(clamped));
    alignTrackToTab(clamped);
    if (clamped !== tabPropRef.current) {
      tabPropRef.current = clamped;
      startTransition(() => setTab(clamped));
    }
    finishPagerGesture();
    scheduleRenderedWindowTrim(clamped);
  }, [alignTrackToTab, commitVisualTab, finishPagerGesture, measurePagerWidth, scheduleRenderedWindowTrim, setTab, tabCount]);

  const schedulePagerCommitFromScroll = useCallback((delay = PAGER_COMMIT_DEBOUNCE_MS) => {
    if (pagerSettleTimerRef.current) clearTimeout(pagerSettleTimerRef.current);
    pagerSettleTimerRef.current = setTimeout(() => {
      pagerSettleTimerRef.current = null;
      completePagerFromScroll();
    }, delay);
  }, [completePagerFromScroll]);

  useLayoutEffect(() => {
    tabPropRef.current = tab;
    if (tab !== visualTabRef.current) commitVisualTab(tab);
    alignTrackToTab(tab);
  }, [tab, alignTrackToTab, commitVisualTab]);

  useLayoutEffect(() => {
    alignTrackToTab(visualTabRef.current);
  }, [alignTrackToTab, pullY]);

  useEffect(() => () => {
    clearPagerTimers();
  }, [clearPagerTimers]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return undefined;

    const onPagerTouchStart = () => {
      clearPagerTimers();
      pagerTouchingRef.current = true;
      pagerTouchActiveRef.current = false;
      const width = measurePagerWidth();
      const current = visualTabRef.current;
      setTrackOffset(current * width);
    };

    const onPagerTouchEnd = () => {
      pagerTouchingRef.current = false;
      const width = pagerWidthRef.current || measurePagerWidth();
      const left = track.scrollLeft ?? trackOffsetRef.current;
      const currentLeft = visualTabRef.current * width;
      if (pagerTouchActiveRef.current || Math.abs(left - currentLeft) > 1) {
        schedulePagerCommitFromScroll();
        return;
      }
      finishPagerGesture();
    };

    const suppressClickAfterDrag = (e) => {
      if (performance.now() <= suppressClickUntilRef.current) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const onTrackScroll = () => {
      const left = track.scrollLeft;
      trackOffsetRef.current = left;
      const width = pagerWidthRef.current || measurePagerWidth();
      const currentLeft = visualTabRef.current * width;
      if (Math.abs(left - currentLeft) > 1) {
        pagerTouchActiveRef.current = true;
        suppressClickUntilRef.current = performance.now() + 450;
        notifyPagerDragActive(true);
        if (!pagerTouchingRef.current) schedulePagerCommitFromScroll();
      }
    };

    const onTrackScrollEnd = () => {
      if (!pagerTouchingRef.current && pagerTouchActiveRef.current) schedulePagerCommitFromScroll(0);
    };

    track.addEventListener("touchstart", onPagerTouchStart, { capture: true, passive: true });
    track.addEventListener("touchend", onPagerTouchEnd, { capture: true, passive: true });
    track.addEventListener("touchcancel", onPagerTouchEnd, { capture: true, passive: true });
    track.addEventListener("scroll", onTrackScroll, { passive: true });
    track.addEventListener("scrollend", onTrackScrollEnd, { passive: true });
    track.addEventListener("click", suppressClickAfterDrag, true);
    return () => {
      track.removeEventListener("touchstart", onPagerTouchStart, true);
      track.removeEventListener("touchend", onPagerTouchEnd, true);
      track.removeEventListener("touchcancel", onPagerTouchEnd, true);
      track.removeEventListener("scroll", onTrackScroll);
      track.removeEventListener("scrollend", onTrackScrollEnd);
      track.removeEventListener("click", suppressClickAfterDrag, true);
    };
  }, [
    clearPagerTimers,
    finishPagerGesture,
    measurePagerWidth,
    notifyPagerDragActive,
    schedulePagerCommitFromScroll,
    setTrackOffset,
  ]);

  useEffect(() => {
    const onResize = () => alignTrackToTab(visualTabRef.current);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [alignTrackToTab]);

  const TABS = [
    { key: "tabs.training", idx: 0, Icon: FootIcon },
    { key: "tabs.calendar", idx: 1, Icon: CalendarIcon },
    { key: "tabs.ai_coach", idx: 2, Icon: CoachIcon },
    { key: "tabs.races", idx: 3, Icon: TrophyIcon },
    { key: "tabs.settings", idx: 4, Icon: SettingsIcon },
  ];

  // Bottom-nav taps stay instant; finger drags use native scroll snap above.
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
    finishPagerGesture();
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
    return (
      <PagerPaneContent
        idx={idx}
        shouldRender={shouldRender}
        renderTab={renderTab}
      />
    );
  }

  return (
    <div
      className="ultreia-mobile-shell"
      style={{
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
          flex: 1,
          minHeight: 0,
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
            left: 0,
            right: 0,
            height: 44,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            color: "var(--ink-2)",
            pointerEvents: "none",
            zIndex: 11,
            fontFamily: "var(--font-sans)",
            fontSize: 13,
          }}>
            <><Spinner size={16} thickness={2} color="var(--moss)" /><span>{t("sync.syncing")}</span></>
          </div>
        )}

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
            scrollSnapType: "x mandatory",
            scrollBehavior: "auto",
            WebkitOverflowScrolling: "touch",
            overflowAnchor: "none",
            scrollbarWidth: "none",
            msOverflowStyle: "none",
            backfaceVisibility: "hidden",
            willChange: refreshing ? "transform" : "auto",
            transform: refreshing ? `translate3d(0, ${pullY}px, 0)` : "none",
            transition: "none",
          }}>
          {TABS.map(({ idx }) => {
            const shouldRender = shouldRenderMobilePagerPane(idx, renderedTabs, visualTab, tab);
            const shouldShow = shouldRender;
            const isInteractivePane = shouldRender && (idx === visualTab || idx === tab);
            return (
              <div
                key={idx}
                ref={(el) => {
                  if (!el) {
                    delete paneRefs.current[idx];
                    return;
                  }
                  paneRefs.current[idx] = el;
                }}
                className="ultreia-pager-pane"
                data-rendered={shouldRender ? "true" : "false"}
                data-preview={shouldRender ? "false" : "true"}
                aria-hidden={!isInteractivePane}
                style={{
                  position: "relative",
                  flex: "0 0 100%",
                  minWidth: "100%",
                  width: "100%",
                  height: "100%",
                  scrollSnapAlign: "start",
                  scrollSnapStop: "always",
                  overflowY: "auto",
                  overflowX: "hidden",
                  overscrollBehavior: "contain",
                  WebkitOverflowScrolling: "touch",
                  touchAction: "pan-x pan-y",
                  contain: "layout paint style",
                  overflowAnchor: "none",
                  backfaceVisibility: "hidden",
                  transform: "none",
                  willChange: "auto",
                  isolation: shouldShow ? "isolate" : "auto",
                  visibility: shouldShow ? "visible" : "hidden",
                  pointerEvents: isInteractivePane ? "auto" : "none",
                  background: shouldShow ? "var(--bg)" : "transparent",
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

      {/* Bottom tab bar */}
      <nav style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
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
