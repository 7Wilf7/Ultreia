import { useT } from "../i18n/LanguageContext";
import { Spinner } from "./Spinner";
import { CalendarIcon, CoachIcon, FootIcon, SettingsIcon, TrophyIcon } from "./Icons";

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
export function MobileShell({ children, tab, setTab, coachBusy = false }) {
  const t = useT();

  const TABS = [
    { key: "tabs.training", idx: 0, Icon: FootIcon },
    { key: "tabs.calendar", idx: 1, Icon: CalendarIcon },
    { key: "tabs.races",    idx: 2, Icon: TrophyIcon },
    { key: "tabs.ai_coach", idx: 3, Icon: CoachIcon },
    { key: "tabs.settings", idx: 4, Icon: SettingsIcon },
  ];

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
      <main style={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        overflowX: "hidden",
        overscrollBehavior: "contain",
        WebkitOverflowScrolling: "touch",
        // Explicit background — without it the padding-top area is transparent
        // and on some mobile Chromium builds scrolled content can be seen
        // through it (the "thin gap above sticky" complaint).
        background: "var(--bg)",
        padding: "14px 14px 0",
        paddingTop: "max(env(safe-area-inset-top), 14px)",
        // Reserve room for the position: fixed bottom nav (~64px content
        // + safe-area). Tab content inside main lays out above this padding.
        paddingBottom: "calc(76px + env(safe-area-inset-bottom))",
      }}>
        {children}
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
              onClick={() => setTab(idx)}
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
