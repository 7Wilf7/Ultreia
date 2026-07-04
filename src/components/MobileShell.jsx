import { startTransition, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useT } from "../i18n/LanguageContext";
import { Spinner } from "./Spinner";
import { CalendarIcon, CoachIcon, FootIcon, SettingsIcon, TrophyIcon } from "./Icons";
import { getMobilePagerRenderWindow } from "../utils/mobilePager";

/**
 * Mobile chrome — no top header, a native scroll-snap tab pager, fixed bottom
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
const SCROLL_SETTLE_MS = 140;
const TAB_HAPTIC_MS = 8;

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
  const pagerTouchActiveRef = useRef(false);
  const tabPropRef = useRef(tab);
  const lastHapticAt = useRef(0);
  const lastTabTap = useRef({ idx: -1, at: 0 });
  const pointerDownRef = useRef({ idx: -1, at: 0, switched: false });

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

  const nearestScrollTab = useCallback(() => {
    const el = trackRef.current;
    if (!el) return visualTabRef.current;
    const width = measurePagerWidth();
    return Math.max(0, Math.min(tabCount - 1, Math.round(el.scrollLeft / width)));
  }, [measurePagerWidth, tabCount]);

  const scrollToTab = useCallback((next, behavior = "auto") => {
    const el = trackRef.current;
    if (!el) return;
    const width = measurePagerWidth();
    const left = Math.max(0, Math.min(tabCount - 1, next)) * width;
    if (Math.abs(el.scrollLeft - left) < 1) return;
    el.scrollTo({ left, behavior });
  }, [measurePagerWidth, tabCount]);

  const finishPagerScroll = useCallback(() => {
    if (scrollSettleTimerRef.current) {
      clearTimeout(scrollSettleTimerRef.current);
      scrollSettleTimerRef.current = null;
    }
    const track = trackRef.current;
    if (track) delete track.dataset.paging;
    pagerTouchActiveRef.current = false;

    const next = nearestScrollTab();
    commitVisualTab(next);
    if (next !== tabPropRef.current) {
      tabPropRef.current = next;
      startTransition(() => setTab(next));
    }
  }, [commitVisualTab, nearestScrollTab, setTab]);

  const scheduleScrollSettle = useCallback((delay = SCROLL_SETTLE_MS) => {
    if (scrollSettleTimerRef.current) clearTimeout(scrollSettleTimerRef.current);
    scrollSettleTimerRef.current = setTimeout(() => {
      scrollSettleTimerRef.current = null;
      finishPagerScroll();
    }, delay);
  }, [finishPagerScroll]);

  function onPagerTouchStart() {
    pagerTouchActiveRef.current = true;
    const track = trackRef.current;
    if (track) track.dataset.paging = "true";
    if (scrollSettleTimerRef.current) {
      clearTimeout(scrollSettleTimerRef.current);
      scrollSettleTimerRef.current = null;
    }
  }

  function onPagerTouchEnd() {
    pagerTouchActiveRef.current = false;
    scheduleScrollSettle(320);
  }

  useLayoutEffect(() => {
    tabPropRef.current = tab;
    scrollToTab(tab, "auto");
    if (tab === visualTabRef.current) return undefined;
    const frame = requestAnimationFrame(() => commitVisualTab(tab));
    return () => cancelAnimationFrame(frame);
  }, [tab, commitVisualTab, scrollToTab]);

  useEffect(() => () => {
    if (scrollSettleTimerRef.current) clearTimeout(scrollSettleTimerRef.current);
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return undefined;
    track.addEventListener("scrollend", finishPagerScroll, { passive: true });
    return () => track.removeEventListener("scrollend", finishPagerScroll);
  }, [finishPagerScroll]);

  const TABS = [
    { key: "tabs.training", idx: 0, Icon: FootIcon },
    { key: "tabs.calendar", idx: 1, Icon: CalendarIcon },
    { key: "tabs.ai_coach", idx: 2, Icon: CoachIcon },
    { key: "tabs.races",    idx: 3, Icon: TrophyIcon },
    { key: "tabs.settings", idx: 4, Icon: SettingsIcon },
  ];

  // Jump to `next` tab. Used by bottom-nav taps; drag itself is native scroll-snap.
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
    scrollToTab(next, "auto");
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

  const pullY = refreshing ? 44 : 0;

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

        {/* Native scroll-snap owns finger tracking; React only syncs the tab
            after the scroll has settled, so holding between panes stays smooth. */}
        <div
          ref={trackRef}
          className="ultreia-pager-track"
          onTouchStartCapture={onPagerTouchStart}
          onTouchEndCapture={onPagerTouchEnd}
          onTouchCancelCapture={onPagerTouchEnd}
          style={{
          display: "flex",
          height: "100%",
          width: "100%",
          overflowX: "auto",
          overflowY: "hidden",
          scrollSnapType: "x mandatory",
          scrollBehavior: "auto",
          overscrollBehaviorX: "contain",
          WebkitOverflowScrolling: "touch",
          touchAction: "pan-x pan-y",
          scrollbarWidth: "none",
          msOverflowStyle: "none",
          transform: pullY ? `translate3d(0, ${pullY}px, 0)` : "translate3d(0, 0, 0)",
          transition: refreshing ? REFRESH_SNAP_TRANSITION : "none",
          willChange: refreshing ? "transform" : undefined,
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
                  scrollSnapAlign: "start",
                  scrollSnapStop: "always",
                  overscrollBehavior: "contain",
                  WebkitOverflowScrolling: "touch",
                  touchAction: "pan-x pan-y",
                  contain: "layout paint style",
                  backfaceVisibility: "hidden",
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
