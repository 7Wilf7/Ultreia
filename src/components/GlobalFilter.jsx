// Co-locates the GlobalFilter component with its filter-shape constant
// (INITIAL_FILTER) and pure predicate (logMatchesFilter) that callers import
// from here. Trips react-refresh/only-export-components, a dev-only
// Fast-Refresh rule — splitting these out would churn import sites for no
// runtime benefit. Disabled deliberately.
/* eslint-disable react-refresh/only-export-components */
import { startTransition, useEffect, useRef, useState } from "react";
import { RUN_GROUP_TYPES } from "../constants";
// Cycling/Swimming sit under the "Run / Endurance" group visually but are NOT
// runs — "All Run / Endurance" stays running-only, while each is filterable on
// its own. Listed here so the predicate can match the individual selection.
import { useT } from "../i18n/LanguageContext";
import { useInstantPress } from "../hooks/useInstantPress";

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
  if (g.run.enabled) {
    // No specific child picked ("All Run / Endurance") → running types only,
    // so Cycling/Swimming don't inflate the running mileage shown in stats.
    if (g.run.subs.length === 0) {
      if (RUN_GROUP_TYPES.includes(log.type)) return true;
    } else if (g.run.subs.includes(log.type)) {
      // A specific child picked — incl. Cycling / Swimming.
      return true;
    }
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
  // Which top-level group's children show in the right column of the two-level
  // menu. Derived from the current filter when the panel opens.
  const [activeGroup, setActiveGroup] = useState(null);
  const [localFilter, setLocalFilter] = useState(filter);
  const wrapRef = useRef(null);
  const instantPress = useInstantPress();

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

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setLocalFilter(filter);
    });
    return () => { cancelled = true; };
  }, [filter]);

  const currentValue = filterToDropdownValue(localFilter);

  function pick(value) {
    const nextFilter = dropdownValueToFilter(value);
    setLocalFilter(nextFilter);
    setOpen(false);
    startTransition(() => setFilter(nextFilter));
  }

  // Two-level menu tree. Left column = "All Types" + 3 group headers; tapping a
  // group reveals its children in the right column. Keeps the list short now
  // that Run / Endurance has 7 children.
  const groups = [
    { id: "run", label: t("filter.group.run"), children: [
      { value: "run-all",            label: t("filter.run_all") },
      { value: "run-Road Run",       label: t("filter.child.Road Run") },
      { value: "run-Trail Run",      label: t("filter.child.Trail Run") },
      { value: "run-Hiking",         label: t("filter.child.Hiking") },
      { value: "run-Floor Climbing", label: t("filter.child.Floor Climbing") },
      { value: "run-Cycling",        label: t("filter.child.Cycling") },
      { value: "run-Swimming",       label: t("filter.child.Swimming") },
    ] },
    { id: "strength", label: t("filter.group.strength"), children: [
      { value: "strength-all",        label: t("filter.strength_all") },
      { value: "strength-Upper Body", label: t("filter.child.Upper Body") },
      { value: "strength-Lower Body", label: t("filter.child.Lower Body") },
      { value: "strength-Core",       label: t("filter.child.Core") },
    ] },
    { id: "conditioning", label: t("filter.group.conditioning"), children: [
      { value: "hiit", label: t("filter.group.hiit") },
    ] },
  ];
  // Which group a dropdown value belongs to (to pre-open the right column).
  const groupIdOf = (v) =>
    v.startsWith("run") ? "run" : v.startsWith("strength") ? "strength" : v === "hiit" ? "conditioning" : null;
  const shownGroup = groups.find(g => g.id === (activeGroup || groupIdOf(currentValue) || "run"));

  function openPanel() {
    if (!open) setActiveGroup(groupIdOf(currentValue));
    setOpen(o => !o);
  }

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
      <button {...instantPress("global-filter-trigger", openPanel)}
        style={{
          background: "transparent", border: "none", cursor: "pointer",
          padding: compact ? "6px 8px 6px 0" : "8px 14px",
          fontFamily: "var(--font-sans)",
          fontSize: compact ? 15 : 17, fontWeight: 500, color: "var(--ink-1)",
          letterSpacing: "-0.01em",
          display: "inline-flex", alignItems: "center", gap: 8,
          whiteSpace: "nowrap",
          touchAction: "manipulation", WebkitTapHighlightColor: "transparent",
        }}>
        {filterToLabel(localFilter, t)}
        <span style={{ fontSize: 10, color: "var(--ink-3)" }}>▼</span>
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "100%",
          left: compact ? 0 : "50%",
          transform: compact ? "none" : "translateX(-50%)",
          marginTop: 2,
          display: "flex", alignItems: "stretch",
          background: "var(--bg-elevated)",
          border: "1px solid var(--rule)", borderRadius: 4,
          boxShadow: "0 8px 24px rgba(20,20,19,0.08)",
          zIndex: 50, overflow: "hidden",
        }}>
          {/* Left column — All Types + the 3 top-level groups. Narrow so the
              two columns fit side by side on a phone. */}
          <div style={{ width: 116, flexShrink: 0, borderRight: "1px solid var(--rule-soft)", padding: "4px 0" }}>
            <button {...instantPress("global-filter-all", () => pick("all"))}
              style={{
                display: "block", width: "100%", textAlign: "left",
                background: currentValue === "all" ? "var(--bg-sunken)" : "transparent",
                border: "none", padding: "9px 12px",
                fontFamily: "var(--font-sans)", fontSize: 13,
                color: "var(--ink-1)", cursor: "pointer",
                fontWeight: currentValue === "all" ? 600 : 400,
                touchAction: "manipulation", WebkitTapHighlightColor: "transparent",
              }}>
              {t("filter.all_activities")}
            </button>
            {groups.map(g => {
              const isActive = shownGroup && shownGroup.id === g.id;
              const isSelected = groupIdOf(currentValue) === g.id;
              return (
                <button key={g.id} {...instantPress(`global-filter-group-${g.id}`, () => setActiveGroup(g.id))}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4,
                    width: "100%", textAlign: "left",
                    background: isActive ? "var(--bg-sunken)" : "transparent",
                    border: "none", padding: "9px 12px",
                    fontFamily: "var(--font-sans)", fontSize: 13,
                    color: "var(--ink-1)", cursor: "pointer",
                    fontWeight: isSelected ? 600 : 400,
                    touchAction: "manipulation", WebkitTapHighlightColor: "transparent",
                  }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.label}</span>
                  <span style={{ fontSize: 10, color: "var(--ink-3)", flexShrink: 0 }}>›</span>
                </button>
              );
            })}
          </div>
          {/* Right column — children of the active group. */}
          <div style={{ minWidth: 150, padding: "4px 0" }}>
            {shownGroup && shownGroup.children.map(c => (
              <button key={c.value} {...instantPress(`global-filter-child-${c.value}`, () => pick(c.value))}
                style={{
                  display: "block", width: "100%", textAlign: "left",
                  background: currentValue === c.value ? "var(--bg-sunken)" : "transparent",
                  border: "none", padding: "9px 14px",
                  fontFamily: "var(--font-sans)", fontSize: 14,
                  color: "var(--ink-1)", cursor: "pointer",
                  fontWeight: currentValue === c.value ? 600 : 400,
                  whiteSpace: "nowrap",
                  touchAction: "manipulation", WebkitTapHighlightColor: "transparent",
                }}>
                {c.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
