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
    borderRadius: 2,
    padding: "16px 18px",
  },
  cardDark: {
    background: "var(--bg)",
    border: "1px solid var(--rule)",
    borderRadius: 2,
    padding: "16px 18px",
  },

  // --- Tags ---
  // Activity-type tag: solid block, uppercase, mono — like a stamp.
  tag: (t) => ({
    fontFamily: "var(--font-mono)",
    fontSize: 10,
    background: TYPE_COLOR[t] || "var(--ink-2)",
    color: "var(--ink-inv)",
    borderRadius: 0,
    padding: "3px 8px",
    whiteSpace: "nowrap",
    fontWeight: 500,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  }),
  // Secondary tag: outlined chip for sub-types.
  subTag: {
    fontFamily: "var(--font-mono)",
    fontSize: 10,
    background: "transparent",
    color: "var(--ink-2)",
    border: "1px solid var(--rule)",
    borderRadius: 0,
    padding: "2px 7px",
    whiteSpace: "nowrap",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },

  // --- Typography roles ---
  // Field label: uppercase, mono, hint color — feels like a control panel.
  label: {
    fontFamily: "var(--font-mono)",
    fontSize: 10,
    color: "var(--ink-3)",
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },
  section: {
    fontFamily: "var(--font-sans)",
    fontSize: 11,
    fontWeight: 600,
    color: "var(--ink-1)",
    marginBottom: 12,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },
  muted: {
    fontFamily: "var(--font-sans)",
    fontSize: 12,
    color: "var(--ink-3)",
  },

  // Hero metric value — used for big stat readouts.
  metricVal: {
    fontFamily: "var(--font-mono)",
    fontSize: 28,
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
    padding: "9px 11px",
    fontSize: 13,
    background: "var(--bg-elevated)",
    color: "var(--ink-1)",
    outline: "none",
    fontFamily: "var(--font-sans)",
    transition: "border-color 120ms",
  },

  // Primary action — solid ink, hard edges, mono label.
  btn: {
    border: "1px solid var(--ink-1)",
    borderRadius: 2,
    padding: "9px 18px",
    fontSize: 11,
    background: "var(--ink-1)",
    color: "var(--ink-inv)",
    cursor: "pointer",
    fontWeight: 500,
    fontFamily: "var(--font-mono)",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    transition: "background-color 120ms, transform 80ms",
  },
  btnGhost: {
    border: "1px solid var(--rule)",
    borderRadius: 2,
    padding: "9px 16px",
    fontSize: 11,
    background: "transparent",
    color: "var(--ink-2)",
    cursor: "pointer",
    fontFamily: "var(--font-mono)",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    transition: "border-color 120ms, color 120ms",
  },

  // Chip — used for filter pills, mode toggles, etc.
  chip: (active) => ({
    border: "1px solid " + (active ? "var(--ink-1)" : "var(--rule)"),
    background: active ? "var(--ink-1)" : "transparent",
    color: active ? "var(--ink-inv)" : "var(--ink-2)",
    borderRadius: 2,
    padding: "5px 11px",
    fontSize: 10,
    cursor: "pointer",
    whiteSpace: "nowrap",
    flexShrink: 0,
    fontFamily: "var(--font-mono)",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
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
