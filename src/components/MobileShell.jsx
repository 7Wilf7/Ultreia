import { memo, startTransition, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useT } from "../i18n/LanguageContext";
import { Spinner } from "./Spinner";
import { CalendarIcon, CoachIcon, FootIcon, SettingsIcon, TrophyIcon } from "./Icons";
import {
  getMobilePagerJumpWindow,
  getMobilePagerPreheatQueue,
  getMobilePagerRenderWindow,
  getMobilePagerTapWindow,
  mergeTabWindows,
  resolveMobilePagerTouchStart,
  shouldInnerPagerOwnSwipe,
  shouldReuseMobilePagerPane,
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
const TAB_PREHEAT_STEP_MS = 180;

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
  isActive,
}) {
  if (!shouldRender) return null;
  return (
    <div className="ultreia-pager-content-shell" data-full-pane="true">
      <div className="ultreia-pager-full-content">
        {renderTab(idx, isActive)}
      </div>
    </div>
  );
}, shouldReuseMobilePagerPane);

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
  const preheatHandleRef = useRef(null);
  const preheatedAllTabsRef = useRef(false);
  const tabPropRef = useRef(tab);
  const deferredAppTabFrameRef = useRef(0);
  const deferredAppTabRef = useRef(null);
  const deferredVisualTabFrameRef = useRef(0);
  const deferredVisualTabRef = useRef(null);
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
    // Once a pane has mounted, retain its local state and scroll position.
    // Hidden panes are isolated by PagerPaneContent's memo comparator.
    const normalizedTabs = mergeTabWindows(renderedTabsRef.current, nextRenderedTabs);
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
    const queue = getMobilePagerPreheatQueue(
      renderedTabsRef.current,
      visualTabRef.current,
      tabCount,
    );
    const mountNext = () => {
      preheatHandleRef.current = null;
      const next = queue.shift();
      if (next == null) return;
      startTransition(() => {
        setRenderedWindow([next]);
      });
      if (queue.length) {
        preheatHandleRef.current = {
          type: "timeout",
          id: window.setTimeout(mountNext, TAB_PREHEAT_STEP_MS),
        };
      }
    };
    mountNext();
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

  const commitVisualTabImmediately = useCallback((next, options) => {
    flushSync(() => {
      commitVisualTab(next, options);
    });
  }, [commitVisualTab]);

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

  const cancelDeferredAppTabCommit = useCallback(() => {
    if (deferredAppTabFrameRef.current) {
      cancelAnimationFrame(deferredAppTabFrameRef.current);
      deferredAppTabFrameRef.current = 0;
    }
    deferredAppTabRef.current = null;
  }, []);

  const commitAppTabNow = useCallback((next) => {
    cancelDeferredAppTabCommit();
    if (next === tabPropRef.current) return;
    tabPropRef.current = next;
    setTab(next);
  }, [cancelDeferredAppTabCommit, setTab]);

  const scheduleAppTabCommit = useCallback((next) => {
    cancelDeferredAppTabCommit();
    if (next === tabPropRef.current) return;
    deferredAppTabRef.current = next;
    // Let the locally committed pane and bottom-nav highlight paint first.
    deferredAppTabFrameRef.current = requestAnimationFrame(() => {
      deferredAppTabFrameRef.current = 0;
      const pending = deferredAppTabRef.current;
      deferredAppTabRef.current = null;
      if (pending == null || pending === tabPropRef.current) return;
      tabPropRef.current = pending;
      setTab(pending);
    });
  }, [cancelDeferredAppTabCommit, setTab]);

  const cancelDeferredVisualTabCommit = useCallback(() => {
    if (deferredVisualTabFrameRef.current) {
      cancelAnimationFrame(deferredVisualTabFrameRef.current);
      deferredVisualTabFrameRef.current = 0;
    }
    deferredVisualTabRef.current = null;
  }, []);

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
    cancelDeferredVisualTabCommit();
    cancelDeferredAppTabCommit();
  }, [cancelDeferredAppTabCommit, cancelDeferredVisualTabCommit]);

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
    commitAppTabNow(clamped);
    finishPagerGesture();
  }, [alignTrackToTab, commitAppTabNow, commitVisualTab, finishPagerGesture, measurePagerWidth, tabCount]);

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
    const pendingAppTab = deferredAppTabRef.current;
    if (pendingAppTab != null && tab !== tabPropRef.current && tab !== pendingAppTab) {
      cancelDeferredAppTabCommit();
    }
    const pendingVisualTab = deferredVisualTabRef.current?.next;
    if (pendingVisualTab != null && tab !== tabPropRef.current && tab !== pendingVisualTab) {
      cancelDeferredVisualTabCommit();
    }
    tabPropRef.current = tab;
    if (tab !== visualTabRef.current) commitVisualTab(tab);
    else if (tab !== navTabRef.current) commitNavTab(tab);
    alignTrackToTab(tab);
  }, [tab, alignTrackToTab, cancelDeferredAppTabCommit, cancelDeferredVisualTabCommit, commitNavTab, commitVisualTab]);

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

    const beginPagerPointer = (point = null, target = null, timeStamp = 0, pointerId = null) => {
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
        pointerId,
        mode: null,
      };
    };

    const beginOuterDrag = (gesture) => {
      flushQueuedTrackOffset();
      setTrackOffset(gesture.startLeft);
      suppressClickUntilRef.current = performance.now() + 450;
      primePagerDragRendering();
    };

    const endPagerPointer = (event) => {
      const gesture = pagerGestureRef.current;
      if (event?.pointerId != null && gesture?.pointerId != null && event.pointerId !== gesture.pointerId) return;
      const mode = pagerGestureRef.current?.mode;
      if (mode === "outer") {
        event?.stopPropagation?.();
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

    const onPagerPointerDown = (event) => {
      if (!event.isPrimary || event.pointerType === "mouse") return;
      beginPagerPointer(event, event.target, event.timeStamp, event.pointerId);
    };

    const onPagerPointerMove = (event) => {
      const gesture = pagerGestureRef.current;
      if (!gesture?.touching || event.pointerId !== gesture.pointerId || shouldSkipPagerDrag(gesture.target)) return;
      const point = event;
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
          if (innerSwipe && shouldInnerPagerOwnSwipe({
            swipeNext: innerSwipe.dataset.swipeNext,
            swipePrev: innerSwipe.dataset.swipePrev,
            dx,
          })) {
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

    // Pointer Events + touch-action: pan-y keep vertical scrolling on the
    // browser compositor. The previous non-passive touchmove listener made
    // Chromium/WebView wait for JavaScript before starting some scrolls.
    track.addEventListener("pointerdown", onPagerPointerDown, true);
    track.addEventListener("pointermove", onPagerPointerMove, true);
    track.addEventListener("pointerup", endPagerPointer, true);
    track.addEventListener("pointercancel", endPagerPointer, true);
    track.addEventListener("click", suppressClickAfterDrag, true);
    return () => {
      track.removeEventListener("pointerdown", onPagerPointerDown, true);
      track.removeEventListener("pointermove", onPagerPointerMove, true);
      track.removeEventListener("pointerup", endPagerPointer, true);
      track.removeEventListener("pointercancel", endPagerPointer, true);
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
    const targetWindow = getMobilePagerTapWindow(current, next, tabCount);
    const targetReady = shouldRenderMobilePagerPane(
      next,
      renderedTabsRef.current,
      visualTabRef.current,
      tabPropRef.current,
    );
    if (targetReady) {
      commitVisualTabImmediately(next, { renderedWindow: targetWindow });
      alignTrackToTab(next);
      scheduleAppTabCommit(next);
      return;
    }

    // Cold tabs can mount a full page of work. Commit the nav highlight
    // synchronously, then switch the page on the next frame without an extra
    // timer so the real tab change stays close to the tap.
    flushSync(() => {
      commitNavTab(next);
    });
    deferredVisualTabRef.current = { next, renderedWindow: targetWindow };
    deferredVisualTabFrameRef.current = requestAnimationFrame(() => {
      deferredVisualTabFrameRef.current = 0;
      const pending = deferredVisualTabRef.current;
      deferredVisualTabRef.current = null;
      if (!pending) return;
      const target = clampTabIndex(pending.next, tabCount);
      if (target !== visualTabRef.current) {
        commitVisualTabImmediately(target, { renderedWindow: pending.renderedWindow });
      } else if (target !== navTabRef.current) {
        commitNavTab(target);
      }
      alignTrackToTab(target);
      scheduleAppTabCommit(target);
    });
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
    if (recentPointerAt && now - recentPointerAt < 750) {
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
    const isActive = idx === visualTab;
    return (
      <PagerPaneContent
        idx={idx}
        shouldRender={shouldRender}
        isActive={isActive}
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
