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
 * Mobile chrome — no top header, a native-scroll tab pager, fixed bottom 5-tab
 * nav. Finger-follow stays on the browser compositor path; React only settles
 * the selected tab after release.
 *
 * Each tab is its OWN scroll container. Only the active pane renders heavy
 * content; inactive panes can show lightweight previews so the native scroll
 * track never exposes a blank screen while we keep heavy DOM out of the drag
 * path.
 *
 * `coachBusy` — when AI Coach has any in-flight request the AI Coach tab cell
 * shows a small spinner badge.
 */
const REFRESH_SNAP_TRANSITION = "transform 300ms cubic-bezier(0.2,0.82,0.18,1)";
const TAB_HAPTIC_MS = 8;
const PAGER_DRAG_INTENT_PX = 7;
const PAGER_DRAG_AXIS_RATIO = 1.12;
const PAGER_RELEASE_DISTANCE_RATIO = 0.22;
const PAGER_SETTLE_MIN_MS = 760;
const PAGER_SETTLE_MAX_MS = 1320;

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

function clampTabIndex(idx, count) {
  return Math.max(0, Math.min(count - 1, idx));
}

const PagerPaneContent = memo(function PagerPaneContent({
  idx,
  renderTab,
}) {
  return (
    <div className="ultreia-pager-content-shell" data-full-pane="true">
      <div className="ultreia-pager-full-content">{renderTab(idx)}</div>
    </div>
  );
}, (prev, next) => next.freeze && prev.idx === next.idx);

const PagerPreviewPane = memo(function PagerPreviewPane({
  idx,
  renderTab,
  renderTabPreview,
}) {
  const preview = renderTabPreview ? renderTabPreview(idx) : renderTab(idx);
  return <div className="ultreia-pager-preview-content">{preview}</div>;
}, (prev, next) => next.freeze && prev.idx === next.idx);

export function MobileShell({ tab, setTab, coachBusy = false, renderTab, renderTabPreview = null, tabCount = 5, onRefresh = null, refreshing = false }) {
  const t = useT();
  const mainRef = useRef(null);
  const trackRef = useRef(null);
  const paneRefs = useRef({});
  const [visualTab, setVisualTab] = useState(tab);
  const visualTabRef = useRef(tab);
  const [renderedTabs, setRenderedTabs] = useState(() => getMobilePagerRenderWindow(tab, tabCount));
  const renderedTabsRef = useRef(renderedTabs);
  const [pagerDragFrozen, setPagerDragFrozen] = useState(false);
  const pagerDragFrozenRef = useRef(false);
  const activePane = () => paneRefs.current[visualTabRef.current];
  const scrollSettleFrameRef = useRef(0);
  const trackScrollLeftRef = useRef(0);
  const pagerWidthRef = useRef(1);
  const renderTrimTimerRef = useRef(null);
  const pagerTouchActiveRef = useRef(false);
  const pagerDragIntentRef = useRef({ x: 0, y: 0, dragging: false });
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
    const clamped = clampTabIndex(next, tabCount);
    const width = measurePagerWidth();
    setTrackScrollLeft(clamped * width);
  }, [measurePagerWidth, setTrackScrollLeft, tabCount]);

  const setPagerPreviewMode = useCallback((active) => {
    const track = trackRef.current;
    pagerDragIntentRef.current.dragging = active;
    if (pagerDragFrozenRef.current !== active) {
      pagerDragFrozenRef.current = active;
      setPagerDragFrozen(active);
    }
    if (!track) return;
    if (active) {
      track.dataset.dragging = "true";
    } else {
      delete track.dataset.dragging;
    }
  }, []);

  const clearPagerTimers = useCallback(() => {
    if (scrollSettleFrameRef.current) {
      cancelAnimationFrame(scrollSettleFrameRef.current);
      scrollSettleFrameRef.current = 0;
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
      if (pagerTouchActiveRef.current || scrollSettleFrameRef.current || visualTabRef.current !== clamped) return;
      setRenderedWindow(getMobilePagerRenderWindow(clamped, tabCount));
    }, delay);
  }, [setRenderedWindow, tabCount]);

  const finishPagerGesture = useCallback(() => {
    clearPagerTimers();
    pagerTouchActiveRef.current = false;
    setPagerPreviewMode(false);
  }, [clearPagerTimers, setPagerPreviewMode]);

  const completePagerSettle = useCallback((next) => {
    const clamped = clampTabIndex(next, tabCount);
    flushSync(() => commitVisualTab(clamped));
    alignTrackToTab(clamped);
    if (clamped !== tabPropRef.current) {
      tabPropRef.current = clamped;
      startTransition(() => setTab(clamped));
    }
    finishPagerGesture();
  }, [alignTrackToTab, commitVisualTab, finishPagerGesture, setTab, tabCount]);

  const settlePagerToTab = useCallback((next) => {
    clearPagerTimers();
    const clamped = clampTabIndex(next, tabCount);
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
    if (scrollSettleFrameRef.current) return true;
    const width = measurePagerWidth();
    const left = trackRef.current?.scrollLeft ?? trackScrollLeftRef.current;
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
    const frame = requestAnimationFrame(() => alignTrackToTab(tab));
    return () => cancelAnimationFrame(frame);
  }, [tab, alignTrackToTab, commitVisualTab]);

  useLayoutEffect(() => {
    alignTrackToTab(visualTabRef.current);
  }, [alignTrackToTab, pullY]);

  const onPagerTouchEnd = useCallback(() => {
    const didSettle = settlePagerFromNativeScroll();
    if (!didSettle) {
      pagerTouchActiveRef.current = false;
      setPagerPreviewMode(false);
    }
  }, [setPagerPreviewMode, settlePagerFromNativeScroll]);

  const onPagerTouchStart = useCallback((event) => {
    clearPagerTimers();
    const touch = event.touches?.[0];
    pagerDragIntentRef.current = {
      x: touch?.clientX ?? 0,
      y: touch?.clientY ?? 0,
      dragging: false,
    };
    setPagerPreviewMode(false);
  }, [clearPagerTimers, setPagerPreviewMode]);

  const onPagerTouchMove = useCallback((event) => {
    if (pagerDragIntentRef.current.dragging) return;
    const touch = event.touches?.[0];
    if (!touch) return;
    const dx = Math.abs(touch.clientX - pagerDragIntentRef.current.x);
    const dy = Math.abs(touch.clientY - pagerDragIntentRef.current.y);
    if (dx < PAGER_DRAG_INTENT_PX || dx < dy * PAGER_DRAG_AXIS_RATIO) return;
    pagerTouchActiveRef.current = true;
    setPagerPreviewMode(true);
  }, [setPagerPreviewMode]);

  useEffect(() => () => {
    clearPagerTimers();
  }, [clearPagerTimers]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return undefined;
    track.addEventListener("touchstart", onPagerTouchStart, { passive: true });
    track.addEventListener("touchmove", onPagerTouchMove, { passive: true });
    track.addEventListener("touchend", onPagerTouchEnd, { passive: true });
    track.addEventListener("touchcancel", onPagerTouchEnd, { passive: true });
    return () => {
      track.removeEventListener("touchstart", onPagerTouchStart);
      track.removeEventListener("touchmove", onPagerTouchMove);
      track.removeEventListener("touchend", onPagerTouchEnd);
      track.removeEventListener("touchcancel", onPagerTouchEnd);
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
    setPagerPreviewMode(false);
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
    return (
      <PagerPaneContent
        idx={idx}
        freeze={pagerDragFrozen}
        renderTab={renderTab}
      />
    );
  }

  function renderPreviewPane(idx) {
    return (
      <PagerPreviewPane
        idx={idx}
        freeze={pagerDragFrozen}
        renderTab={renderTab}
        renderTabPreview={renderTabPreview}
      />
    );
  }

  const activeShouldRender = shouldRenderMobilePagerPane(visualTab, renderedTabs, visualTab, tab);

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
          <div
            className="ultreia-pager-scroll-content"
            style={{ width: `${tabCount * 100}%` }}
          >
            <div className="ultreia-pager-preview-strip" aria-hidden="true">
              {TABS.map(({ idx }) => (
                <div
                  key={idx}
                  className="ultreia-pager-preview-pane"
                  style={{
                    flex: `0 0 ${100 / tabCount}%`,
                    width: `${100 / tabCount}%`,
                  }}
                >
                  {renderPreviewPane(idx)}
                </div>
              ))}
            </div>
            <div
              className="ultreia-pager-static-layer"
              aria-hidden={pagerDragFrozen}
              style={{
                width: `${100 / tabCount}%`,
                pointerEvents: pagerDragFrozen ? "none" : "auto",
              }}
            >
              <div
                ref={(el) => {
                  if (!el) {
                    delete paneRefs.current[visualTab];
                    return;
                  }
                  paneRefs.current[visualTab] = el;
                }}
                className="ultreia-pager-pane"
                data-rendered={activeShouldRender ? "true" : "false"}
                data-preview="false"
                aria-hidden={pagerDragFrozen}
                style={{
                  position: "relative",
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
                  isolation: "isolate",
                  visibility: activeShouldRender ? "visible" : "hidden",
                  background: "var(--bg)",
                  padding: "14px 14px 0",
                  paddingTop: "max(env(safe-area-inset-top), 14px)",
                  paddingBottom: "calc(76px + env(safe-area-inset-bottom))",
                }}>
                {renderPaneContent(visualTab, activeShouldRender)}
              </div>
            </div>
          </div>
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
