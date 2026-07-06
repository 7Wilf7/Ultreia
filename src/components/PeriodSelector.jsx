import { startTransition, useEffect, useState } from "react";
import { getPeriodLabel, pastMonths, pastYears } from "../utils/period";
import { useT } from "../i18n/LanguageContext";
import { useInstantPress, useInstantTap } from "../hooks/useInstantPress";

// Single segment of the strip. Hoisted to module scope (was an inner function
// of PeriodSelector, which re-created the component type every render and reset
// its subtree state). `compact` is the only thing it used from the closure, now
// a prop.
function Cell({ kind, active, label, pressProps, hasDropdown, isOpen, dropdownContent, compact, dense }) {
  return (
    <div style={{ position: "relative", flex: compact ? "0 0 auto" : 1, minWidth: 0 }}>
      <button
        {...pressProps}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
          width: "100%", minHeight: 36,
          padding: dense ? "8px 4px" : "8px 6px",
          background: active ? "var(--accent-soft)" : "transparent",
          color: active ? "var(--accent-dark)" : "var(--ink-2)",
          border: "none",
          // No right divider on the rightmost cell (Year).
          borderRight: kind !== "year" ? "1px solid var(--rule)" : "none",
          fontFamily: "var(--font-sans)", fontSize: dense ? 11 : 12,
          fontWeight: active ? 600 : 500,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          cursor: "pointer", borderRadius: 0,
          touchAction: "manipulation", WebkitTapHighlightColor: "transparent",
        }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
        {hasDropdown && <span style={{ fontSize: 9, opacity: 0.7 }}>▾</span>}
      </button>
      {isOpen && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, marginTop: 2,
          background: "var(--panel)",
          border: "1px solid var(--rule)", borderRadius: 8,
          maxHeight: 300, overflowY: "auto",
          boxShadow: "var(--shadow-soft)",
          zIndex: 50, minWidth: 140,
        }}>
          {dropdownContent}
        </div>
      )}
    </div>
  );
}

// Segmented 4-tab strip — Week / Month / Year / All — in a single row.
// Each non-"All" tab carries its own ▾ caret that opens a popup for picking
// past periods. Active cell gets a filled inverted background.
export function PeriodSelector({ period, setPeriod, periodDropdown, setPeriodDropdown, compact = false, dense = false, style }) {
  const t = useT();
  const instantPress = useInstantPress();
  const instantTap = useInstantTap();
  const [localPeriod, setLocalPeriod] = useState(period);
  const [localDropdown, setLocalDropdown] = useState(periodDropdown);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setLocalPeriod(period);
    });
    return () => { cancelled = true; };
  }, [period]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setLocalDropdown(periodDropdown);
    });
    return () => { cancelled = true; };
  }, [periodDropdown]);

  function commitPeriod(next) {
    setLocalPeriod(next);
    startTransition(() => setPeriod(next));
  }

  function commitDropdown(next) {
    setLocalDropdown(next);
    startTransition(() => setPeriodDropdown(next));
  }

  const visiblePeriod = localPeriod || period;
  const visibleDropdown = localDropdown;

  function popupItem(key, label, selected, onClick) {
    return (
      <button key={key} {...instantTap(key, onClick)}
        style={{
          display: "block", width: "100%", textAlign: "left",
          background: selected ? "var(--bg-sunken)" : "transparent",
          border: "none", padding: "8px 12px",
          fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--ink-1)",
          fontWeight: selected ? 600 : 400,
          cursor: "pointer", borderRadius: 0,
          touchAction: "manipulation", WebkitTapHighlightColor: "transparent",
        }}>
        {label}
      </button>
    );
  }

  return (
    <div data-period-control style={{
      display: compact ? "inline-flex" : "flex",
      marginBottom: compact ? 0 : 14,
      border: "1px solid var(--rule)",
      borderRadius: 8,
      overflow: "visible",
      background: "var(--panel)",
      ...style,
    }}>
      <Cell
        compact={compact}
        dense={dense}
        kind="all"
        active={visiblePeriod.type === "all"}
        label={t("period.all_time")}
        pressProps={instantPress("period-all", () => { commitPeriod({ type: "all" }); commitDropdown(null); })}
        hasDropdown={false}
      />
      <Cell
        compact={compact}
        dense={dense}
        kind="week"
        active={visiblePeriod.type === "week"}
        label={visiblePeriod.type === "week" ? getPeriodLabel(visiblePeriod, t) : t("period.this_week")}
        pressProps={instantPress("period-week", (e) => {
          e.stopPropagation();
          if (visiblePeriod.type !== "week" || visiblePeriod.offset !== 0) {
            commitPeriod({ type: "week", offset: 0 });
            commitDropdown(null);
            return;
          }
          commitDropdown(visibleDropdown === "week" ? null : "week");
        })}
        hasDropdown
        isOpen={visibleDropdown === "week"}
        dropdownContent={[0, -1, -2, -3, -4].map(off => popupItem(
          `week${off}`,
          off === 0 ? t("period.this_week") : off === -1 ? t("period.last_week") : t("period.weeks_ago", { n: Math.abs(off) }),
          visiblePeriod.type === "week" && visiblePeriod.offset === off,
          () => { commitPeriod({ type: "week", offset: off }); commitDropdown(null); },
        ))}
      />
      <Cell
        compact={compact}
        dense={dense}
        kind="month"
        active={visiblePeriod.type === "month"}
        label={visiblePeriod.type === "month" ? getPeriodLabel(visiblePeriod, t) : t("period.this_month")}
        pressProps={instantPress("period-month", (e) => {
          e.stopPropagation();
          if (visiblePeriod.type !== "month" || visiblePeriod.year != null) {
            commitPeriod({ type: "month" });
            commitDropdown(null);
            return;
          }
          commitDropdown(visibleDropdown === "month" ? null : "month");
        })}
        hasDropdown
        isOpen={visibleDropdown === "month"}
        dropdownContent={pastMonths(24).map((m, i) => {
          const isCurrent = i === 0;
          const isSelected = visiblePeriod.type === "month"
            && ((visiblePeriod.year == null && isCurrent) || (visiblePeriod.year === m.year && visiblePeriod.month === m.month));
          return popupItem(
            `month${m.year}-${m.month}`,
            isCurrent ? t("period.this_month") : getPeriodLabel({ type: "month", year: m.year, month: m.month }, t),
            isSelected,
            () => { commitPeriod(isCurrent ? { type: "month" } : { type: "month", year: m.year, month: m.month }); commitDropdown(null); },
          );
        })}
      />
      <Cell
        compact={compact}
        dense={dense}
        kind="year"
        active={visiblePeriod.type === "year"}
        label={visiblePeriod.type === "year" ? getPeriodLabel(visiblePeriod, t) : t("period.this_year")}
        pressProps={instantPress("period-year", (e) => {
          e.stopPropagation();
          if (visiblePeriod.type !== "year" || visiblePeriod.year != null) {
            commitPeriod({ type: "year" });
            commitDropdown(null);
            return;
          }
          commitDropdown(visibleDropdown === "year" ? null : "year");
        })}
        hasDropdown
        isOpen={visibleDropdown === "year"}
        dropdownContent={pastYears(6).map((yy, i) => {
          const isCurrent = i === 0;
          const isSelected = visiblePeriod.type === "year"
            && ((visiblePeriod.year == null && isCurrent) || (visiblePeriod.year === yy));
          return popupItem(
            `year${yy}`,
            isCurrent ? t("period.this_year") : String(yy),
            isSelected,
            () => { commitPeriod(isCurrent ? { type: "year" } : { type: "year", year: yy }); commitDropdown(null); },
          );
        })}
      />
    </div>
  );
}
