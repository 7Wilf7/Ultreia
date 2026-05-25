import { useT } from "../i18n/LanguageContext";

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
 */
export function MobileShell({ children, tab, setTab }) {
  const t = useT();

  const TABS = [
    { key: "tabs.training", idx: 0 },
    { key: "tabs.calendar", idx: 1 },
    { key: "tabs.races",    idx: 2 },
    { key: "tabs.ai_coach", idx: 3 },
    { key: "tabs.settings", idx: 4 },
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
        padding: "14px 14px 0",
        paddingTop: "max(env(safe-area-inset-top), 14px)",
        // Reserve room for the position: fixed bottom nav (~56px content
        // + safe-area). Tab content inside main lays out above this padding.
        paddingBottom: "calc(64px + env(safe-area-inset-bottom))",
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
        {TABS.map(({ key, idx }) => {
          const active = tab === idx;
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
                minHeight: 56,
                fontFamily: "var(--font-sans)",
                fontSize: 12,
                fontWeight: active ? 600 : 500,
                color: active ? "var(--ink-1)" : "var(--ink-3)",
                display: "flex", alignItems: "center", justifyContent: "center",
                borderRadius: 0,
                cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              {t(key)}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
