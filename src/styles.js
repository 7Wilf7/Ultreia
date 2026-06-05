import { TYPE_COLOR } from "./constants";

/**
 * Inline style tokens — kept centralized here so the whole UI shares one
 * vocabulary. Aesthetic: brutalist-minimal monochrome + low-sat moss accent
 * + topographic / instrument feel.
 *
 * Sharp corners (mostly), hairline rules, mono for numbers, generous
 * negative space. Borders carry the design instead of fills.
 */
export const s = {
  // --- Containers ---
  // Cards are bordered, not filled — feels like a field-notebook page.
  card: {
    background: "var(--bg-elevated)",
    border: "1px solid var(--rule)",
    borderRadius: 4,
    padding: "16px 18px",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.55)",
  },
  cardDark: {
    background: "var(--bg)",
    border: "1px solid var(--rule)",
    borderRadius: 4,
    padding: "16px 18px",
  },

  // --- Tags ---
  // Activity-type tag: solid block — stamp aesthetic. Uppercase is intentional
  // here because the tag acts as a categorical marker, not running text.
  tag: (t) => ({
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    background: TYPE_COLOR[t] || "var(--ink-2)",
    color: "var(--ink-inv)",
    borderRadius: 0,
    padding: "3px 9px",
    whiteSpace: "nowrap",
    fontWeight: 500,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  }),
  // Secondary tag: outlined chip for sub-types. Also stays uppercase as a marker.
  subTag: {
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    background: "transparent",
    color: "var(--ink-2)",
    border: "1px solid var(--rule)",
    borderRadius: 0,
    padding: "2px 8px",
    whiteSpace: "nowrap",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },

  // --- Typography roles ---
  // Field label — used for form-field captions, many of which are full
  // phrases ("Race Types You've Done (multi-select)"). UPPERCASE made those
  // long phrases hard to read, so labels now render in their source case.
  // Short categorical markers (activity-type tags, weekday headers, section
  // headers) keep their uppercase via their own styles (s.tag / s.subTag /
  // inline) — this only relaxes the field-label captions.
  label: {
    fontFamily: "var(--font-mono)",
    fontSize: 11.5,
    color: "var(--ink-3)",
    marginBottom: 6,
    letterSpacing: "0.01em",
  },
  // Section header — sentence case, weight contrast. No longer uppercase.
  section: {
    fontFamily: "var(--font-sans)",
    fontSize: 14,
    fontWeight: 600,
    color: "var(--ink-1)",
    marginBottom: 12,
    letterSpacing: "-0.005em",
  },
  muted: {
    fontFamily: "var(--font-sans)",
    fontSize: 13,
    color: "var(--ink-3)",
  },

  // Hero metric value — used for big stat readouts.
  metricVal: {
    fontFamily: "var(--font-mono)",
    fontSize: 30,
    fontWeight: 500,
    color: "var(--ink-1)",
    marginTop: 6,
    letterSpacing: "-0.02em",
    fontVariantNumeric: "tabular-nums",
    lineHeight: 1.1,
  },

  // Generic data number (mono, tabular).
  dataNum: {
    fontFamily: "var(--font-mono)",
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "-0.01em",
  },

  // --- Form controls ---
  input: {
    width: "100%",
    boxSizing: "border-box",
    border: "1px solid var(--rule)",
    borderRadius: 2,
    padding: "10px 12px",
    fontSize: 14,
    background: "var(--bg-elevated)",
    color: "var(--ink-1)",
    outline: "none",
    fontFamily: "var(--font-sans)",
    transition: "border-color 120ms",
  },

  // Primary action — solid ink, sharp edges, sentence case for readability.
  btn: {
    border: "1px solid var(--ink-1)",
    borderRadius: 2,
    padding: "9px 18px",
    fontSize: 13,
    background: "var(--ink-1)",
    color: "var(--ink-inv)",
    cursor: "pointer",
    fontWeight: 500,
    fontFamily: "var(--font-sans)",
    transition: "background-color 120ms, transform 80ms",
  },
  btnGhost: {
    border: "1px solid var(--rule)",
    borderRadius: 2,
    padding: "9px 16px",
    fontSize: 13,
    background: "transparent",
    color: "var(--ink-2)",
    cursor: "pointer",
    fontFamily: "var(--font-sans)",
    fontWeight: 500,
    transition: "border-color 120ms, color 120ms",
  },

  // --- Modal overlay + card ---
  // Shared style pair for fixed-overlay modals. On mobile (isMobile=true) the
  // card stretches to a full-screen page with safe-area padding; on desktop
  // it's a centered card with the given maxWidth. Use:
  //   <div style={s.modalOverlay(isMobile)}>
  //     <div style={s.modalCard(isMobile, { maxWidth: 600, bg: "..." })} ...>
  // `float` (opt): when true the modal is a centered floating card EVEN on
  // mobile (instead of the default full-screen page). Use for short, dialog-
  // like settings panels (profile, API keys, add-race, coach config) so they
  // don't swallow the whole screen. Reading-pane modals (guide) keep full bleed.
  modalOverlay: (isMobile, { float = false } = {}) => ({
    position: "fixed",
    top: 0, left: 0, right: 0, bottom: 0,
    background: "rgba(0,0,0,0.4)",
    display: "flex",
    alignItems: isMobile ? (float ? "center" : "stretch") : "flex-start",
    justifyContent: "center",
    // 9999 — well above MobileShell's fixed nav (20). Combined with the
    // ModalRoot portal (which moves the overlay to document.body, escaping
    // any ancestor stacking context), z-index conflicts are avoided.
    zIndex: 9999,
    padding: isMobile ? (float ? 16 : 0) : 20,
    // NB: no overflow here. The CARD scrolls internally (see modalCard).
    // Previously the overlay scrolled, which on some Chromium builds caused
    // the modal card to slide up and reveal the page underneath through
    // the semi-transparent backdrop. Card-internal scroll keeps the backdrop
    // anchored to the viewport at all times.
    overscrollBehavior: "contain",
    // Subtle backdrop blur + fade-in. Blur unifies the "second-level modal"
    // feel across the app (inbox already blurred); fade is via ts-overlay-in.
    backdropFilter: "blur(5px)",
    WebkitBackdropFilter: "blur(5px)",
    animation: "ts-overlay-in 0.16s ease-out",
  }),
  modalCard: (isMobile, { maxWidth = 600, bg = "var(--bg-elevated)", float = false } = {}) => {
    // Floating mobile card: behaves like the desktop centered card (border,
    // radius, shadow, capped height with internal scroll) instead of a
    // full-screen page. Desktop is unaffected by `float`.
    const floatMobile = isMobile && float;
    return {
      background: bg,
      border: floatMobile || !isMobile ? "1px solid var(--rule)" : "none",
      borderRadius: floatMobile ? 12 : (isMobile ? 0 : 4),
      boxShadow: floatMobile || !isMobile ? "0 10px 40px rgba(0,0,0,0.2)" : "none",
      width: "100%",
      maxWidth: (isMobile && !float) ? "none" : (floatMobile ? 460 : maxWidth),
      margin: (isMobile && !float) ? 0 : (floatMobile ? "auto" : "20px auto"),
      // Full-bleed mobile: fills the viewport. Floating mobile / desktop: sizes
      // to content, capped so it never exceeds the viewport (scrolls inside).
      height: (isMobile && !float) ? "100dvh" : "auto",
      maxHeight: (isMobile && !float) ? "100dvh" : (floatMobile ? "calc(100dvh - 32px)" : "calc(100dvh - 40px)"),
      overflowY: "auto",
      overscrollBehavior: "contain",
      WebkitOverflowScrolling: "touch",
      padding: (isMobile && !float)
        ? "calc(env(safe-area-inset-top) + 18px) 18px calc(env(safe-area-inset-bottom) + 24px)"
        : (floatMobile ? "20px 18px" : 24),
      boxSizing: "border-box",
      // Grow-in entrance (see index.css ts-modal-in).
      animation: "ts-modal-in 0.2s cubic-bezier(0.2,0.7,0.3,1)",
      transformOrigin: "center center",
    };
  },
  // Close button (the × in modal headers). Bumped tap target so it works
  // reliably on touch — desktop also benefits from a larger hit area.
  modalCloseBtn: {
    background: "none",
    border: "none",
    fontSize: 24,
    color: "var(--ink-3)",
    cursor: "pointer",
    padding: 0,
    width: 44,
    height: 44,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    marginRight: -10,
    marginTop: -10,
    lineHeight: 1,
  },

  // Chip — filter pills / mode toggles. Sentence case + sans, easier to scan.
  chip: (active) => ({
    border: "1px solid " + (active ? "var(--ink-1)" : "var(--rule)"),
    background: active ? "var(--ink-1)" : "transparent",
    color: active ? "var(--ink-inv)" : "var(--ink-2)",
    borderRadius: 2,
    padding: "6px 12px",
    fontSize: 13,
    cursor: "pointer",
    whiteSpace: "nowrap",
    flexShrink: 0,
    fontFamily: "var(--font-sans)",
    fontWeight: 500,
    transition: "background-color 120ms, border-color 120ms",
  }),
};

/**
 * Topographic SVG background — a thin contour line pattern. Use as a
 * subtle decoration on hero stat cards, hero numbers, etc. Renders as
 * an inline data URL so no asset is shipped.
 */
export const CONTOUR_BG = {
  backgroundImage:
    `url("data:image/svg+xml;utf8,${encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' width='200' height='80' viewBox='0 0 200 80'>
        <g fill='none' stroke='%23141413' stroke-width='0.4' opacity='0.06'>
          <path d='M-10 60 Q 40 20, 100 35 T 210 25'/>
          <path d='M-10 70 Q 50 30, 120 45 T 210 35'/>
          <path d='M-10 50 Q 30 10, 90 25 T 210 18'/>
          <path d='M-10 78 Q 60 45, 140 58 T 210 50'/>
        </g>
      </svg>`
    )}")`,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right -20px bottom -10px",
  backgroundSize: "260px 100px",
};
