import { TYPE_COLOR } from "./constants";

/**
 * Inline style tokens — kept centralized here so the whole UI shares one
 * vocabulary. Aesthetic: Linear-inspired dark product UI — precise hairlines,
 * translucent panels, restrained logo-moss focus, dense training data.
 */
export const s = {
  // --- Containers ---
  card: {
    background: "linear-gradient(180deg, var(--panel), var(--bg-elevated))",
    border: "1px solid var(--rule)",
    borderRadius: 8,
    padding: "16px 18px",
    boxShadow: "inset 0 1px 0 oklch(1 0 0 / 0.055)",
    backdropFilter: "blur(14px)",
    WebkitBackdropFilter: "blur(14px)",
  },
  cardDark: {
    background: "var(--panel)",
    border: "1px solid var(--rule)",
    borderRadius: 8,
    padding: "16px 18px",
    boxShadow: "inset 0 1px 0 oklch(1 0 0 / 0.045)",
  },

  // --- Tags ---
  // Activity-type tag: compact categorical marker.
  tag: (t) => ({
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    background: TYPE_COLOR[t] || "var(--ink-2)",
    color: "var(--ink-inv)",
    borderRadius: 6,
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
    borderRadius: 6,
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
    letterSpacing: 0,
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
    borderRadius: 8,
    padding: "10px 12px",
    fontSize: 14,
    background: "var(--panel-2)",
    color: "var(--ink-1)",
    outline: "none",
    fontFamily: "var(--font-sans)",
    transition: "border-color 160ms var(--ease-out), box-shadow 160ms var(--ease-out), background-color 160ms var(--ease-out)",
  },

  // Primary action — restrained accent, sentence case for readability.
  btn: {
    border: "1px solid var(--accent)",
    borderRadius: 8,
    padding: "9px 18px",
    fontSize: 13,
    background: "var(--accent)",
    color: "var(--bg-deep)",
    cursor: "pointer",
    fontWeight: 650,
    fontFamily: "var(--font-sans)",
    boxShadow: "0 0 0 1px oklch(1 0 0 / 0.04)",
    transition: "background-color 160ms var(--ease-out), border-color 160ms var(--ease-out), transform 80ms var(--ease-out)",
  },
  btnGhost: {
    border: "1px solid var(--rule)",
    borderRadius: 8,
    padding: "9px 16px",
    fontSize: 13,
    background: "var(--panel-2)",
    color: "var(--ink-2)",
    cursor: "pointer",
    fontFamily: "var(--font-sans)",
    fontWeight: 500,
    transition: "border-color 160ms var(--ease-out), color 160ms var(--ease-out), background-color 160ms var(--ease-out)",
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
    background: "oklch(0.04 0.006 274 / 0.72)",
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
    // feel across the app (inbox already blurred); fade is via ultreia-overlay-in.
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    animation: "ultreia-overlay-in 0.16s ease-out",
  }),
  modalCard: (isMobile, { maxWidth = 600, bg = "var(--panel)", float = false } = {}) => {
    // Floating mobile card: behaves like the desktop centered card (border,
    // radius, shadow, capped height with internal scroll) instead of a
    // full-screen page. Desktop is unaffected by `float`.
    const floatMobile = isMobile && float;
    return {
      background: bg,
      border: floatMobile || !isMobile ? "1px solid var(--rule)" : "none",
      borderRadius: floatMobile ? 12 : (isMobile ? 0 : 10),
      boxShadow: floatMobile || !isMobile ? "var(--shadow)" : "none",
      color: "var(--ink-1)",
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
      // Grow-in entrance (see index.css ultreia-modal-in).
      animation: "ultreia-modal-in 0.2s cubic-bezier(0.2,0.7,0.3,1)",
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
    border: "1px solid " + (active ? "var(--accent)" : "var(--rule)"),
    background: active ? "var(--accent-soft)" : "var(--panel-2)",
    color: active ? "var(--accent-dark)" : "var(--ink-2)",
    borderRadius: 8,
    padding: "6px 12px",
    fontSize: 13,
    cursor: "pointer",
    whiteSpace: "nowrap",
    flexShrink: 0,
    fontFamily: "var(--font-sans)",
    fontWeight: 500,
    transition: "background-color 160ms var(--ease-out), border-color 160ms var(--ease-out), color 160ms var(--ease-out)",
  }),
};

/**
 * Faint contour SVG background for training stat panels. Kept extremely subtle
 * so the app remains a product surface, not a decorative poster.
 */
export const CONTOUR_BG = {
  backgroundImage:
    `url("data:image/svg+xml;utf8,${encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' width='200' height='80' viewBox='0 0 200 80'>
        <g fill='none' stroke='%23f4f0ff' stroke-width='0.4' opacity='0.075'>
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
