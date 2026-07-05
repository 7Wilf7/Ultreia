import { memo, startTransition, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useT } from "../i18n/LanguageContext";
import { Spinner } from "./Spinner";
import { CalendarIcon, CoachIcon, FootIcon, SettingsIcon, TrophyIcon } from "./Icons";
import {
  getMobilePagerJumpWindow,
  getMobilePagerRenderWindow,
  mergeTabWindows,
  shouldOuterPagerHandleSwipe,
  shouldRenderMobilePagerPane,
} from "../utils/mobilePager";

/**
 * Mobile chrome — no top header, a fixed bottom 5-tab nav, and a compositor
 * transform pager for cross-tab swipes.
 *
 * Each tab is its OWN vertical scroll container. During horizontal finger
 * drag, the real adjacent panes move as one transform layer; React state and
 * tab ownership only update after the release animation finishes.
 */
const TAB_HAPTIC_MS = 8;
const PAGER_DRAG_START_PX = 4;
const PAGER_DRAG_AXIS_RATIO = 1.04;
const PAGER_RELEASE_DISTANCE_RATIO = 0.18;
const PAGER_RELEASE_VELOCITY = 0.30;
const PAGER_SETTLE_MIN_MS = 680;
const PAGER_SETTLE_MAX_MS = 1080;
const PAGER_SETTLE_EASING = "cubic-bezier(0.18, 0.78, 0.16, 1)";
const FROZEN_PREWARM_OPACITY = "0.001";

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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function settleDurationForDistance(distance, width) {
  const fraction = Math.min(1, Math.abs(distance) / Math.max(1, width));
  return Math.round(PAGER_SETTLE_MIN_MS + (PAGER_SETTLE_MAX_MS - PAGER_SETTLE_MIN_MS) * fraction);
}

function easeInOutSine(t) {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

function prefersReducedMotion() {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
  } catch {
    return false;
  }
}

function shouldSkipPagerSwipe(target) {
  return !!target?.closest?.("input,textarea,select,[contenteditable='true'],[data-dropdown-menu]");
}

function innerSwipeCanMove(target, direction) {
  const inner = target?.closest?.("[data-mobile-inner-swipe='true']");
  if (!inner) return false;
  return direction > 0
    ? inner.dataset.swipeNext === "true"
    : inner.dataset.swipePrev === "true";
}

function copyScrollPositions(source, clone) {
  clone.scrollTop = source.scrollTop || 0;
  clone.scrollLeft = source.scrollLeft || 0;
  const selector = ".ultreia-scroll-stable,[data-mobile-inner-swipe='true']";
  const sourceNodes = [...source.querySelectorAll(selector)];
  const cloneNodes = [...clone.querySelectorAll(selector)];
  sourceNodes.forEach((sourceNode, idx) => {
    const cloneNode = cloneNodes[idx];
    if (!cloneNode) return;
    cloneNode.scrollTop = sourceNode.scrollTop || 0;
    cloneNode.scrollLeft = sourceNode.scrollLeft || 0;
  });
}

function scrubFrozenClone(root) {
  root.setAttribute("aria-hidden", "true");
  root.setAttribute("inert", "");
  root.querySelectorAll("[id]").forEach(node => node.removeAttribute("id"));
  root.querySelectorAll("input, textarea, select, button, a").forEach(node => {
    node.setAttribute("tabindex", "-1");
  });
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
  const freezeLayerRef = useRef(null);
  const paneRefs = useRef({});
  const [visualTab, setVisualTab] = useState(tab);
  const visualTabRef = useRef(tab);
  const [renderedTabs, setRenderedTabs] = useState(() => getMobilePagerRenderWindow(tab, tabCount));
  const renderedTabsRef = useRef(renderedTabs);
  const activePane = () => paneRefs.current[visualTabRef.current];
  const pagerAnimationRef = useRef(null);
  const pagerAnimationFrameRef = useRef(0);
  const pagerDragFrameRef = useRef(0);
  const pagerDragRef = useRef(null);
  const pagerFreezeRef = useRef(null);
  const frozenPrewarmTimerRef = useRef(null);
  const frozenPrewarmIdleRef = useRef(null);
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

  const transformForOffset = useCallback((offset) => `translate3d(${offset}px, ${pullY}px, 0)`, [pullY]);

  const setTrackOffset = useCallback((left) => {
    trackOffsetRef.current = left;
    const track = trackRef.current;
    if (!track) return;
    track.style.transition = "none";
    track.style.transform = transformForOffset(left);
  }, [transformForOffset]);

  const cancelFrozenPrewarm = useCallback(() => {
    if (frozenPrewarmTimerRef.current) {
      clearTimeout(frozenPrewarmTimerRef.current);
      frozenPrewarmTimerRef.current = null;
    }
    if (frozenPrewarmIdleRef.current) {
      const cancelIdle = window.cancelIdleCallback || clearTimeout;
      cancelIdle(frozenPrewarmIdleRef.current);
      frozenPrewarmIdleRef.current = null;
    }
  }, []);

  const clearFrozenDragLayer = useCallback(() => {
    cancelFrozenPrewarm();
    const frozen = pagerFreezeRef.current;
    if (frozen?.animation) {
      frozen.animation.onfinish = null;
      frozen.animation.oncancel = null;
      try { frozen.animation.cancel(); } catch { /* animation cancel is best-effort */ }
    }
    pagerFreezeRef.current = null;
    const layer = freezeLayerRef.current;
    if (layer) {
      layer.dataset.state = "empty";
      layer.style.visibility = "hidden";
      layer.style.opacity = "0";
      layer.replaceChildren();
    }
    const track = trackRef.current;
    if (track) track.style.visibility = "visible";
  }, [cancelFrozenPrewarm]);

  const setFrozenOffset = useCallback((offset) => {
    const frozen = pagerFreezeRef.current;
    if (!frozen?.track) return;
    frozen.offset = offset;
    frozen.track.style.transition = "none";
    frozen.track.style.transform = transformForOffset(offset);
  }, [transformForOffset]);

  const buildFrozenDragLayer = useCallback((current, { visible = false } = {}) => {
    const layer = freezeLayerRef.current;
    const realTrack = trackRef.current;
    if (!layer || !realTrack) return null;

    const previous = pagerFreezeRef.current;
    if (previous?.animation) {
      previous.animation.onfinish = null;
      previous.animation.oncancel = null;
      try { previous.animation.cancel(); } catch { /* animation cancel is best-effort */ }
    }
    const width = measurePagerWidth();
    const height = mainRef.current?.clientHeight || realTrack.clientHeight || window.innerHeight || 1;
    const frozenTrack = document.createElement("div");
    frozenTrack.className = "ultreia-pager-freeze-track";
    Object.assign(frozenTrack.style, {
      display: "flex",
      width: `${width * 3}px`,
      height: `${height}px`,
      transform: transformForOffset(-width),
      willChange: "transform",
      backfaceVisibility: "hidden",
      contain: "strict",
    });

    const panes = new Map();
    [current - 1, current, current + 1].forEach((idx) => {
      const paneShell = document.createElement("div");
      paneShell.className = "ultreia-pager-freeze-pane";
      Object.assign(paneShell.style, {
        flex: `0 0 ${width}px`,
        width: `${width}px`,
        height: `${height}px`,
        overflow: "hidden",
        background: "var(--bg)",
        contain: "strict",
        backfaceVisibility: "hidden",
      });

      const source = idx >= 0 && idx < tabCount ? paneRefs.current[idx] : null;
      if (source) {
        const clone = source.cloneNode(true);
        clone.classList.add("ultreia-pager-frozen-clone");
        scrubFrozenClone(clone);
        Object.assign(clone.style, {
          width: `${width}px`,
          minWidth: `${width}px`,
          height: `${height}px`,
          pointerEvents: "none",
          userSelect: "none",
        });
        copyScrollPositions(source, clone);
        panes.set(idx, { source, clone });
        paneShell.appendChild(clone);
      }

      frozenTrack.appendChild(paneShell);
    });

    layer.replaceChildren(frozenTrack);
    layer.dataset.state = visible ? "active" : "prewarm";
    layer.style.visibility = "visible";
    layer.style.opacity = visible ? "1" : FROZEN_PREWARM_OPACITY;
    realTrack.style.visibility = visible ? "hidden" : "visible";
    const frozen = {
      current,
      width,
      track: frozenTrack,
      offset: -width,
      animation: null,
      active: visible,
      panes,
    };
    pagerFreezeRef.current = frozen;
    return frozen;
  }, [measurePagerWidth, tabCount, transformForOffset]);

  const activateFrozenDragLayer = useCallback((current) => {
    cancelFrozenPrewarm();
    let frozen = pagerFreezeRef.current;
    const width = measurePagerWidth();
    const layer = freezeLayerRef.current;
    const realTrack = trackRef.current;
    const canReuse = frozen
      && frozen.current === current
      && Math.abs(frozen.width - width) < 2
      && frozen.track?.isConnected;
    if (!canReuse) {
      frozen = buildFrozenDragLayer(current, { visible: false });
    }
    if (!frozen || !layer || !realTrack) return null;

    frozen.panes?.forEach(({ source, clone }) => {
      if (source?.isConnected && clone?.isConnected) copyScrollPositions(source, clone);
    });
    const activeFrozen = {
      ...frozen,
      offset: -frozen.width,
      active: true,
      animation: null,
    };
    pagerFreezeRef.current = activeFrozen;
    activeFrozen.track.style.transition = "none";
    activeFrozen.track.style.transform = transformForOffset(activeFrozen.offset);
    layer.dataset.state = "active";
    layer.style.visibility = "visible";
    layer.style.opacity = "1";
    realTrack.style.visibility = "hidden";
    return activeFrozen;
  }, [buildFrozenDragLayer, cancelFrozenPrewarm, measurePagerWidth, transformForOffset]);

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
    setTrackOffset(-clamped * width);
  }, [measurePagerWidth, setTrackOffset, tabCount]);

  const clearPagerTimers = useCallback(() => {
    if (pagerAnimationRef.current) {
      const animation = pagerAnimationRef.current;
      pagerAnimationRef.current = null;
      animation.onfinish = null;
      animation.oncancel = null;
      try { animation.cancel(); } catch { /* animation cancel is best-effort */ }
    }
    if (pagerFreezeRef.current?.animation) {
      const animation = pagerFreezeRef.current.animation;
      pagerFreezeRef.current.animation = null;
      animation.onfinish = null;
      animation.oncancel = null;
      try { animation.cancel(); } catch { /* animation cancel is best-effort */ }
    }
    if (pagerAnimationFrameRef.current) {
      cancelAnimationFrame(pagerAnimationFrameRef.current);
      pagerAnimationFrameRef.current = 0;
    }
    if (pagerDragFrameRef.current) {
      cancelAnimationFrame(pagerDragFrameRef.current);
      pagerDragFrameRef.current = 0;
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
      if (pagerDragRef.current || pagerAnimationRef.current || pagerAnimationFrameRef.current || pagerDragFrameRef.current || visualTabRef.current !== clamped) return;
      setRenderedWindow(getMobilePagerRenderWindow(clamped, tabCount));
    }, delay);
  }, [setRenderedWindow, tabCount]);

  const completePagerSettle = useCallback((next = visualTabRef.current) => {
    const clamped = clampTabIndex(next, tabCount);
    const hadFrozenLayer = !!pagerFreezeRef.current;
    pagerDragRef.current = null;
    flushSync(() => commitVisualTab(clamped));
    alignTrackToTab(clamped);
    if (hadFrozenLayer) clearFrozenDragLayer();
    if (clamped !== tabPropRef.current) {
      tabPropRef.current = clamped;
      startTransition(() => setTab(clamped));
    }
    notifyPagerDragActive(false);
    scheduleRenderedWindowTrim(clamped);
  }, [alignTrackToTab, clearFrozenDragLayer, commitVisualTab, notifyPagerDragActive, scheduleRenderedWindowTrim, setTab, tabCount]);

  const animateTrackToTab = useCallback((next) => {
    clearPagerTimers();
    const clamped = clampTabIndex(next, tabCount);
    const width = measurePagerWidth();
    const frozen = pagerFreezeRef.current;
    const from = frozen ? frozen.offset : trackOffsetRef.current;
    const to = frozen
      ? -frozen.width - (clamped - frozen.current) * frozen.width
      : -clamped * width;
    const distance = to - from;
    notifyPagerDragActive(true);

    if (Math.abs(distance) < 1 || prefersReducedMotion()) {
      if (frozen) setFrozenOffset(to);
      else setTrackOffset(to);
      completePagerSettle(clamped);
      return;
    }

    const duration = settleDurationForDistance(distance, width);
    const animatedTrack = frozen?.track || trackRef.current;
    if (animatedTrack && typeof animatedTrack.animate === "function") {
      const animation = animatedTrack.animate(
        [
          { transform: transformForOffset(from) },
          { transform: transformForOffset(to) },
        ],
        {
          duration,
          easing: PAGER_SETTLE_EASING,
          fill: "forwards",
        },
      );
      if (frozen) frozen.animation = animation;
      else pagerAnimationRef.current = animation;
      animation.onfinish = () => {
        if (frozen) {
          if (frozen.animation !== animation) return;
          frozen.animation = null;
          setFrozenOffset(to);
        } else {
          if (pagerAnimationRef.current !== animation) return;
          pagerAnimationRef.current = null;
          setTrackOffset(to);
        }
        completePagerSettle(clamped);
      };
      animation.oncancel = () => {
        if (frozen) {
          if (frozen.animation === animation) frozen.animation = null;
        } else if (pagerAnimationRef.current === animation) {
          pagerAnimationRef.current = null;
        }
      };
      return;
    }

    const startedAt = performance.now();
    const step = (now) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const nextOffset = from + distance * easeInOutSine(progress);
      if (frozen) setFrozenOffset(nextOffset);
      else setTrackOffset(nextOffset);
      if (progress < 1) {
        pagerAnimationFrameRef.current = requestAnimationFrame(step);
        return;
      }
      pagerAnimationFrameRef.current = 0;
      if (frozen) setFrozenOffset(to);
      else setTrackOffset(to);
      completePagerSettle(clamped);
    };
    pagerAnimationFrameRef.current = requestAnimationFrame(step);
  }, [clearPagerTimers, completePagerSettle, measurePagerWidth, notifyPagerDragActive, setFrozenOffset, setTrackOffset, tabCount, transformForOffset]);

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
    clearFrozenDragLayer();
  }, [clearFrozenDragLayer, clearPagerTimers]);

  const scheduleFrozenPrewarm = useCallback(() => {
    cancelFrozenPrewarm();
    frozenPrewarmTimerRef.current = setTimeout(() => {
      frozenPrewarmTimerRef.current = null;
      const run = () => {
        frozenPrewarmIdleRef.current = null;
        if (pagerDragRef.current || pagerAnimationRef.current || pagerAnimationFrameRef.current) return;
        if (pagerDragActiveNotifiedRef.current) return;
        buildFrozenDragLayer(visualTabRef.current, { visible: false });
      };
      if (typeof window.requestIdleCallback === "function") {
        frozenPrewarmIdleRef.current = window.requestIdleCallback(run, { timeout: 900 });
      } else {
        frozenPrewarmIdleRef.current = setTimeout(run, 120);
      }
    }, 220);
  }, [buildFrozenDragLayer, cancelFrozenPrewarm]);

  useEffect(() => {
    scheduleFrozenPrewarm();
    return cancelFrozenPrewarm;
  }, [cancelFrozenPrewarm, renderedTabs, scheduleFrozenPrewarm, tab, visualTab]);

  useEffect(() => {
    const main = mainRef.current;
    if (!main) return undefined;

    const releasePointerCapture = (pointerId) => {
      try {
        if (main.hasPointerCapture?.(pointerId)) main.releasePointerCapture(pointerId);
      } catch { /* pointer capture is best-effort */ }
    };

    const applyDragOffset = (drag, offset) => {
      if (drag.frozen) setFrozenOffset(offset);
      else setTrackOffset(offset);
    };

    const scheduleDragOffset = (drag, offset) => {
      drag.pendingOffset = offset;
      if (drag.frameId) return;
      drag.frameId = requestAnimationFrame(() => {
        if (pagerDragFrameRef.current === drag.frameId) pagerDragFrameRef.current = 0;
        drag.frameId = 0;
        applyDragOffset(drag, drag.pendingOffset);
      });
      pagerDragFrameRef.current = drag.frameId;
    };

    const flushDragOffset = (drag) => {
      if (!drag?.frameId) return;
      cancelAnimationFrame(drag.frameId);
      if (pagerDragFrameRef.current === drag.frameId) pagerDragFrameRef.current = 0;
      drag.frameId = 0;
      applyDragOffset(drag, drag.pendingOffset);
    };

    const onPagerPointerDown = (e) => {
      if ((e.pointerType && e.pointerType !== "touch" && e.pointerType !== "pen") || shouldSkipPagerSwipe(e.target)) {
        pagerDragRef.current = null;
        return;
      }
      clearPagerTimers();
      cancelFrozenPrewarm();
      const width = measurePagerWidth();
      const current = visualTabRef.current;
      const baseOffset = -current * width;
      setTrackOffset(baseOffset);
      pagerDragRef.current = {
        pointerId: e.pointerId,
        mode: null,
        target: e.target,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastAt: e.timeStamp || performance.now(),
        width,
        current,
        baseOffset,
        delta: 0,
        velocity: 0,
        pendingOffset: baseOffset,
        frameId: 0,
      };
    };

    const onPagerPointerMove = (e) => {
      const drag = pagerDragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      const samples = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : null;
      const point = samples?.length ? samples[samples.length - 1] : e;
      const dx = point.clientX - drag.startX;
      const dy = point.clientY - drag.startY;

      if (drag.mode === "pass" || drag.mode === "scroll") return;

      if (drag.mode == null) {
        if (Math.abs(dx) > Math.abs(dy) * PAGER_DRAG_AXIS_RATIO && Math.abs(dx) > PAGER_DRAG_START_PX) {
          const direction = dx < 0 ? 1 : -1;
          const canHandle = shouldOuterPagerHandleSwipe({
            direction,
            currentTab: drag.current,
            tabCount,
            innerCanMove: innerSwipeCanMove(e.target, direction),
          });
          if (!canHandle) {
            drag.mode = "pass";
            return;
          }
          drag.mode = "drag";
          suppressClickUntilRef.current = performance.now() + 450;
          try { main.setPointerCapture?.(drag.pointerId); } catch { /* pointer capture is best-effort */ }
          const frozen = activateFrozenDragLayer(drag.current);
          if (frozen) {
            drag.frozen = true;
            drag.freezeBaseOffset = -frozen.width;
          }
          notifyPagerDragActive(true);
        } else if (Math.abs(dy) > PAGER_DRAG_START_PX || Math.abs(dx) > PAGER_DRAG_START_PX) {
          drag.mode = "scroll";
          return;
        } else {
          return;
        }
      }

      if (drag.mode !== "drag") return;
      e.preventDefault?.();
      e.stopPropagation?.();

      const minDelta = drag.current < tabCount - 1 ? -drag.width : 0;
      const maxDelta = drag.current > 0 ? drag.width : 0;
      const now = e.timeStamp || performance.now();
      drag.delta = clamp(dx, minDelta, maxDelta);
      drag.velocity = (point.clientX - drag.lastX) / Math.max(1, now - drag.lastAt);
      drag.lastX = point.clientX;
      drag.lastAt = now;
      trackOffsetRef.current = drag.baseOffset + drag.delta;
      scheduleDragOffset(drag, drag.frozen ? drag.freezeBaseOffset + drag.delta : drag.baseOffset + drag.delta);
    };

    const settlePagerDrag = (e) => {
      const drag = pagerDragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      flushDragOffset(drag);
      releasePointerCapture(drag.pointerId);
      if (drag.mode !== "drag") {
        pagerDragRef.current = null;
        clearFrozenDragLayer();
        notifyPagerDragActive(false);
        return;
      }

      e?.preventDefault?.();
      e?.stopPropagation?.();
      suppressClickUntilRef.current = performance.now() + 450;
      const distanceThreshold = drag.width * PAGER_RELEASE_DISTANCE_RATIO;
      const velocityDirection = Math.abs(drag.velocity) >= PAGER_RELEASE_VELOCITY
        ? (drag.velocity < 0 ? 1 : -1)
        : 0;
      const distanceDirection = drag.delta < 0 ? 1 : drag.delta > 0 ? -1 : 0;
      const direction = velocityDirection || distanceDirection;
      const shouldCommit = direction !== 0
        && (Math.abs(drag.delta) >= distanceThreshold || Math.abs(drag.velocity) >= PAGER_RELEASE_VELOCITY);
      const next = shouldCommit ? clampTabIndex(drag.current + direction, tabCount) : drag.current;
      pagerDragRef.current = null;
      animateTrackToTab(next);
    };

    const cancelPointerGesture = (e) => {
      const drag = pagerDragRef.current;
      flushDragOffset(drag);
      if (drag) releasePointerCapture(drag.pointerId);
      if (drag?.mode === "drag") {
        e?.preventDefault?.();
        e?.stopPropagation?.();
        suppressClickUntilRef.current = performance.now() + 450;
        animateTrackToTab(drag.current);
        return;
      }
      pagerDragRef.current = null;
      clearFrozenDragLayer();
      notifyPagerDragActive(false);
    };

    const suppressClickAfterDrag = (e) => {
      if (performance.now() <= suppressClickUntilRef.current) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    main.addEventListener("pointerdown", onPagerPointerDown, { capture: true, passive: true });
    main.addEventListener("pointermove", onPagerPointerMove, { capture: true, passive: false });
    main.addEventListener("pointerrawupdate", onPagerPointerMove, { capture: true, passive: false });
    main.addEventListener("pointerup", settlePagerDrag, { capture: true, passive: false });
    main.addEventListener("pointercancel", cancelPointerGesture, { capture: true, passive: false });
    main.addEventListener("click", suppressClickAfterDrag, true);
    return () => {
      main.removeEventListener("pointerdown", onPagerPointerDown, true);
      main.removeEventListener("pointermove", onPagerPointerMove, true);
      main.removeEventListener("pointerrawupdate", onPagerPointerMove, true);
      main.removeEventListener("pointerup", settlePagerDrag, true);
      main.removeEventListener("pointercancel", cancelPointerGesture, true);
      main.removeEventListener("click", suppressClickAfterDrag, true);
    };
  }, [
    animateTrackToTab,
    activateFrozenDragLayer,
    cancelFrozenPrewarm,
    clearFrozenDragLayer,
    clearPagerTimers,
    measurePagerWidth,
    notifyPagerDragActive,
    setFrozenOffset,
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

  // Bottom-nav taps stay instant; finger drags use the transform path above.
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
    clearFrozenDragLayer();
    pagerDragRef.current = null;
    notifyPagerDragActive(false);
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
            display: "flex",
            height: "100%",
            width: "100%",
            overflow: "visible",
            touchAction: "pan-y",
            WebkitOverflowScrolling: "touch",
            overflowAnchor: "none",
            scrollbarWidth: "none",
            msOverflowStyle: "none",
            backfaceVisibility: "hidden",
            willChange: "transform",
            transform: `translate3d(${-visualTab * 100}%, ${pullY}px, 0)`,
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
                  overflowY: "auto",
                  overflowX: "hidden",
                  overscrollBehavior: "contain",
                  WebkitOverflowScrolling: "touch",
                  touchAction: "pan-y",
                  contain: "layout paint style",
                  overflowAnchor: "none",
                  backfaceVisibility: "hidden",
                  transform: "translateZ(0)",
                  willChange: shouldShow ? "transform" : "auto",
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
        <div
          ref={freezeLayerRef}
          className="ultreia-pager-freeze-layer"
          aria-hidden="true"
        />
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
