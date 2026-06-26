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

export function PlusIcon({ size = 13 }) {
  return (
    <svg {...baseProps(size)}>
      <path d="M7 2.5 V11.5" />
      <path d="M2.5 7 H11.5" />
    </svg>
  );
}

export function UploadIcon({ size = 13 }) {
  return (
    <svg {...baseProps(size)}>
      <path d="M7 10 V2.8" />
      <path d="M4.3 5.5 L7 2.8 L9.7 5.5" />
      <path d="M2.5 9.5 V11.5 H11.5 V9.5" />
    </svg>
  );
}

export function CheckSquareIcon({ size = 13 }) {
  return (
    <svg {...baseProps(size)}>
      <rect x="2.3" y="2.3" width="9.4" height="9.4" rx="1.2" />
      <path d="M4.5 7.1 L6.3 8.9 L9.7 5.2" />
    </svg>
  );
}

export function SortIcon({ size = 13 }) {
  return (
    <svg {...baseProps(size)}>
      <path d="M4.5 2.5 V11" />
      <path d="M2.8 4.2 L4.5 2.5 L6.2 4.2" />
      <path d="M9.5 11.5 V3" />
      <path d="M7.8 9.8 L9.5 11.5 L11.2 9.8" />
    </svg>
  );
}

export function CalendarIcon({ size = 13 }) {
  return (
    <svg {...baseProps(size)}>
      <rect x="2.2" y="3" width="9.6" height="8.4" rx="1.2" />
      <path d="M4.5 1.8 V4.2" />
      <path d="M9.5 1.8 V4.2" />
      <path d="M2.2 5.4 H11.8" />
    </svg>
  );
}

export function TrophyIcon({ size = 13 }) {
  return (
    <svg {...baseProps(size)}>
      <path d="M4.2 2.5 H9.8 V5.4 C9.8 7.1 8.6 8.4 7 8.4 C5.4 8.4 4.2 7.1 4.2 5.4 Z" />
      <path d="M4.2 4 H2.4 C2.4 5.6 3.2 6.4 4.5 6.6" />
      <path d="M9.8 4 H11.6 C11.6 5.6 10.8 6.4 9.5 6.6" />
      <path d="M7 8.4 V11" />
      <path d="M4.8 11.5 H9.2" />
    </svg>
  );
}

export function CoachIcon({ size = 13 }) {
  return (
    <svg {...baseProps(size)}>
      <path d="M3 4.8 C3 3.3 4.3 2.2 6 2.2 H8 C9.7 2.2 11 3.3 11 4.8 V6.3 C11 7.8 9.7 8.9 8 8.9 H7 L4.3 11.2 V8.8 C3.5 8.5 3 7.6 3 6.3 Z" />
      <path d="M5.1 5.6 H5.2" />
      <path d="M7 5.6 H7.1" />
      <path d="M8.9 5.6 H9" />
    </svg>
  );
}

export function ImageIcon({ size = 13 }) {
  return (
    <svg {...baseProps(size)}>
      <rect x="2.2" y="2.5" width="9.6" height="9" rx="1.2" />
      <circle cx="5.2" cy="5.2" r="1" />
      <path d="M3.5 10 L6.1 7.4 L8 9.1 L9.1 7.9 L11 10" />
    </svg>
  );
}

export function SettingsIcon({ size = 13 }) {
  return (
    <svg {...baseProps(size)}>
      <circle cx="7" cy="7" r="2" />
      <path d="M7 1.8 V3" />
      <path d="M7 11 V12.2" />
      <path d="M1.8 7 H3" />
      <path d="M11 7 H12.2" />
      <path d="M3.3 3.3 L4.2 4.2" />
      <path d="M9.8 9.8 L10.7 10.7" />
      <path d="M10.7 3.3 L9.8 4.2" />
      <path d="M4.2 9.8 L3.3 10.7" />
    </svg>
  );
}

export function BookIcon({ size = 13 }) {
  return (
    <svg {...baseProps(size)}>
      <path d="M2.5 2.5 H6 C6.6 2.5 7 2.9 7 3.5 V11.5 C7 10.8 6.5 10.4 5.8 10.4 H2.5 Z" />
      <path d="M11.5 2.5 H8 C7.4 2.5 7 2.9 7 3.5 V11.5 C7 10.8 7.5 10.4 8.2 10.4 H11.5 Z" />
    </svg>
  );
}

export function KeyIcon({ size = 13 }) {
  return (
    <svg {...baseProps(size)}>
      <circle cx="4.6" cy="7" r="2.2" />
      <path d="M6.8 7 H12" />
      <path d="M9.2 7 V8.6" />
      <path d="M11 7 V8.2" />
    </svg>
  );
}

export function WalletIcon({ size = 13 }) {
  return (
    <svg {...baseProps(size)}>
      <path d="M2.2 4.2 H11.8 V11.2 H2.2 Z" />
      <path d="M3.2 4.2 V2.8 H9.8 C10.8 2.8 11.4 3.3 11.4 4.2" />
      <path d="M9 7.4 H12.2 V9.4 H9 C8.4 9.4 8 9 8 8.4 C8 7.8 8.4 7.4 9 7.4 Z" />
      <path d="M10 8.4 H10.1" />
    </svg>
  );
}

export function GlobeIcon({ size = 13 }) {
  return (
    <svg {...baseProps(size)}>
      <circle cx="7" cy="7" r="5" />
      <path d="M2.2 7 H11.8" />
      <path d="M7 2 C8.2 3.3 8.8 5 8.8 7 C8.8 9 8.2 10.7 7 12" />
      <path d="M7 2 C5.8 3.3 5.2 5 5.2 7 C5.2 9 5.8 10.7 7 12" />
    </svg>
  );
}

// Map pin — used by the desktop header to open the default-location modal
// and (optionally) by any future "this is your location" inline chip.
export function PinIcon({ size = 13 }) {
  return (
    <svg {...baseProps(size)}>
      <path d="M7 1.5 C4.5 1.5 2.8 3.3 2.8 5.5 C2.8 8.5 7 12.5 7 12.5 C7 12.5 11.2 8.5 11.2 5.5 C11.2 3.3 9.5 1.5 7 1.5 Z" />
      <circle cx="7" cy="5.5" r="1.4" />
    </svg>
  );
}

// Stylised cloud — used for the Weather API entry in the desktop top bar.
// Outline only, so it matches the rest of the monoline icon set.
export function CloudIcon({ size = 13 }) {
  return (
    <svg {...baseProps(size)}>
      <path d="M4 9.5 C2.6 9.5 2 8.5 2 7.5 C2 6.4 2.9 5.5 4 5.5 C4.1 4 5.3 3 6.7 3 C8 3 9.1 3.9 9.4 5.1 C10.6 5.2 11.5 6.1 11.5 7.3 C11.5 8.6 10.5 9.5 9.2 9.5 Z" />
    </svg>
  );
}

export function MailIcon({ size = 13 }) {
  return (
    <svg {...baseProps(size)}>
      <rect x="2" y="3" width="10" height="8" rx="1" />
      <path d="M2.5 4 L7 7.5 L11.5 4" />
    </svg>
  );
}
