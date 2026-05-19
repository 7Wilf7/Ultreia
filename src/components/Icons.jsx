/**
 * Tiny stroke-only inline SVG icon set. Keeps the bundle clean (no icon-lib
 * dependency) and lets us colour-by-CSS via `currentColor`.
 *
 * All icons are 14×14 viewBox, 1.5px stroke, rounded caps — visually consistent.
 * Use as <ClockIcon size={14} /> inside a <span style={{ color: ... }}>.
 */

const baseProps = (size) => ({
  width: size,
  height: size,
  viewBox: "0 0 14 14",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  style: { flexShrink: 0, display: "inline-block", verticalAlign: "-2px" },
});

export function ClockIcon({ size = 13 }) {
  return (
    <svg {...baseProps(size)}>
      <circle cx="7" cy="7" r="5" />
      <path d="M7 4.5 V7 L8.7 8.2" />
    </svg>
  );
}

// Heart — filled, since HR is a readout
export function HeartIcon({ size = 13 }) {
  return (
    <svg {...baseProps(size)} fill="currentColor" stroke="none">
      <path d="M7 11.2 C 4 9 1.8 7.3 1.8 5.2 C 1.8 3.7 3 2.7 4.2 2.7 C 5.2 2.7 6.2 3.3 7 4.4 C 7.8 3.3 8.8 2.7 9.8 2.7 C 11 2.7 12.2 3.7 12.2 5.2 C 12.2 7.3 10 9 7 11.2 Z" />
    </svg>
  );
}

// Mountain peak — used for ascent (already paired with ▲ in some places)
export function PeakIcon({ size = 13 }) {
  return (
    <svg {...baseProps(size)}>
      <path d="M1.5 11.5 L5 5.5 L7 8.5 L9 4 L12.5 11.5 Z" />
    </svg>
  );
}

// Footstep / shoe sole — used for cadence
export function FootIcon({ size = 13 }) {
  return (
    <svg {...baseProps(size)}>
      <ellipse cx="6" cy="7" rx="2.7" ry="4" />
      <circle cx="10.2" cy="3.5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="11.5" cy="5.2" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="11.8" cy="7.2" r="0.7" fill="currentColor" stroke="none" />
    </svg>
  );
}

// Lightning — used for training effect (TE)
export function BoltIcon({ size = 13 }) {
  return (
    <svg {...baseProps(size)} fill="currentColor" stroke="none">
      <path d="M7.5 1.5 L3 7.5 L6.5 7.5 L5.5 12.5 L10 6.5 L6.5 6.5 Z" />
    </svg>
  );
}

// Gauge — used for GAP (grade-adjusted pace)
export function GaugeIcon({ size = 13 }) {
  return (
    <svg {...baseProps(size)}>
      <path d="M2 9.5 A 5 5 0 0 1 12 9.5" />
      <path d="M7 9.5 L 9.5 5.5" />
      <circle cx="7" cy="9.5" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

// Stopwatch-style icon — used for pace (running speed per km)
export function RunnerIcon({ size = 13 }) {
  return (
    <svg {...baseProps(size)}>
      <circle cx="7" cy="8" r="4.2" />
      <path d="M7 5 V 8 L 9 9.5" />
      <path d="M5.5 1.8 H 8.5" />
      <path d="M7 1.8 V 3" />
    </svg>
  );
}

// Route / distance — squiggly path
export function RouteIcon({ size = 13 }) {
  return (
    <svg {...baseProps(size)}>
      <path d="M2 4 Q 5 4, 5 7 T 8 10 T 12 10" />
      <circle cx="2" cy="4" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="10" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}
