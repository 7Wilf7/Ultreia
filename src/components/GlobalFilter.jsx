import { useEffect, useRef, useState } from "react";
import { RUN_GROUP_TYPES } from "../constants";
import { useT } from "../i18n/LanguageContext";

/**
 * Filter state shape (held in App):
 *   {
 *     all: boolean,
 *     groups: {
 *       run:      { enabled, subs: string[] },
 *       strength: { enabled, subs: string[] },
 *       hiit:     { enabled, subs: string[] },
 *     }
 *   }
 */
export const INITIAL_FILTER = {
  all: true,
  groups: {
    run: { enabled: false, subs: [] },
    strength: { enabled: false, subs: [] },
    hiit: { enabled: false, subs: [] },
  },
};

export function logMatchesFilter(log, filter) {
  if (filter.all) return true;
  const g = filter.groups;
  if (g.run.enabled && RUN_GROUP_TYPES.includes(log.type)) {
    if (g.run.subs.length === 0) return true;
    if (g.run.subs.includes(log.type)) return true;
  }
  if (g.strength.enabled && log.type === "Strength") {
    if (g.strength.subs.length === 0) return true;
    if (Array.isArray(log.subTypes) && log.subTypes.some(st => g.strength.subs.includes(st))) return true;
  }
  if (g.hiit.enabled && log.type === "HIIT") return true;
  return false;
}

// Translate the rich {all, groups:{run,strength,hiit}} filter into a single
// dropdown value, and back. The dropdown represents only the common cases
// (all / one parent group / one specific child); selecting any option from
// the dropdown collapses the filter to those shapes — multi-select chips
// on desktop are still the way to get arbitrary combinations.
function filterToDropdownValue(filter) {
  if (filter.all) return "all";
  const g = filter.groups;
  if (g.hiit.enabled) return "hiit";
  if (g.run.enabled) {
    if (g.run.subs.length === 1) return `run-${g.run.subs[0]}`;
    return "run-all";
  }
  if (g.strength.enabled) {
    if (g.strength.subs.length === 1) return `strength-${g.strength.subs[0]}`;
    return "strength-all";
  }
  return "all";
}
function dropdownValueToFilter(value) {
  const empty = {
    run: { enabled: false, subs: [] },
    strength: { enabled: false, subs: [] },
    hiit: { enabled: false, subs: [] },
  };
  if (value === "all") return { all: true, groups: empty };
  if (value === "hiit") return { all: false, groups: { ...empty, hiit: { enabled: true, subs: [] } } };
  if (value === "run-all") return { all: false, groups: { ...empty, run: { enabled: true, subs: [] } } };
  if (value.startsWith("run-")) return { all: false, groups: { ...empty, run: { enabled: true, subs: [value.slice(4)] } } };
  if (value === "strength-all") return { all: false, groups: { ...empty, strength: { enabled: true, subs: [] } } };
  if (value.startsWith("strength-")) return { all: false, groups: { ...empty, strength: { enabled: true, subs: [value.slice(9)] } } };
  return { all: true, groups: empty };
}

// Label shown on the trigger button. Reflects the single-select dropdown
// value rather than the multi-select chip combos the legacy chip UI allowed.
function filterToLabel(filter, t) {
  if (filter.all) return t("filter.all_activities");
  const g = filter.groups;
  if (g.hiit.enabled) return t("filter.group.hiit");
  if (g.run.enabled) {
    if (g.run.subs.length === 1) return t(`filter.child.${g.run.subs[0]}`);
    return t("filter.group.run");
  }
  if (g.strength.enabled) {
    if (g.strength.subs.length === 1) return t(`filter.child.${g.strength.subs[0]}`);
    return t("filter.group.strength");
  }
  return t("filter.all_activities");
}

export function GlobalFilter({ filter, setFilter, compact = false }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  // Close on outside click. Cheap implementation — listens to mousedown +
  // touchstart so it works on both pointer and touch devices.
  useEffect(() => {
    if (!open) return;
    function onClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("touchstart", onClick);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("touchstart", onClick);
    };
  }, [open]);

  const currentValue = filterToDropdownValue(filter);

  function pick(value) {
    setFilter(dropdownValueToFilter(value));
    setOpen(false);
  }

  // Flat option list with three peer section headers. HIIT lives under its
  // own "Conditioning" section to make clear it's not a Strength child.
  const sections = [
    { kind: "option", value: "all", label: t("filter.all_activities") },
    { kind: "header", label: t("filter.group.run") },
    { kind: "option", value: "run-all",            label: t("filter.run_all") },
    { kind: "option", value: "run-Road Run",       label: t("filter.child.Road Run") },
    { kind: "option", value: "run-Trail Run",      label: t("filter.child.Trail Run") },
    { kind: "option", value: "run-Hiking",         label: t("filter.child.Hiking") },
    { kind: "option", value: "run-Floor Climbing", label: t("filter.child.Floor Climbing") },
    { kind: "header", label: t("filter.group.strength") },
    { kind: "option", value: "strength-all",         label: t("filter.strength_all") },
    { kind: "option", value: "strength-Upper Body",  label: t("filter.child.Upper Body") },
    { kind: "option", value: "strength-Lower Body",  label: t("filter.child.Lower Body") },
    { kind: "option", value: "strength-Core",        label: t("filter.child.Core") },
    { kind: "header", label: t("filter.group.conditioning") },
    { kind: "option", value: "hiit", label: t("filter.group.hiit") },
  ];

  return (
    <div data-global-filter ref={wrapRef}
      style={{
        position: "relative",
        textAlign: compact ? "left" : "center",
        marginBottom: compact ? 0 : 14,
      }}>
      {/* Borderless trigger. Plain text + ▼ — no chip frame. Tapping opens the
          dropdown panel below. Compact (single-row desktop header) left-aligns
          and trims the font so it sits inline with the toggle + period bar. */}
      <button onClick={() => setOpen(o => !o)}
        style={{
          background: "transparent", border: "none", cursor: "pointer",
          padding: compact ? "6px 8px 6px 0" : "8px 14px",
          fontFamily: "var(--font-sans)",
          fontSize: compact ? 15 : 17, fontWeight: 500, color: "var(--ink-1)",
          letterSpacing: "-0.01em",
          display: "inline-flex", alignItems: "center", gap: 8,
          whiteSpace: "nowrap",
        }}>
        {filterToLabel(filter, t)}
        <span style={{ fontSize: 10, color: "var(--ink-3)" }}>▼</span>
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "100%",
          left: compact ? 0 : "50%",
          transform: compact ? "none" : "translateX(-50%)",
          marginTop: 2, minWidth: 220,
          background: "var(--bg-elevated)",
          border: "1px solid var(--rule)", borderRadius: 4,
          padding: "4px 0",
          boxShadow: "0 8px 24px rgba(20,20,19,0.08)",
          zIndex: 50,
        }}>
          {sections.map((row, i) =>
            row.kind === "header" ? (
              <div key={`h-${i}`} style={{
                padding: "8px 14px 4px",
                fontFamily: "var(--font-mono)", fontSize: 10,
                color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.06em",
                borderTop: i > 0 ? "1px solid var(--rule-soft)" : "none",
                marginTop: i > 0 ? 4 : 0,
              }}>{row.label}</div>
            ) : (
              <button key={row.value} onClick={() => pick(row.value)}
                style={{
                  display: "block", width: "100%", textAlign: "left",
                  background: currentValue === row.value ? "var(--bg-sunken)" : "transparent",
                  border: "none", padding: "8px 14px",
                  fontFamily: "var(--font-sans)", fontSize: 14,
                  color: "var(--ink-1)", cursor: "pointer",
                  fontWeight: currentValue === row.value ? 600 : 400,
                  borderRadius: 0,
                }}>
                {row.label}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
