import { useRef, useState } from "react";
import { useT } from "../i18n/LanguageContext";
import { Spinner } from "./Spinner";
import { CalendarIcon, CoachIcon, FootIcon, SettingsIcon, TrophyIcon } from "./Icons";

// Walk up from the touch target: if any ancestor is itself horizontally
// scrollable (charts, wide tables, the filter dropdown), a horizontal drag
// there belongs to that element — NOT a tab swipe. Lets us ignore those.
function inHorizontalScroller(node) {
  let el = node;
  while (el && el !== document.body) {
    if (el.scrollWidth > el.clientWidth + 4) {
      const ov = getComputedStyle(el).overflowX;
      if (ov === "auto" || ov === "scroll") return true;
    }
    el = el.parentElement;
  }
  return false;
}

/**
 * Mobile chrome — no top header, content slot, fixed bottom 5-tab nav.
 *
 * The 5th tab (idx=4) is "Settings" — a mobile-only page that holds what
 * used to live in the desktop top-right (profile, API, language, guide,
 * sign out). AppShell decides what to render in `children` based on `tab`.
 *
 * Layout uses 100dvh so the bottom bar sits above mobile browser chrome
 * (Safari URL bar collapse, Android nav bar). safe-area-inset-bottom
 * keeps labels above iPhone's home indicator in PWA standalone mode.
 *
 * `coachBusy` — when AI Coach has any in-flight request (chat send or plan
 * import), the AI Coach tab cell shows a small spinner badge. The state
 * lives in AppShell so it stays alive across tab switches.
 */
// Pull distance (px of finger travel) needed to trigger a refresh, and how far
// the indicator can stretch. Resistance makes the pull feel rubbery.
const PULL_TRIGGER = 70;
const PULL_MAX = 110;
const PULL_RESIST = 0.5;

export function MobileShell({ children, tab, setTab, coachBusy = false, onRefresh = null, refreshing = false }) {
  const t = useT();
  const mainRef = useRef(null);
  // Pull-to-refresh gesture state. pull = current indicator offset in px.
  const [pull, setPull] = useState(0);
  const pullState = useRef(null); // { startY } once a top-pull has engaged
  const pullRef = useRef(0);      // mirror of `pull` for the release-threshold check (avoids stale closure)
  function setPullPx(px) { pullRef.current = px; setPull(px); }
  // Double-tap the active Training tab to scroll its list back to the top.
  const lastTabTap = useRef({ idx: -1, at: 0 });

  function scrollMainToTop() {
    mainRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }

  const TABS = [
    { key: "tabs.training", idx: 0, Icon: FootIcon },
    { key: "tabs.calendar", idx: 1, Icon: CalendarIcon },
    { key: "tabs.races",    idx: 2, Icon: TrophyIcon },
    { key: "tabs.ai_coach", idx: 3, Icon: CoachIcon },
    { key: "tabs.settings", idx: 4, Icon: SettingsIcon },
  ];

  // ── Swipe between tabs ─────────────────────────────────────────────────
  // A clearly-horizontal drag on the content area switches to the adjacent
  // tab (left → next, right → prev). Thresholds are deliberately strict
  // (≥70px and horizontal at least 2× the vertical) so it never fights
  // vertical scrolling or a card tap. Drags that begin inside a horizontal
  // scroller are left alone (see inHorizontalScroller).
  const touch = useRef(null);
  // Direction of the last tab change — kept in STATE (not a ref) because the
  // wrapper reads it during render to pick the slide-in class, and refs can't
  // be read in render. Set in go() alongside setTab so both land in one render.
  const [slideDir, setSlideDir] = useState("right");
  function go(nextTab) {
    if (nextTab === tab) return;
    setSlideDir(nextTab > tab ? "right" : "left");
    setTab(nextTab);
  }
  function onTouchStart(e) {
    if (e.touches.length !== 1) { touch.current = null; pullState.current = null; setPullPx(0); return; }
    const p = e.touches[0];
    touch.current = { x: p.clientX, y: p.clientY, skip: inHorizontalScroller(e.target) };
    pullState.current = null;
    if (pullRef.current) setPullPx(0);
  }
  function onTouchMove(e) {
    if (!onRefresh || refreshing || e.touches.length !== 1) return;
    const st = touch.current;
    if (!st || st.skip) return;
    const y = e.touches[0].clientY;
    const atTop = (mainRef.current?.scrollTop || 0) <= 0;
    // Left the top (scrolled into history) → not a pull; drop any engaged pull.
    if (!atTop) {
      if (pullState.current) pullState.current = null;
      if (pullRef.current) setPullPx(0);
      return;
    }
    // At the top: arm on the first frame here (so a continuous up-then-down
    // gesture engages the moment the list reaches the latest record), then
    // track the downward drag from that baseline.
    if (!pullState.current) pullState.current = { startY: y };
    const dy = y - pullState.current.startY;
    if (dy > 0) setPullPx(Math.min(dy * PULL_RESIST, PULL_MAX));
    else { pullState.current.startY = y; if (pullRef.current) setPullPx(0); }
  }
  function onTouchEnd(e) {
    // Pull-to-refresh release.
    if (pullState.current) {
      const triggered = pullRef.current >= PULL_TRIGGER;
      pullState.current = null;
      setPullPx(0);
      if (triggered && onRefresh) { onRefresh(); return; }
    }
    const st = touch.current;
    touch.current = null;
    if (!st || st.skip) return;
    const p = e.changedTouches?.[0];
    if (!p) return;
    const dx = p.clientX - st.x;
    const dy = p.clientY - st.y;
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 2) return;
    if (dx < 0 && tab < TABS.length - 1) go(tab + 1);
    else if (dx > 0 && tab > 0) go(tab - 1);
  }

  // Tab tap: double-tapping the already-active Training tab scrolls its list to
  // the top (smooth). Other taps just switch tabs. Time comes from the event
  // (pure) rather than Date.now() so it's safe in component scope.
  function onTabTap(idx, e) {
    const now = e?.timeStamp ?? 0;
    const prev = lastTabTap.current;
    lastTabTap.current = { idx, at: now };
    if (idx === 0 && tab === 0 && prev.idx === 0 && now - prev.at < 320) {
      scrollMainToTop();
      return;
    }
    go(idx);
  }

  return (
    <div style={{
      // Lock the shell to exactly the viewport — no body-level scroll, no
      // rubber-band overscroll on tabs whose content already fits.
      height: "100dvh",
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
      background: "var(--bg)",
    }}>
      {/* ── Content slot ───────────────────────────────────────────────────
          flex: 1 takes the space between safe-area-top and the bottom nav.
          Tabs that overflow scroll INTERNALLY here (Training, Races);
          tabs that fit (Calendar, AI Coach, Settings) use height: 100%
          flex layouts and never overflow. overscroll-behavior: contain
          keeps drag gestures from bouncing the page. */}
      <main
        ref={mainRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        overflowX: "hidden",
        overscrollBehavior: "contain",
        WebkitOverflowScrolling: "touch",
        position: "relative",
        // Explicit background — without it the padding-top area is transparent
        // and on some mobile Chromium builds scrolled content can be seen
        // through it (the "thin gap above sticky" complaint).
        background: "var(--bg)",
        padding: "14px 14px 0",
        paddingTop: "max(env(safe-area-inset-top), 14px)",
        // Reserve room for the position: fixed bottom nav. The nav is ~66px
        // tall (icon + label), so 76px clears it with a ~10px gap — just
        // enough, no dead space. (The earlier "last line hidden" wasn't a
        // padding problem — it was the height:100% wrapper regression, fixed
        // separately; bumping this to 100px was a misdiagnosis that left a
        // ~34px gap at the bottom of every scrolled tab.)
        paddingBottom: "calc(76px + env(safe-area-inset-bottom))",
      }}>
        {/* Keyed by tab so each switch remounts + replays the slide-in.
            height:100% is applied ONLY to the AI Coach tab (idx 3): it must
            fill the slot so its provider pills + input row pin and only the
            message window scrolls internally. Every OTHER tab keeps its natural
            height — forcing height:100% on all tabs capped the wrapper at one
            viewport, so `main`'s scrollHeight never exceeded its clientHeight
            and the taller tabs (Settings, Calendar…) couldn't scroll at all.
            That was a regression; this restores their normal page scroll. */}
        {/* Pull-to-refresh indicator — sits above the content; the content
            wrapper shifts down by `pull` (or a fixed amount while refreshing)
            so the spinner peeks in from the top. */}
        {(pull > 0 || refreshing) && (
          <div style={{
            // Offset below the safe-area / front-camera cutout so the spinner
            // isn't hidden under it — sits down near the content's top controls.
            position: "absolute",
            top: "calc(max(env(safe-area-inset-top), 14px) + 8px)",
            left: 0, right: 0,
            height: refreshing ? 40 : pull,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "var(--ink-3)", pointerEvents: "none",
            transition: pull === 0 ? "height 0.2s ease" : "none",
          }}>
            {refreshing
              ? <Spinner size={18} thickness={2} color="var(--moss)" />
              : <span style={{
                  fontSize: 16,
                  transform: `rotate(${pull >= PULL_TRIGGER ? 180 : 0}deg)`,
                  transition: "transform 0.15s ease", opacity: Math.min(pull / PULL_TRIGGER, 1),
                }}>↓</span>}
          </div>
        )}
        <div key={tab} className={slideDir === "right" ? "ts-tab-in-right" : "ts-tab-in-left"}
          style={{
            height: tab === 3 ? "100%" : undefined,
            transform: refreshing ? "translateY(40px)" : (pull > 0 ? `translateY(${pull}px)` : undefined),
            transition: pull === 0 ? "transform 0.2s ease" : "none",
          }}>
          {children}
        </div>
      </main>

      {/* ── Bottom tab bar ─────────────────────────────────────────────────
          Fixed at viewport bottom. 5 equal cells. Active cell gets a top
          accent rule + ink-1 weight. */}
      <nav style={{
        position: "fixed", left: 0, right: 0, bottom: 0,
        zIndex: 20,
        background: "var(--bg-elevated)",
        borderTop: "1px solid var(--rule)",
        paddingBottom: "env(safe-area-inset-bottom)",
        display: "grid",
        gridTemplateColumns: "repeat(5, 1fr)",
      }}>
        {TABS.map(({ key, idx, Icon }) => {
          const active = tab === idx;
          const showSpinner = idx === 3 && coachBusy;
          return (
            <button
              key={key}
              onClick={(e) => onTabTap(idx, e)}
              style={{
                background: "transparent",
                border: "none",
                borderTop: active ? "2px solid var(--ink-1)" : "2px solid transparent",
                marginTop: -1,
                padding: "10px 4px 12px",
                minHeight: 64,
                fontFamily: "var(--font-sans)",
                fontSize: 13,
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
              }}
            >
              <span style={{
                position: "relative",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                color: active ? "var(--ink-1)" : "var(--ink-3)",
              }}>
                <Icon size={20} />
                {showSpinner && (
                  <span style={{
                    position: "absolute",
                    right: -10,
                    top: -6,
                    color: "var(--moss)",
                    background: "var(--bg-elevated)",
                    borderRadius: 8,
                    lineHeight: 0,
                  }}>
                    <Spinner size={11} thickness={1.4} color="var(--moss)" />
                  </span>
                )}
              </span>
              <span>{t(key)}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
