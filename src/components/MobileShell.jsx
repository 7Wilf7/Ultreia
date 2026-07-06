import { memo, startTransition, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useT } from "../i18n/LanguageContext";
import { Spinner } from "./Spinner";
import { CalendarIcon, CoachIcon, FootIcon, SettingsIcon, TrophyIcon } from "./Icons";
import {
  getMobilePagerJumpWindow,
  getMobilePagerRenderWindow,
  mergeTabWindows,
  resolveMobilePagerTouchStart,
  shouldRenderMobilePagerPane,
} from "../utils/mobilePager";

/**
 * Mobile chrome — no top header, a fixed bottom 5-tab nav, and a horizontal
 * pager for cross-tab swipes.
 *
 * Each tab is its OWN vertical scroll container. Horizontal finger-follow is
 * rAF-batched transform-only movement on the real adjacent pages.
 */
const TAB_HAPTIC_MS = 8;
const PAGER_SETTLE_MIN_MS = 360;
const PAGER_SETTLE_MAX_MS = 720;
const PAGER_DRAG_AXIS_LOCK_PX = 8;
const PAGER_DRAG_AXIS_RATIO = 1.12;
const PAGER_DRAG_DISTANCE_FRACTION = 0.18;
const PAGER_DRAG_MAX_DISTANCE_PX = 86;
const PAGER_DRAG_VELOCITY_PX_PER_MS = 0.38;
const PAGER_EDGE_RESISTANCE = 0.32;
const TAB_PREHEAT_DELAY_MS = 900;
const TAB_PREHEAT_IDLE_TIMEOUT_MS = 1600;

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

function getAllTabIndexes(count) {
  return Array.from({ length: Math.max(0, count) }, (_, idx) => idx);
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function settleDurationForDistance(distance, width) {
  const fraction = Math.min(1, Math.abs(distance) / Math.max(1, width));
  return Math.round(PAGER_SETTLE_MIN_MS + (PAGER_SETTLE_MAX_MS - PAGER_SETTLE_MIN_MS) * fraction);
}

function resistedPagerLeft(left, min, max) {
  if (left < min) return min + (left - min) * PAGER_EDGE_RESISTANCE;
  if (left > max) return max + (left - max) * PAGER_EDGE_RESISTANCE;
  return left;
}

function shouldSkipPagerDrag(target) {
  return !!target?.closest?.("input,textarea,select,[contenteditable='true'],[data-dropdown-menu]");
}

function getInnerSwipe(target) {
  return target?.closest?.("[data-mobile-inner-swipe='true']") || null;
}

function innerSwipeOwnsGesture(inner, dx) {
  if (dx < 0) return inner.dataset.swipeNext === "true";
  if (dx > 0) return inner.dataset.swipePrev === "true";
  return false;
}

function horizontalScrollerOwnsGesture(target, dx, stopAt) {
  let node = target;
  while (node && node !== stopAt && node.nodeType === 1) {
    const maxScroll = (node.scrollWidth || 0) - (node.clientWidth || 0);
    const overflowX = window.getComputedStyle?.(node)?.overflowX;
    const canScrollX = overflowX === "auto" || overflowX === "scroll" || overflowX === "overlay";
    if (canScrollX && maxScroll > 4) {
      if (dx < 0 && node.scrollLeft < maxScroll - 1) return true;
      if (dx > 0 && node.scrollLeft > 1) return true;
    }
    node = node.parentElement;
  }
  return false;
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
  const shellRef = useRef(null);
  const mainRef = useRef(null);
  const trackRef = useRef(null);
  const stripRef = useRef(null);
  const paneRefs = useRef({});
  const [visualTab, setVisualTab] = useState(tab);
  const [navTab, setNavTab] = useState(tab);
  const visualTabRef = useRef(tab);
  const navTabRef = useRef(tab);
  const [renderedTabs, setRenderedTabs] = useState(() => getMobilePagerRenderWindow(tab, tabCount));
  const renderedTabsRef = useRef(renderedTabs);
  const activePane = () => paneRefs.current[visualTabRef.current];
  const pagerSettleTimerRef = useRef(null);
  const pagerSettleFrameRef = useRef(0);
  const pagerSettleTargetRef = useRef(null);
  const pagerDragFrameRef = useRef(0);
  const pagerTouchActiveRef = useRef(false);
  const pagerTouchingRef = useRef(false);
  const pagerDragActiveNotifiedRef = useRef(false);
  const suppressClickUntilRef = useRef(0);
  const trackOffsetRef = useRef(0);
  const pendingTrackOffsetRef = useRef(null);
  const pagerWidthRef = useRef(1);
  const pagerGestureRef = useRef({ touching: false, current: tab, startLeft: tab });
  const renderTrimTimerRef = useRef(null);
  const preheatHandleRef = useRef(null);
  const preheatedAllTabsRef = useRef(false);
  const tabPropRef = useRef(tab);
  const lastHapticAt = useRef(0);
  const lastTabTap = useRef({ idx: -1, at: 0 });
  const recentPointerTabPressRef = useRef({});
  const pullY = refreshing ? 44 : 0;

  const measurePagerWidth = useCallback(() => {
    const width = trackRef.current?.clientWidth || mainRef.current?.clientWidth || window.innerWidth || 1;
    pagerWidthRef.current = width;
    return width;
  }, []);

  const applyTrackOffset = useCallback((left) => {
    trackOffsetRef.current = left;
    const strip = stripRef.current;
    if (strip) {
      strip.style.transform = `translate3d(${-left}px, 0, 0)`;
    }
  }, []);

  const setStripRef = useCallback((el) => {
    stripRef.current = el;
    if (el) el.style.transform = `translate3d(${-trackOffsetRef.current}px, 0, 0)`;
  }, []);

  const setTrackOffset = useCallback((left) => {
    applyTrackOffset(left);
  }, [applyTrackOffset]);

  const flushQueuedTrackOffset = useCallback(() => {
    if (pagerDragFrameRef.current) {
      cancelAnimationFrame(pagerDragFrameRef.current);
      pagerDragFrameRef.current = 0;
    }
    const pending = pendingTrackOffsetRef.current;
    pendingTrackOffsetRef.current = null;
    if (pending != null) applyTrackOffset(pending);
  }, [applyTrackOffset]);

  const queueTrackOffset = useCallback((left) => {
    trackOffsetRef.current = left;
    pendingTrackOffsetRef.current = left;
    if (pagerDragFrameRef.current) return;
    pagerDragFrameRef.current = requestAnimationFrame(() => {
      pagerDragFrameRef.current = 0;
      const pending = pendingTrackOffsetRef.current;
      pendingTrackOffsetRef.current = null;
      if (pending != null) applyTrackOffset(pending);
    });
  }, [applyTrackOffset]);

  const setPagerTouchingAttribute = useCallback((active) => {
    const shell = shellRef.current;
    if (shell) {
      if (active) shell.dataset.pagerTouching = "true";
      else delete shell.dataset.pagerTouching;
    }
  }, []);

  function scrollActiveToTop() {
    activePane()?.scrollTo?.({ top: 0, behavior: "smooth" });
  }

  const setRenderedWindow = useCallback((nextRenderedTabs) => {
    const normalizedTabs = preheatedAllTabsRef.current
      ? mergeTabWindows(renderedTabsRef.current, nextRenderedTabs)
      : nextRenderedTabs;
    if (sameTabWindow(normalizedTabs, renderedTabsRef.current)) return;
    renderedTabsRef.current = normalizedTabs;
    setRenderedTabs(normalizedTabs);
  }, []);

  const clearTabPreheat = useCallback(() => {
    const handle = preheatHandleRef.current;
    if (!handle) return;
    if (handle.type === "idle" && typeof window.cancelIdleCallback === "function") {
      window.cancelIdleCallback(handle.id);
    } else {
      clearTimeout(handle.id);
    }
    preheatHandleRef.current = null;
  }, []);

  const preheatAllTabs = useCallback(() => {
    if (preheatedAllTabsRef.current) return;
    preheatedAllTabsRef.current = true;
    startTransition(() => setRenderedWindow(getAllTabIndexes(tabCount)));
  }, [setRenderedWindow, tabCount]);

  const scheduleTabPreheat = useCallback((delay = TAB_PREHEAT_DELAY_MS) => {
    if (preheatedAllTabsRef.current || preheatHandleRef.current) return;
    const run = () => {
      preheatHandleRef.current = null;
      preheatAllTabs();
    };
    const scheduleIdle = () => {
      if (preheatedAllTabsRef.current || preheatHandleRef.current) return;
      if (typeof window.requestIdleCallback === "function") {
        preheatHandleRef.current = {
          type: "idle",
          id: window.requestIdleCallback(run, { timeout: TAB_PREHEAT_IDLE_TIMEOUT_MS }),
        };
      } else {
        preheatHandleRef.current = { type: "timeout", id: window.setTimeout(run, 250) };
      }
    };
    if (delay > 0) {
      preheatHandleRef.current = {
        type: "timeout",
        id: window.setTimeout(() => {
          preheatHandleRef.current = null;
          scheduleIdle();
        }, delay),
      };
      return;
    }
    scheduleIdle();
  }, [preheatAllTabs]);

  const commitVisualTab = useCallback((next, { renderedWindow = null } = {}) => {
    const clamped = Math.max(0, Math.min(tabCount - 1, next));
    const nextRenderedTabs = renderedWindow
      ? mergeTabWindows(renderedWindow)
      : getMobilePagerRenderWindow(clamped, tabCount);
    visualTabRef.current = clamped;
    navTabRef.current = clamped;

    setRenderedWindow(nextRenderedTabs);
    setVisualTab(clamped);
    setNavTab(clamped);
  }, [setRenderedWindow, tabCount]);

  const commitNavTab = useCallback((next) => {
    const clamped = clampTabIndex(next, tabCount);
    navTabRef.current = clamped;
    setNavTab(clamped);
  }, [tabCount]);

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
    if (pagerSettleFrameRef.current) {
      cancelAnimationFrame(pagerSettleFrameRef.current);
      pagerSettleFrameRef.current = 0;
    }
    pagerSettleTargetRef.current = null;
    if (pagerDragFrameRef.current) {
      cancelAnimationFrame(pagerDragFrameRef.current);
      pagerDragFrameRef.current = 0;
    }
    pendingTrackOffsetRef.current = null;
    if (renderTrimTimerRef.current) {
      clearTimeout(renderTrimTimerRef.current);
      renderTrimTimerRef.current = null;
    }
  }, []);

  const scheduleRenderedWindowTrim = useCallback((next, delay = 220) => {
    if (preheatedAllTabsRef.current) return;
    if (renderTrimTimerRef.current) clearTimeout(renderTrimTimerRef.current);
    const clamped = Math.max(0, Math.min(tabCount - 1, next));
    renderTrimTimerRef.current = setTimeout(() => {
      renderTrimTimerRef.current = null;
      if (preheatedAllTabsRef.current) return;
      if (pagerTouchActiveRef.current || pagerSettleTimerRef.current || pagerSettleFrameRef.current || visualTabRef.current !== clamped) return;
      setRenderedWindow(getMobilePagerRenderWindow(clamped, tabCount));
    }, delay);
  }, [setRenderedWindow, tabCount]);

  const finishPagerGesture = useCallback(() => {
    pagerGestureRef.current = {
      touching: false,
      current: visualTabRef.current,
      startLeft: trackOffsetRef.current,
    };
    pagerTouchActiveRef.current = false;
    pagerTouchingRef.current = false;
    setPagerTouchingAttribute(false);
    notifyPagerDragActive(false);
  }, [notifyPagerDragActive, setPagerTouchingAttribute]);

  const primePagerDragRendering = useCallback(() => {
    if (pagerTouchingRef.current) return;
    pagerTouchingRef.current = true;
    pagerTouchActiveRef.current = true;
    setPagerTouchingAttribute(true);
    notifyPagerDragActive(true);
  }, [notifyPagerDragActive, setPagerTouchingAttribute]);

  const completePagerFromOffset = useCallback(() => {
    if (pagerSettleTimerRef.current) {
      clearTimeout(pagerSettleTimerRef.current);
      pagerSettleTimerRef.current = null;
    }
    if (pagerSettleFrameRef.current) {
      cancelAnimationFrame(pagerSettleFrameRef.current);
      pagerSettleFrameRef.current = 0;
    }
    pagerSettleTargetRef.current = null;
    const width = measurePagerWidth();
    const left = trackOffsetRef.current;
    const clamped = clampTabIndex(Math.round(left / Math.max(1, width)), tabCount);
    commitVisualTab(clamped);
    alignTrackToTab(clamped);
    if (clamped !== tabPropRef.current) {
      tabPropRef.current = clamped;
      startTransition(() => setTab(clamped));
    }
    finishPagerGesture();
    scheduleRenderedWindowTrim(clamped);
  }, [alignTrackToTab, commitVisualTab, finishPagerGesture, measurePagerWidth, scheduleRenderedWindowTrim, setTab, tabCount]);

  const animatePagerToTab = useCallback((next) => {
    if (pagerSettleTimerRef.current) {
      clearTimeout(pagerSettleTimerRef.current);
      pagerSettleTimerRef.current = null;
    }
    if (pagerSettleFrameRef.current) {
      cancelAnimationFrame(pagerSettleFrameRef.current);
      pagerSettleFrameRef.current = 0;
    }
    const clamped = clampTabIndex(next, tabCount);
    const width = measurePagerWidth();
    const from = trackOffsetRef.current;
    const to = clamped * width;
    const distance = to - from;
    const current = visualTabRef.current;
    pagerSettleTargetRef.current = clamped;
    if (clamped !== current) {
      commitVisualTab(clamped, {
        renderedWindow: getMobilePagerJumpWindow(current, clamped, tabCount),
      });
    }
    if (Math.abs(distance) < 1) {
      setTrackOffset(to);
      completePagerFromOffset();
      return;
    }

    const duration = settleDurationForDistance(distance, width);
    const startedAt = performance.now();
    const step = (now) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const nextLeft = from + distance * easeOutCubic(progress);
      setTrackOffset(nextLeft);
      if (progress < 1) {
        pagerSettleFrameRef.current = requestAnimationFrame(step);
        return;
      }
      pagerSettleFrameRef.current = 0;
      setTrackOffset(to);
      completePagerFromOffset();
    };
    pagerSettleFrameRef.current = requestAnimationFrame(step);
  }, [commitVisualTab, completePagerFromOffset, measurePagerWidth, setTrackOffset, tabCount]);

  useLayoutEffect(() => {
    tabPropRef.current = tab;
    if (tab !== visualTabRef.current) commitVisualTab(tab);
    else if (tab !== navTabRef.current) commitNavTab(tab);
    alignTrackToTab(tab);
  }, [tab, alignTrackToTab, commitNavTab, commitVisualTab]);

  useLayoutEffect(() => {
    alignTrackToTab(visualTabRef.current);
  }, [alignTrackToTab, pullY]);

  useEffect(() => () => {
    clearPagerTimers();
    clearTabPreheat();
    setPagerTouchingAttribute(false);
    notifyPagerDragActive(false);
  }, [clearPagerTimers, clearTabPreheat, notifyPagerDragActive, setPagerTouchingAttribute]);

  useEffect(() => {
    scheduleTabPreheat();
    return clearTabPreheat;
  }, [clearTabPreheat, scheduleTabPreheat]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return undefined;

    const beginPagerTouch = (point = null, target = null, timeStamp = 0) => {
      const wasSettling = Boolean(pagerSettleFrameRef.current || pagerSettleTimerRef.current);
      const settlingLeft = trackOffsetRef.current;
      const settleTarget = wasSettling ? (pagerSettleTargetRef.current ?? visualTabRef.current) : null;
      clearPagerTimers();
      const width = measurePagerWidth();
      const { current, startLeft } = resolveMobilePagerTouchStart({
        visualTab: visualTabRef.current,
        trackLeft: settlingLeft,
        width,
        tabCount,
        settleTarget,
      });
      setTrackOffset(startLeft);
      pagerGestureRef.current = {
        touching: true,
        current,
        startLeft,
        x: point?.clientX ?? 0,
        y: point?.clientY ?? 0,
        lastX: point?.clientX ?? 0,
        lastAt: timeStamp || performance.now(),
        velocity: 0,
        target,
        mode: null,
      };
    };

    const beginOuterDrag = (gesture) => {
      flushQueuedTrackOffset();
      setTrackOffset(gesture.startLeft);
      suppressClickUntilRef.current = performance.now() + 450;
      primePagerDragRendering();
    };

    const endPagerTouch = (event) => {
      const mode = pagerGestureRef.current?.mode;
      if (mode === "outer") {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        const gesture = pagerGestureRef.current;
        flushQueuedTrackOffset();
        const width = pagerWidthRef.current || measurePagerWidth();
        const current = gesture.current ?? visualTabRef.current;
        const currentLeft = current * width;
        const left = trackOffsetRef.current;
        const delta = left - currentLeft;
        const threshold = Math.min(width * PAGER_DRAG_DISTANCE_FRACTION, PAGER_DRAG_MAX_DISTANCE_PX);
        const velocity = Number(gesture.velocity) || 0;
        const velocityDirection = velocity < 0 ? 1 : velocity > 0 ? -1 : 0;
        const distanceDirection = delta > 0 ? 1 : delta < 0 ? -1 : 0;
        const direction = Math.abs(velocity) > PAGER_DRAG_VELOCITY_PX_PER_MS
          ? velocityDirection
          : distanceDirection;
        const next = Math.abs(delta) >= threshold || Math.abs(velocity) > PAGER_DRAG_VELOCITY_PX_PER_MS
          ? clampTabIndex(current + direction, tabCount)
          : clampTabIndex(Math.round(left / Math.max(1, width)), tabCount);
        pagerGestureRef.current = {
          ...gesture,
          touching: false,
        };
        animatePagerToTab(next);
        return;
      }
      pagerGestureRef.current = {
        ...pagerGestureRef.current,
        touching: false,
      };
      flushQueuedTrackOffset();
      alignTrackToTab(visualTabRef.current);
    };

    const onPagerTouchStart = (event) => {
      if (event.touches.length === 1) beginPagerTouch(event.touches[0], event.target, event.timeStamp);
    };

    const onPagerTouchMove = (event) => {
      const gesture = pagerGestureRef.current;
      if (!gesture?.touching || event.touches.length !== 1 || shouldSkipPagerDrag(gesture.target)) return;
      const point = event.touches[0];
      const at = event.timeStamp || performance.now();
      const dx = point.clientX - gesture.x;
      const dy = point.clientY - gesture.y;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      const dt = Math.max(1, at - (gesture.lastAt || at));
      gesture.velocity = (point.clientX - (gesture.lastX ?? point.clientX)) / dt;
      gesture.lastX = point.clientX;
      gesture.lastAt = at;

      if (gesture.mode == null) {
        if (absX > PAGER_DRAG_AXIS_LOCK_PX && absX > absY * PAGER_DRAG_AXIS_RATIO) {
          const innerSwipe = getInnerSwipe(gesture.target);
          if (innerSwipe && innerSwipeOwnsGesture(innerSwipe, dx)) {
            gesture.mode = "inner";
            return;
          }
          if (!innerSwipe && horizontalScrollerOwnsGesture(gesture.target, dx, track)) {
            gesture.mode = "inner";
            return;
          }
          const direction = dx < 0 ? 1 : -1;
          const current = gesture.current ?? visualTabRef.current;
          const canOuterMove = (direction > 0 && current < tabCount - 1) || (direction < 0 && current > 0);
          gesture.mode = canOuterMove ? "outer" : "blocked";
          if (canOuterMove) beginOuterDrag(gesture);
        } else if (absY > PAGER_DRAG_AXIS_LOCK_PX || absX > PAGER_DRAG_AXIS_LOCK_PX) {
          gesture.mode = "vertical";
        } else {
          return;
        }
      }

      if (gesture.mode !== "outer") return;
      event.preventDefault();
      event.stopPropagation();
      const width = pagerWidthRef.current || measurePagerWidth();
      const maxLeft = Math.max(0, (tabCount - 1) * width);
      const nextLeft = resistedPagerLeft(gesture.startLeft - dx, 0, maxLeft);
      queueTrackOffset(nextLeft);
    };

    const suppressClickAfterDrag = (e) => {
      if (performance.now() <= suppressClickUntilRef.current) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    track.addEventListener("touchstart", onPagerTouchStart, { capture: true, passive: true });
    track.addEventListener("touchmove", onPagerTouchMove, { capture: true, passive: false });
    track.addEventListener("touchend", endPagerTouch, { capture: true, passive: false });
    track.addEventListener("touchcancel", endPagerTouch, { capture: true, passive: false });
    track.addEventListener("click", suppressClickAfterDrag, true);
    return () => {
      track.removeEventListener("touchstart", onPagerTouchStart, true);
      track.removeEventListener("touchmove", onPagerTouchMove, true);
      track.removeEventListener("touchend", endPagerTouch, true);
      track.removeEventListener("touchcancel", endPagerTouch, true);
      track.removeEventListener("click", suppressClickAfterDrag, true);
    };
  }, [
    animatePagerToTab,
    alignTrackToTab,
    clearPagerTimers,
    flushQueuedTrackOffset,
    measurePagerWidth,
    primePagerDragRendering,
    queueTrackOffset,
    setTrackOffset,
    tabCount,
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

  // Bottom-nav taps stay instant; finger drags move the real adjacent pages.
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
    const targetWindow = getMobilePagerRenderWindow(next, tabCount);
    commitVisualTab(next, { renderedWindow: targetWindow });
    alignTrackToTab(next);
    tabPropRef.current = next;
    startTransition(() => setTab(next));
    scheduleRenderedWindowTrim(next);
  }

  function activateTab(idx, at) {
    const current = visualTabRef.current;
    const prev = lastTabTap.current;
    lastTabTap.current = { idx, at };
    if (idx === current && prev.idx === idx && at - prev.at < 320) {
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
    if (idx !== current) {
      lastTabTap.current = { idx: -1, at: 0 };
      go(idx, { haptic: true, hapticAt: at });
    }
  }

  function onTabTap(idx, e) {
    const now = e?.timeStamp || 0;
    const recentPointerAt = recentPointerTabPressRef.current[idx] || 0;
    if (now - recentPointerAt < 750) {
      e?.preventDefault?.();
      return;
    }
    activateTab(idx, now);
  }

  function onTabPointerDown(idx, e) {
    if (e.pointerType === "mouse") return;
    const at = e.timeStamp || 0;
    recentPointerTabPressRef.current[idx] = at;
    e.preventDefault?.();
    activateTab(idx, at);
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
      ref={shellRef}
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
          touchAction: "pan-y",
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
            height: "100%",
            width: "100%",
            overflowX: "hidden",
            overflowY: "hidden",
            overscrollBehaviorX: "contain",
            scrollbarWidth: "none",
            touchAction: "pan-y",
            overflowAnchor: "none",
            backfaceVisibility: "hidden",
            willChange: refreshing ? "transform" : "auto",
            transform: refreshing ? `translate3d(0, ${pullY}px, 0)` : "none",
            transition: "none",
          }}>
          <div
            ref={setStripRef}
            className="ultreia-pager-strip"
            style={{
              position: "relative",
              height: "100%",
              width: `${tabCount * 100}%`,
              transition: "none",
              backfaceVisibility: "hidden",
              willChange: "auto",
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
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    left: `${idx * (100 / tabCount)}%`,
                    display: shouldShow ? "block" : "none",
                    width: `${100 / tabCount}%`,
                    height: "100%",
                    overflowY: "auto",
                    overflowX: "hidden",
                    // Keep vertical bounce local to each tab, but let horizontal
                    // gestures chain to the outer pager. The old shorthand also
                    // contained X, so inner pages could trap cross-tab swipes.
                    overscrollBehaviorX: "auto",
                    overscrollBehaviorY: "contain",
                    WebkitOverflowScrolling: "touch",
                    touchAction: "pan-y",
                    contain: "strict",
                    overflowAnchor: "none",
                    backfaceVisibility: "hidden",
                    // Horizontal movement is applied to the outer strip, so
                    // panes stay ordinary vertical scrollers.
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
        </div>
      </main>

      {/* Bottom tab bar */}
      <nav className="ultreia-mobile-bottom-nav" style={{
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
          const active = navTab === idx;
          const showSpinner = idx === 2 && coachBusy;
          return (
            <button
              key={key}
              onPointerDown={(e) => onTabPointerDown(idx, e)}
              onClick={(e) => onTabTap(idx, e)}
              style={{
                background: "transparent",
                border: "none",
                marginTop: 0,
                padding: "8px 4px 10px",
                minHeight: 64,
                fontFamily: "var(--font-sans)",
                fontSize: 12,
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
              <span className="ultreia-mobile-tab-icon" style={{
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
                transition: "none",
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
                color: active ? "var(--ink-1)" : "var(--ink-3)",
                fontWeight: active ? 600 : 500,
                transition: "none",
              }}>{t(key)}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
