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
 * Mobile chrome — no top header, a drag-preview tab pager, fixed bottom
 * 5-tab nav. Finger-follow moves a lightweight preview strip on the compositor
 * path; React only settles the selected tab after release.
 *
 * Each tab is its OWN scroll container. Only the active pane renders heavy
 * content; inactive panes can show lightweight previews so the drag path never
 * moves heavy DOM.
 *
 * `coachBusy` — when AI Coach has any in-flight request the AI Coach tab cell
 * shows a small spinner badge.
 */
const TAB_HAPTIC_MS = 8;
const PAGER_DRAG_INTENT_PX = 7;
const PAGER_DRAG_AXIS_RATIO = 1.12;
const PAGER_RELEASE_DISTANCE_RATIO = 0.18;
const PAGER_SETTLE_MIN_MS = 420;
const PAGER_SETTLE_MAX_MS = 620;
const PAGER_SETTLE_EASE = "cubic-bezier(0.22, 0.8, 0.2, 1)";
const PAGER_SKIP_SELECTOR = "button,input,textarea,select,a,[role='button'],[data-dropdown-menu],[data-no-pager-swipe]";

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

function clampTabIndex(idx, count) {
  return Math.max(0, Math.min(count - 1, idx));
}

function clampPagerOffset(left, width, count) {
  return Math.max(0, Math.min((count - 1) * width, left));
}

function shouldSkipPagerSwipe(target) {
  return !!target?.closest?.(PAGER_SKIP_SELECTOR);
}

function innerCanMoveForSwipe(target, direction) {
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
  const dragOverlayRef = useRef(null);
  const dragOverlayTrackRef = useRef(null);
  const paneRefs = useRef({});
  const [visualTab, setVisualTab] = useState(tab);
  const visualTabRef = useRef(tab);
  const [renderedTabs, setRenderedTabs] = useState(() => getMobilePagerRenderWindow(tab, tabCount));
  const renderedTabsRef = useRef(renderedTabs);
  const activePane = () => paneRefs.current[visualTabRef.current];
  const pagerSettleTimerRef = useRef(null);
  const trackOffsetRef = useRef(0);
  const pagerWidthRef = useRef(1);
  const renderTrimTimerRef = useRef(null);
  const pagerTouchActiveRef = useRef(false);
  const dragOverlayActiveRef = useRef(false);
  const pagerDragIntentRef = useRef({ x: 0, y: 0, dx: 0, target: null, mode: null });
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

  const setDragOverlayOffset = useCallback((left, { transition = "none" } = {}) => {
    trackOffsetRef.current = left;
    const overlayTrack = dragOverlayTrackRef.current;
    if (!overlayTrack) return;
    overlayTrack.style.transition = transition;
    overlayTrack.style.transform = `translate3d(${-left}px, 0, 0)`;
  }, []);

  const setDragOverlayMode = useCallback((active) => {
    const track = trackRef.current;
    const overlay = dragOverlayRef.current;
    dragOverlayActiveRef.current = active;
    if (active) {
      if (track) track.dataset.dragOverlay = "true";
      if (overlay) overlay.dataset.active = "true";
    } else {
      if (track) delete track.dataset.dragOverlay;
      if (overlay) delete overlay.dataset.active;
      const overlayTrack = dragOverlayTrackRef.current;
      if (overlayTrack) overlayTrack.style.transition = "none";
    }
  }, []);

  const alignTrackToTab = useCallback((next) => {
    const clamped = clampTabIndex(next, tabCount);
    const width = measurePagerWidth();
    setTrackOffset(clamped * width);
    setDragOverlayOffset(clamped * width);
  }, [measurePagerWidth, setDragOverlayOffset, setTrackOffset, tabCount]);

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

  const scheduleRenderedWindowTrim = useCallback((next, delay = 180) => {
    if (renderTrimTimerRef.current) clearTimeout(renderTrimTimerRef.current);
    const clamped = Math.max(0, Math.min(tabCount - 1, next));
    renderTrimTimerRef.current = setTimeout(() => {
      renderTrimTimerRef.current = null;
      if (pagerTouchActiveRef.current || pagerSettleTimerRef.current || visualTabRef.current !== clamped) return;
      setRenderedWindow(getMobilePagerRenderWindow(clamped, tabCount));
    }, delay);
  }, [setRenderedWindow, tabCount]);

  const finishPagerGesture = useCallback(() => {
    clearPagerTimers();
    pagerTouchActiveRef.current = false;
    setDragOverlayMode(false);
  }, [clearPagerTimers, setDragOverlayMode]);

  const completePagerSettle = useCallback((next) => {
    const clamped = clampTabIndex(next, tabCount);
    const width = measurePagerWidth();
    setDragOverlayOffset(clamped * width);
    flushSync(() => commitVisualTab(clamped));
    alignTrackToTab(clamped);
    if (clamped !== tabPropRef.current) {
      tabPropRef.current = clamped;
      startTransition(() => setTab(clamped));
    }
    finishPagerGesture();
  }, [alignTrackToTab, commitVisualTab, finishPagerGesture, measurePagerWidth, setDragOverlayOffset, setTab, tabCount]);

  const settlePagerToTab = useCallback((next) => {
    clearPagerTimers();
    const clamped = clampTabIndex(next, tabCount);
    const width = measurePagerWidth();
    const from = trackOffsetRef.current;
    const to = clamped * width;
    const distance = to - from;
    if (Math.abs(distance) < 1) {
      setDragOverlayOffset(to);
      completePagerSettle(clamped);
      return;
    }
    const duration = settleDurationForDistance(distance, width);
    setDragOverlayOffset(to, { transition: `transform ${duration}ms ${PAGER_SETTLE_EASE}` });
    pagerSettleTimerRef.current = setTimeout(() => {
      pagerSettleTimerRef.current = null;
      completePagerSettle(clamped);
    }, duration + 34);
  }, [clearPagerTimers, completePagerSettle, measurePagerWidth, setDragOverlayOffset, tabCount]);

  const settlePagerFromCurrentOffset = useCallback(() => {
    if (pagerSettleTimerRef.current) return true;
    const width = measurePagerWidth();
    const left = dragOverlayActiveRef.current
      ? trackOffsetRef.current
      : trackRef.current?.scrollLeft ?? trackOffsetRef.current;
    const currentLeft = visualTabRef.current * width;
    if (!pagerTouchActiveRef.current && Math.abs(left - currentLeft) < 1) return false;
    pagerTouchActiveRef.current = true;
    const delta = left - currentLeft;
    const threshold = width * PAGER_RELEASE_DISTANCE_RATIO;
    const current = visualTabRef.current;
    const next = delta >= threshold ? current + 1 : delta <= -threshold ? current - 1 : current;
    settlePagerToTab(clampTabIndex(next, tabCount));
    return true;
  }, [measurePagerWidth, settlePagerToTab, tabCount]);

  useLayoutEffect(() => {
    tabPropRef.current = tab;
    if (tab !== visualTabRef.current) commitVisualTab(tab);
    alignTrackToTab(tab);
  }, [tab, alignTrackToTab, commitVisualTab]);

  useLayoutEffect(() => {
    alignTrackToTab(visualTabRef.current);
  }, [alignTrackToTab, pullY]);

  const onPagerTouchEnd = useCallback(() => {
    const mode = pagerDragIntentRef.current.mode;
    if (mode === "pager") {
      const didSettle = settlePagerFromCurrentOffset();
      if (!didSettle) {
        pagerTouchActiveRef.current = false;
        setDragOverlayMode(false);
      }
      return;
    }
    const didSettle = settlePagerFromCurrentOffset();
    if (!didSettle) {
      pagerTouchActiveRef.current = false;
      setDragOverlayMode(false);
    }
  }, [setDragOverlayMode, settlePagerFromCurrentOffset]);

  const onPagerTouchStart = useCallback((event) => {
    clearPagerTimers();
    setDragOverlayMode(false);
    const width = measurePagerWidth();
    const current = visualTabRef.current;
    const currentLeft = current * width;
    setTrackOffset(currentLeft);
    setDragOverlayOffset(currentLeft);
    const touch = event.touches?.[0];
    pagerDragIntentRef.current = {
      x: touch?.clientX ?? 0,
      y: touch?.clientY ?? 0,
      dx: 0,
      target: event.target,
      mode: null,
    };
  }, [clearPagerTimers, measurePagerWidth, setDragOverlayMode, setDragOverlayOffset, setTrackOffset]);

  const updateDragOverlayFromDelta = useCallback((dx) => {
    const width = pagerWidthRef.current || measurePagerWidth();
    const currentLeft = visualTabRef.current * width;
    const left = clampPagerOffset(currentLeft - dx, width, tabCount);
    setDragOverlayOffset(left);
  }, [measurePagerWidth, setDragOverlayOffset, tabCount]);

  const onPagerTouchMove = useCallback((event) => {
    const st = pagerDragIntentRef.current;
    const touch = event.touches?.[0];
    if (!touch) return;
    const dx = touch.clientX - st.x;
    const dy = touch.clientY - st.y;
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);

    if (st.mode == null) {
      if (ax > ay * PAGER_DRAG_AXIS_RATIO && ax > PAGER_DRAG_INTENT_PX) {
        const direction = dx < 0 ? 1 : -1;
        const innerCanMove = innerCanMoveForSwipe(st.target, direction);
        const shouldHandle = !shouldSkipPagerSwipe(st.target) && shouldOuterPagerHandleSwipe({
          direction,
          currentTab: visualTabRef.current,
          tabCount,
          innerCanMove,
        });
        st.mode = shouldHandle ? hasDragPreview ? "pager" : "native" : "pass";
        if (shouldHandle) {
          if (!hasDragPreview) return;
          if (event.cancelable) event.preventDefault();
          event.stopPropagation();
          pagerTouchActiveRef.current = true;
          setDragOverlayMode(true);
          updateDragOverlayFromDelta(dx);
        } else {
          return;
        }
      } else if (ay > 6 || ax > 6) {
        st.mode = "scroll";
        return;
      } else {
        return;
      }
    }

    if (st.mode !== "pager") return;
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
    st.dx = dx;
    updateDragOverlayFromDelta(dx);
  }, [hasDragPreview, setDragOverlayMode, tabCount, updateDragOverlayFromDelta]);

  useEffect(() => () => {
    clearPagerTimers();
  }, [clearPagerTimers]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return undefined;
    track.addEventListener("touchstart", onPagerTouchStart, { capture: true, passive: true });
    track.addEventListener("touchmove", onPagerTouchMove, { capture: true, passive: false });
    track.addEventListener("touchend", onPagerTouchEnd, { capture: true, passive: true });
    track.addEventListener("touchcancel", onPagerTouchEnd, { capture: true, passive: true });
    return () => {
      track.removeEventListener("touchstart", onPagerTouchStart, true);
      track.removeEventListener("touchmove", onPagerTouchMove, true);
      track.removeEventListener("touchend", onPagerTouchEnd, true);
      track.removeEventListener("touchcancel", onPagerTouchEnd, true);
    };
  }, [onPagerTouchEnd, onPagerTouchMove, onPagerTouchStart]);

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
    setDragOverlayMode(false);
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

        {/* Horizontal paging keeps heavy panes still; finger-follow uses the
            lightweight drag overlay below. */}
        <div
          ref={trackRef}
          className="ultreia-pager-track"
          style={{
            display: "flex",
            height: "100%",
            width: "100%",
            overflowX: hasDragPreview ? "hidden" : "auto",
            overflowY: "hidden",
            overscrollBehaviorX: "contain",
            touchAction: hasDragPreview ? "pan-y" : "pan-x pan-y",
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

        {hasDragPreview && (
          <div
            ref={dragOverlayRef}
            className="ultreia-pager-drag-overlay"
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 9,
              overflow: "hidden",
              pointerEvents: "none",
              visibility: "hidden",
              opacity: 0,
              background: "var(--bg)",
              transform: refreshing ? `translate3d(0, ${pullY}px, 0)` : "none",
            }}
          >
            <div
              ref={dragOverlayTrackRef}
              className="ultreia-pager-drag-track"
              style={{
                display: "flex",
                height: "100%",
                width: "100%",
                willChange: "transform",
                backfaceVisibility: "hidden",
                transform: `translate3d(${-visualTab * 100}%, 0, 0)`,
                transition: "none",
              }}
            >
              {TABS.map(({ idx }) => (
                <div
                  key={idx}
                  className="ultreia-pager-drag-pane"
                  style={{
                    flex: "0 0 100%",
                    minWidth: "100%",
                    width: "100%",
                    height: "100%",
                    overflow: "hidden",
                    background: "var(--bg)",
                    padding: "14px 14px 0",
                    paddingTop: "max(env(safe-area-inset-top), 14px)",
                    paddingBottom: "calc(76px + env(safe-area-inset-bottom))",
                    contain: "layout paint style",
                    backfaceVisibility: "hidden",
                  }}
                >
                  <div className="ultreia-pager-preview-content">
                    {renderTabPreview(idx)}
                  </div>
                </div>
              ))}
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
