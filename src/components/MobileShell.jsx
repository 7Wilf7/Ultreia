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
  shouldShowMobilePagerPane,
} from "../utils/mobilePager";

/**
 * Mobile chrome — no top header, a fixed bottom 5-tab nav, and a transform-only
 * drag layer for cross-tab swipes.
 *
 * Each tab is its OWN vertical scroll container. The real heavy panes stay
 * parked while the finger is down; the half-screen swipe preview is a separate
 * lightweight layer that moves with translate3d and never asks React to render
 * during touchmove.
 *
 * `coachBusy` — when AI Coach has any in-flight request the AI Coach tab cell
 * shows a small spinner badge.
 */
const TAB_HAPTIC_MS = 8;
const PAGER_DRAG_START_PX = 8;
const PAGER_DRAG_AXIS_RATIO = 1.08;
const PAGER_RELEASE_DISTANCE_RATIO = 0.22;
const PAGER_RELEASE_VELOCITY = 0.34;
const PAGER_SETTLE_MIN_MS = 320;
const PAGER_SETTLE_MAX_MS = 520;
const PAGER_SETTLE_EASING = "cubic-bezier(0.16, 1, 0.3, 1)";

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

const PagerPaneContent = memo(function PagerPaneContent({
  idx,
  shouldRender,
  shouldShow,
  isFullPane,
  renderTab,
  renderTabPreview,
}) {
  if (isFullPane) {
    return (
      <div
        className="ultreia-pager-content-shell"
        data-full-pane="true"
      >
        <div className="ultreia-pager-full-content">
          {renderTab(idx)}
        </div>
      </div>
    );
  }

  const content = renderTabPreview && shouldShow
    ? renderTabPreview(idx)
    : shouldRender
      ? renderTab(idx)
      : null;
  if (!content) return null;

  return (
    <div
      className="ultreia-pager-content-shell"
      data-full-pane="false"
    >
      <div className="ultreia-pager-preview-content">
        {content}
      </div>
    </div>
  );
});

export function MobileShell({ tab, setTab, coachBusy = false, renderTab, renderTabPreview = null, tabCount = 5, onRefresh = null, refreshing = false }) {
  const t = useT();
  const mainRef = useRef(null);
  const trackRef = useRef(null);
  const previewLayerRef = useRef(null);
  const previewStageRef = useRef(null);
  const paneRefs = useRef({});
  const [visualTab, setVisualTab] = useState(tab);
  const visualTabRef = useRef(tab);
  const [renderedTabs, setRenderedTabs] = useState(() => getMobilePagerRenderWindow(tab, tabCount));
  const renderedTabsRef = useRef(renderedTabs);
  const activePane = () => paneRefs.current[visualTabRef.current];
  const pagerAnimationTimerRef = useRef(null);
  const pagerDragFrameRef = useRef(0);
  const pagerDragRef = useRef(null);
  const trackOffsetRef = useRef(0);
  const pagerWidthRef = useRef(1);
  const renderTrimTimerRef = useRef(null);
  const tabPropRef = useRef(tab);
  const lastHapticAt = useRef(0);
  const lastTabTap = useRef({ idx: -1, at: 0 });
  const pointerDownRef = useRef({ idx: -1, at: 0, switched: false });
  const pullY = refreshing ? 44 : 0;
  const hasDragPreview = typeof renderTabPreview === "function";

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

  const commitVisualTab = useCallback((next, { renderedWindow = null } = {}) => {
    const clamped = Math.max(0, Math.min(tabCount - 1, next));
    const nextRenderedTabs = renderedWindow
      ? mergeTabWindows(renderedWindow)
      : getMobilePagerRenderWindow(clamped, tabCount);
    visualTabRef.current = clamped;

    setRenderedWindow(nextRenderedTabs);
    setVisualTab(clamped);
  }, [setRenderedWindow, tabCount]);

  const setTrackOffset = useCallback((left) => {
    trackOffsetRef.current = left;
    const track = trackRef.current;
    if (!track) return;
    track.scrollLeft = left;
  }, []);

  const setPreviewStageOffset = useCallback((delta = 0, transition = "none") => {
    const stage = previewStageRef.current;
    if (!stage) return;
    const width = measurePagerWidth();
    const left = -visualTabRef.current * width + delta;
    stage.style.transition = transition;
    stage.style.transform = `translate3d(${left}px, 0, 0)`;
  }, [measurePagerWidth]);

  const setPreviewLayerActive = useCallback((active) => {
    const layer = previewLayerRef.current;
    if (!layer) return;
    if (active) layer.dataset.active = "true";
    else delete layer.dataset.active;
  }, []);

  const alignTrackToTab = useCallback((next) => {
    const clamped = clampTabIndex(next, tabCount);
    const width = measurePagerWidth();
    setTrackOffset(clamped * width);
  }, [measurePagerWidth, setTrackOffset, tabCount]);

  const clearPagerTimers = useCallback(() => {
    if (pagerAnimationTimerRef.current) {
      clearTimeout(pagerAnimationTimerRef.current);
      pagerAnimationTimerRef.current = null;
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

  const scheduleRenderedWindowTrim = useCallback((next, delay = 180) => {
    if (renderTrimTimerRef.current) clearTimeout(renderTrimTimerRef.current);
    const clamped = Math.max(0, Math.min(tabCount - 1, next));
    renderTrimTimerRef.current = setTimeout(() => {
      renderTrimTimerRef.current = null;
      if (pagerDragRef.current || pagerAnimationTimerRef.current || visualTabRef.current !== clamped) return;
      setRenderedWindow(getMobilePagerRenderWindow(clamped, tabCount));
    }, delay);
  }, [setRenderedWindow, tabCount]);

  const finishPagerGesture = useCallback((next = visualTabRef.current) => {
    clearPagerTimers();
    pagerDragRef.current = null;
    setPreviewLayerActive(false);
    setPreviewStageOffset(0, "none");
    const clamped = clampTabIndex(next, tabCount);
    flushSync(() => commitVisualTab(clamped));
    alignTrackToTab(clamped);
    if (clamped !== tabPropRef.current) {
      tabPropRef.current = clamped;
      startTransition(() => setTab(clamped));
    }
    scheduleRenderedWindowTrim(clamped);
  }, [alignTrackToTab, clearPagerTimers, commitVisualTab, scheduleRenderedWindowTrim, setPreviewLayerActive, setPreviewStageOffset, setTab, tabCount]);

  const cancelPagerGesture = useCallback(() => {
    clearPagerTimers();
    pagerDragRef.current = null;
    setPreviewLayerActive(false);
    setPreviewStageOffset(0, "none");
  }, [clearPagerTimers, setPreviewLayerActive, setPreviewStageOffset]);

  useLayoutEffect(() => {
    tabPropRef.current = tab;
    if (tab !== visualTabRef.current) commitVisualTab(tab);
    alignTrackToTab(tab);
    setPreviewStageOffset(0, "none");
  }, [tab, alignTrackToTab, commitVisualTab, setPreviewStageOffset]);

  useLayoutEffect(() => {
    alignTrackToTab(visualTabRef.current);
    setPreviewStageOffset(0, "none");
  }, [alignTrackToTab, pullY, setPreviewStageOffset]);

  useEffect(() => () => {
    clearPagerTimers();
  }, [clearPagerTimers]);

  useEffect(() => {
    const main = mainRef.current;
    if (!main || !hasDragPreview) return undefined;

    const writeDragOffset = () => {
      pagerDragFrameRef.current = 0;
      const drag = pagerDragRef.current;
      if (!drag || drag.mode !== "drag") return;
      setPreviewStageOffset(drag.delta || 0, "none");
    };

    const queueDragOffset = () => {
      if (pagerDragFrameRef.current) return;
      pagerDragFrameRef.current = requestAnimationFrame(writeDragOffset);
    };

    const onPagerTouchStart = (e) => {
      if (e.touches.length !== 1 || shouldSkipPagerSwipe(e.target)) {
        pagerDragRef.current = null;
        return;
      }
      clearPagerTimers();
      const width = measurePagerWidth();
      const current = visualTabRef.current;
      alignTrackToTab(current);
      pagerDragRef.current = {
        mode: null,
        startX: e.touches[0].clientX,
        startY: e.touches[0].clientY,
        lastX: e.touches[0].clientX,
        lastAt: e.timeStamp || performance.now(),
        startAt: e.timeStamp || performance.now(),
        width,
        current,
        delta: 0,
      };
      setPreviewStageOffset(0, "none");
    };

    const onPagerTouchMove = (e) => {
      const drag = pagerDragRef.current;
      if (!drag || e.touches.length !== 1) return;
      const point = e.touches[0];
      const dx = point.clientX - drag.startX;
      const dy = point.clientY - drag.startY;

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
          setPreviewLayerActive(true);
        } else if (Math.abs(dy) > PAGER_DRAG_START_PX || Math.abs(dx) > PAGER_DRAG_START_PX) {
          drag.mode = "scroll";
          return;
        } else {
          return;
        }
      }

      if (drag.mode !== "drag") return;
      e.preventDefault();
      e.stopPropagation();

      const minDelta = drag.current < tabCount - 1 ? -drag.width : 0;
      const maxDelta = drag.current > 0 ? drag.width : 0;
      drag.delta = clamp(dx, minDelta, maxDelta);
      drag.lastX = point.clientX;
      drag.lastAt = e.timeStamp || performance.now();
      queueDragOffset();
    };

    const settlePagerDrag = (e) => {
      const drag = pagerDragRef.current;
      if (!drag) return;
      if (drag.mode !== "drag") {
        pagerDragRef.current = null;
        setPreviewLayerActive(false);
        setPreviewStageOffset(0, "none");
        return;
      }

      e?.preventDefault?.();
      e?.stopPropagation?.();
      if (pagerDragFrameRef.current) {
        cancelAnimationFrame(pagerDragFrameRef.current);
        pagerDragFrameRef.current = 0;
      }

      const dt = Math.max(1, (e?.timeStamp || performance.now()) - drag.startAt);
      const velocity = drag.delta / dt;
      const distanceThreshold = drag.width * PAGER_RELEASE_DISTANCE_RATIO;
      const direction = drag.delta < 0 ? 1 : drag.delta > 0 ? -1 : 0;
      const shouldCommit = direction !== 0
        && (Math.abs(drag.delta) >= distanceThreshold || Math.abs(velocity) >= PAGER_RELEASE_VELOCITY);
      const next = shouldCommit ? clampTabIndex(drag.current + direction, tabCount) : drag.current;
      const finalDelta = next === drag.current ? 0 : next > drag.current ? -drag.width : drag.width;
      const duration = settleDurationForDistance(finalDelta - drag.delta, drag.width);

      setPreviewStageOffset(drag.delta, "none");
      requestAnimationFrame(() => {
        setPreviewStageOffset(finalDelta, `transform ${duration}ms ${PAGER_SETTLE_EASING}`);
      });
      pagerAnimationTimerRef.current = setTimeout(() => {
        pagerAnimationTimerRef.current = null;
        finishPagerGesture(next);
      }, duration + 40);
    };

    main.addEventListener("touchstart", onPagerTouchStart, { capture: true, passive: true });
    main.addEventListener("touchmove", onPagerTouchMove, { capture: true, passive: false });
    main.addEventListener("touchend", settlePagerDrag, { capture: true, passive: false });
    main.addEventListener("touchcancel", cancelPagerGesture, { capture: true, passive: true });
    return () => {
      main.removeEventListener("touchstart", onPagerTouchStart, true);
      main.removeEventListener("touchmove", onPagerTouchMove, true);
      main.removeEventListener("touchend", settlePagerDrag, true);
      main.removeEventListener("touchcancel", cancelPagerGesture, true);
    };
  }, [
    alignTrackToTab,
    cancelPagerGesture,
    clearPagerTimers,
    finishPagerGesture,
    hasDragPreview,
    measurePagerWidth,
    setPreviewLayerActive,
    setPreviewStageOffset,
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
    { key: "tabs.races",    idx: 3, Icon: TrophyIcon },
    { key: "tabs.settings", idx: 4, Icon: SettingsIcon },
  ];

  // Jump to `next` tab. Bottom-nav taps stay instant; finger drags stay on the
  // lightweight preview path above.
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
    pagerDragRef.current = null;
    setPreviewLayerActive(false);
    const jumpWindow = getMobilePagerJumpWindow(current, next, tabCount);
    flushSync(() => commitVisualTab(next, { renderedWindow: jumpWindow }));
    alignTrackToTab(next);
    setPreviewStageOffset(0, "none");
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
    const isFullPane = shouldRender && (idx === visualTab || idx === tab);
    const shouldShow = hasDragPreview
      ? shouldRender
      : shouldShowMobilePagerPane(idx, renderedTabs, visualTab, tab, !!renderTabPreview);
    return (
      <PagerPaneContent
        idx={idx}
        shouldRender={shouldRender}
        shouldShow={shouldShow}
        isFullPane={isFullPane}
        renderTab={renderTab}
        renderTabPreview={renderTabPreview}
      />
    );
  }

  const previewTabs = getMobilePagerRenderWindow(visualTab, tabCount);

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

        {/* Horizontal paging uses the browser's native scroller over lightweight
            previews; the real heavy pane is hidden during horizontal drag. */}
        <div
          ref={trackRef}
          className="ultreia-pager-track"
          style={{
            display: "flex",
            height: "100%",
            width: "100%",
            overflowX: "hidden",
            overflowY: "hidden",
            overscrollBehaviorX: "contain",
            touchAction: "pan-y",
            scrollSnapType: "none",
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
            const shouldShow = hasDragPreview
              ? shouldRender
              : shouldShowMobilePagerPane(idx, renderedTabs, visualTab, tab, !!renderTabPreview);
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

        {hasDragPreview && (
          <div
            ref={previewLayerRef}
            className="ultreia-pager-preview-overlay"
            aria-hidden="true"
          >
            <div ref={previewStageRef} className="ultreia-pager-preview-stage">
              {TABS.map(({ idx }) => {
                const shouldShowPreview = shouldShowMobilePagerPane(
                  idx,
                  previewTabs,
                  visualTab,
                  tab,
                  false,
                );
                return (
                  <div
                    key={idx}
                    className="ultreia-pager-preview-pane"
                    style={{ visibility: shouldShowPreview ? "visible" : "hidden" }}
                  >
                    {shouldShowPreview ? renderTabPreview(idx) : null}
                  </div>
                );
              })}
            </div>
          </div>
        )}
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
