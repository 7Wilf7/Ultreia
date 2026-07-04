import { startTransition, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useT } from "../i18n/LanguageContext";
import { Spinner } from "./Spinner";
import { CalendarIcon, CoachIcon, FootIcon, SettingsIcon, TrophyIcon } from "./Icons";
import { getMobilePagerRenderWindow } from "../utils/mobilePager";

/**
 * Mobile chrome — no top header, a transform-only tab pager, fixed bottom
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
const TAB_HAPTIC_MS = 8;
const PAGER_INTENT_PX = 4;
const PAGER_VERTICAL_LOCK_PX = 7;
const PAGER_AXIS_RATIO = 1.06;
const PAGER_EDGE_RESISTANCE = 0.32;
const PAGER_RELEASE_DISTANCE_RATIO = 0.18;
const PAGER_RELEASE_VELOCITY_PX_MS = 0.42;
const PAGER_SETTLE_MS = 380;
const PAGER_SETTLE_EASING = "cubic-bezier(0.20, 0.88, 0.18, 1)";

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
  const dragFrameRef = useRef(0);
  const pendingTrackXRef = useRef(null);
  const trackXRef = useRef(0);
  const pagerTouchActiveRef = useRef(false);
  const pointerGestureRef = useRef(null);
  const tabPropRef = useRef(tab);
  const lastHapticAt = useRef(0);
  const lastTabTap = useRef({ idx: -1, at: 0 });
  const pointerDownRef = useRef({ idx: -1, at: 0, switched: false });
  const pullY = refreshing ? 44 : 0;
  const pullYRef = useRef(pullY);

  const measurePagerWidth = useCallback(() => {
    return trackRef.current?.clientWidth || mainRef.current?.clientWidth || window.innerWidth || 1;
  }, []);

  function scrollActiveToTop() {
    activePane()?.scrollTo?.({ top: 0, behavior: "smooth" });
  }

  const commitVisualTab = useCallback((next) => {
    const clamped = Math.max(0, Math.min(tabCount - 1, next));
    const nextRenderedTabs = getMobilePagerRenderWindow(clamped, tabCount);
    const renderedChanged = !sameTabWindow(nextRenderedTabs, renderedTabsRef.current);
    renderedTabsRef.current = nextRenderedTabs;
    visualTabRef.current = clamped;

    if (renderedChanged) setRenderedTabs(nextRenderedTabs);
    setVisualTab(clamped);
  }, [tabCount]);

  const applyTrackX = useCallback((x, transition = "none") => {
    const track = trackRef.current;
    if (!track) return;
    trackXRef.current = x;
    track.style.transition = transition;
    track.style.transform = `translate3d(${x}px, ${pullYRef.current}px, 0)`;
  }, []);

  const alignTrackToTab = useCallback((next, transition = "none") => {
    const clamped = Math.max(0, Math.min(tabCount - 1, next));
    applyTrackX(-clamped * measurePagerWidth(), transition);
  }, [applyTrackX, measurePagerWidth, tabCount]);

  const queueTrackX = useCallback((x) => {
    pendingTrackXRef.current = x;
    if (dragFrameRef.current) return;
    dragFrameRef.current = requestAnimationFrame(() => {
      dragFrameRef.current = 0;
      const nextX = pendingTrackXRef.current;
      pendingTrackXRef.current = null;
      if (typeof nextX === "number") applyTrackX(nextX);
    });
  }, [applyTrackX]);

  const finishPagerScroll = useCallback(() => {
    if (scrollSettleTimerRef.current) {
      clearTimeout(scrollSettleTimerRef.current);
      scrollSettleTimerRef.current = null;
    }
    const track = trackRef.current;
    if (track) delete track.dataset.dragging;
    pagerTouchActiveRef.current = false;
  }, []);

  const beginPagerDrag = useCallback((event) => {
    if (pagerTouchActiveRef.current) return;
    pagerTouchActiveRef.current = true;
    const track = trackRef.current;
    if (track) {
      track.dataset.dragging = "true";
      track.style.transition = "none";
    }
    try {
      if (event?.pointerId != null && track?.setPointerCapture) {
        track.setPointerCapture(event.pointerId);
      }
    } catch { /* pointer capture is best-effort */ }
  }, []);

  const completePagerSettle = useCallback((next) => {
    finishPagerScroll();
    commitVisualTab(next);
    alignTrackToTab(next);
    if (next !== tabPropRef.current) {
      tabPropRef.current = next;
      startTransition(() => setTab(next));
    }
  }, [alignTrackToTab, commitVisualTab, finishPagerScroll, setTab]);

  const settlePagerToTab = useCallback((next) => {
    if (scrollSettleTimerRef.current) {
      clearTimeout(scrollSettleTimerRef.current);
      scrollSettleTimerRef.current = null;
    }
    const clamped = Math.max(0, Math.min(tabCount - 1, next));
    alignTrackToTab(clamped, `transform ${PAGER_SETTLE_MS}ms ${PAGER_SETTLE_EASING}`);
    scrollSettleTimerRef.current = setTimeout(() => {
      scrollSettleTimerRef.current = null;
      completePagerSettle(clamped);
    }, PAGER_SETTLE_MS + 50);
  }, [alignTrackToTab, completePagerSettle, tabCount]);

  const onPagerPointerDown = useCallback((event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (!event.isPrimary) return;
    const width = measurePagerWidth();
    pointerGestureRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      lastX: event.clientX,
      lastAt: event.timeStamp || performance.now(),
      velocityX: 0,
      width,
      baseX: -visualTabRef.current * width,
      mode: "pending",
    };
    if (scrollSettleTimerRef.current) {
      clearTimeout(scrollSettleTimerRef.current);
      scrollSettleTimerRef.current = null;
    }
    alignTrackToTab(visualTabRef.current);
  }, [alignTrackToTab, measurePagerWidth]);

  const onPagerPointerMove = useCallback((event) => {
    const gesture = pointerGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId || gesture.mode === "scroll") return;

    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    if (gesture.mode === "pending" && absDx >= PAGER_INTENT_PX && absDx > absDy * PAGER_AXIS_RATIO) {
      gesture.mode = "page";
      beginPagerDrag(event);
    }
    if (gesture.mode === "pending" && absDy >= PAGER_VERTICAL_LOCK_PX && absDy > absDx * PAGER_AXIS_RATIO) {
      gesture.mode = "scroll";
      pointerGestureRef.current = null;
      return;
    }
    if (gesture.mode !== "page") return;

    if (event.cancelable) event.preventDefault();

    const now = event.timeStamp || performance.now();
    const dt = Math.max(1, now - gesture.lastAt);
    gesture.velocityX = (event.clientX - gesture.lastX) / dt;
    gesture.lastX = event.clientX;
    gesture.lastAt = now;

    const minX = -(tabCount - 1) * gesture.width;
    const maxX = 0;
    let nextX = gesture.baseX + dx;
    if (nextX > maxX) nextX = maxX + (nextX - maxX) * PAGER_EDGE_RESISTANCE;
    if (nextX < minX) nextX = minX + (nextX - minX) * PAGER_EDGE_RESISTANCE;
    queueTrackX(nextX);
  }, [beginPagerDrag, queueTrackX, tabCount]);

  const onPagerPointerEnd = useCallback((event) => {
    const gesture = pointerGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    pointerGestureRef.current = null;

    if (dragFrameRef.current) {
      cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = 0;
    }
    if (typeof pendingTrackXRef.current === "number") {
      applyTrackX(pendingTrackXRef.current);
      pendingTrackXRef.current = null;
    }

    if (gesture.mode !== "page") {
      finishPagerScroll();
      return;
    }

    const dx = event.clientX - gesture.x;
    const current = visualTabRef.current;
    const distanceThreshold = gesture.width * PAGER_RELEASE_DISTANCE_RATIO;
    let next = current;
    if (dx <= -distanceThreshold || gesture.velocityX <= -PAGER_RELEASE_VELOCITY_PX_MS) next = current + 1;
    if (dx >= distanceThreshold || gesture.velocityX >= PAGER_RELEASE_VELOCITY_PX_MS) next = current - 1;
    settlePagerToTab(Math.max(0, Math.min(tabCount - 1, next)));
  }, [applyTrackX, finishPagerScroll, settlePagerToTab, tabCount]);

  useLayoutEffect(() => {
    tabPropRef.current = tab;
    alignTrackToTab(tab);
    if (tab === visualTabRef.current) return undefined;
    const frame = requestAnimationFrame(() => commitVisualTab(tab));
    return () => cancelAnimationFrame(frame);
  }, [tab, alignTrackToTab, commitVisualTab]);

  useLayoutEffect(() => {
    pullYRef.current = pullY;
    alignTrackToTab(visualTabRef.current, refreshing ? REFRESH_SNAP_TRANSITION : "none");
  }, [alignTrackToTab, pullY, refreshing]);

  useEffect(() => () => {
    if (scrollSettleTimerRef.current) clearTimeout(scrollSettleTimerRef.current);
    if (dragFrameRef.current) cancelAnimationFrame(dragFrameRef.current);
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return undefined;
    track.addEventListener("pointerdown", onPagerPointerDown, { passive: true });
    track.addEventListener("pointermove", onPagerPointerMove, { passive: false });
    track.addEventListener("pointerup", onPagerPointerEnd, { passive: true });
    track.addEventListener("pointercancel", onPagerPointerEnd, { passive: true });
    return () => {
      track.removeEventListener("pointerdown", onPagerPointerDown);
      track.removeEventListener("pointermove", onPagerPointerMove);
      track.removeEventListener("pointerup", onPagerPointerEnd);
      track.removeEventListener("pointercancel", onPagerPointerEnd);
    };
  }, [onPagerPointerDown, onPagerPointerEnd, onPagerPointerMove]);

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

  // Jump to `next` tab. Bottom-nav taps stay instant; finger drags use the
  // transform-only pager above.
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
    commitVisualTab(next);
    alignTrackToTab(next);
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

        {/* Horizontal paging is imperative and transform-only while dragging:
            no React state changes on pointermove, so the finger-follow path
            stays on the compositor instead of re-rendering heavy tab DOM. */}
        <div
          ref={trackRef}
          className="ultreia-pager-track"
          style={{
          display: "flex",
          height: "100%",
          width: "100%",
          overflow: "visible",
          overscrollBehaviorX: "contain",
          touchAction: "pan-y",
          scrollbarWidth: "none",
          msOverflowStyle: "none",
          transform: `translate3d(${-visualTab * 100}%, ${pullY}px, 0)`,
          transition: refreshing ? REFRESH_SNAP_TRANSITION : "none",
          willChange: "transform",
          contain: "layout paint style",
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
                  contentVisibility: shouldRender ? "visible" : "hidden",
                  containIntrinsicSize: "100vw 100vh",
                  backfaceVisibility: "hidden",
                  transform: "translate3d(0, 0, 0)",
                  willChange: "transform",
                  pointerEvents: shouldRender ? "auto" : "none",
                  visibility: shouldRender ? "visible" : "hidden",
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
