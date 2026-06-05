import { getPeriodLabel, pastMonths, pastYears } from "../utils/period";
import { useT } from "../i18n/LanguageContext";

// Single segment of the strip. Hoisted to module scope (was an inner function
// of PeriodSelector, which re-created the component type every render and reset
// its subtree state). `compact` is the only thing it used from the closure, now
// a prop.
function Cell({ kind, active, label, onClick, hasDropdown, isOpen, dropdownContent, compact }) {
  return (
    <div style={{ position: "relative", flex: compact ? "0 0 auto" : 1, minWidth: 0 }}>
      <button
        onClick={onClick}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
          width: "100%", minHeight: 36,
          padding: "8px 6px",
          background: active ? "var(--ink-1)" : "transparent",
          color: active ? "var(--ink-inv)" : "var(--ink-2)",
          border: "none",
          // No right divider on the rightmost cell (Year).
          borderRight: kind !== "year" ? "1px solid var(--rule)" : "none",
          fontFamily: "var(--font-sans)", fontSize: 12,
          fontWeight: active ? 600 : 500,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          cursor: "pointer", borderRadius: 0,
        }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
        {hasDropdown && <span style={{ fontSize: 9, opacity: 0.7 }}>▾</span>}
      </button>
      {isOpen && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, marginTop: 2,
          background: "var(--bg-elevated)",
          border: "1px solid var(--rule)", borderRadius: 2,
          maxHeight: 300, overflowY: "auto",
          boxShadow: "0 8px 24px rgba(20,20,19,0.08)",
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
export function PeriodSelector({ period, setPeriod, periodDropdown, setPeriodDropdown, compact = false, style }) {
  const t = useT();

  function popupItem(key, label, selected, onClick) {
    return (
      <button key={key} onClick={onClick}
        style={{
          display: "block", width: "100%", textAlign: "left",
          background: selected ? "var(--bg-sunken)" : "transparent",
          border: "none", padding: "8px 12px",
          fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--ink-1)",
          fontWeight: selected ? 600 : 400,
          cursor: "pointer", borderRadius: 0,
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
      borderRadius: 2,
      overflow: "visible",
      background: "var(--bg-elevated)",
      ...style,
    }}>
      <Cell
        compact={compact}
        kind="all"
        active={period.type === "all"}
        label={t("period.all_time")}
        onClick={() => { setPeriod({ type: "all" }); setPeriodDropdown(null); }}
        hasDropdown={false}
      />
      <Cell
        compact={compact}
        kind="week"
        active={period.type === "week"}
        label={period.type === "week" ? getPeriodLabel(period, t) : t("period.this_week")}
        onClick={(e) => {
          e.stopPropagation();
          if (period.type === "week" && period.offset !== 0) setPeriod({ type: "week", offset: 0 });
          else if (period.type !== "week") setPeriod({ type: "week", offset: 0 });
          setPeriodDropdown(periodDropdown === "week" ? null : "week");
        }}
        hasDropdown
        isOpen={periodDropdown === "week"}
        dropdownContent={[0, -1, -2, -3, -4].map(off => popupItem(
          `week${off}`,
          off === 0 ? t("period.this_week") : off === -1 ? t("period.last_week") : t("period.weeks_ago", { n: Math.abs(off) }),
          period.type === "week" && period.offset === off,
          () => { setPeriod({ type: "week", offset: off }); setPeriodDropdown(null); },
        ))}
      />
      <Cell
        compact={compact}
        kind="month"
        active={period.type === "month"}
        label={period.type === "month" ? getPeriodLabel(period, t) : t("period.this_month")}
        onClick={(e) => {
          e.stopPropagation();
          if (period.type !== "month" || period.year != null) setPeriod({ type: "month" });
          setPeriodDropdown(periodDropdown === "month" ? null : "month");
        }}
        hasDropdown
        isOpen={periodDropdown === "month"}
        dropdownContent={pastMonths(24).map((m, i) => {
          const isCurrent = i === 0;
          const isSelected = period.type === "month"
            && ((period.year == null && isCurrent) || (period.year === m.year && period.month === m.month));
          return popupItem(
            `month${m.year}-${m.month}`,
            isCurrent ? t("period.this_month") : getPeriodLabel({ type: "month", year: m.year, month: m.month }, t),
            isSelected,
            () => { setPeriod(isCurrent ? { type: "month" } : { type: "month", year: m.year, month: m.month }); setPeriodDropdown(null); },
          );
        })}
      />
      <Cell
        compact={compact}
        kind="year"
        active={period.type === "year"}
        label={period.type === "year" ? getPeriodLabel(period, t) : t("period.this_year")}
        onClick={(e) => {
          e.stopPropagation();
          if (period.type !== "year" || period.year != null) setPeriod({ type: "year" });
          setPeriodDropdown(periodDropdown === "year" ? null : "year");
        }}
        hasDropdown
        isOpen={periodDropdown === "year"}
        dropdownContent={pastYears(6).map((yy, i) => {
          const isCurrent = i === 0;
          const isSelected = period.type === "year"
            && ((period.year == null && isCurrent) || (period.year === yy));
          return popupItem(
            `year${yy}`,
            isCurrent ? t("period.this_year") : String(yy),
            isSelected,
            () => { setPeriod(isCurrent ? { type: "year" } : { type: "year", year: yy }); setPeriodDropdown(null); },
          );
        })}
      />
    </div>
  );
}
