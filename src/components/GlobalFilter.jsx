import { s } from "../styles";
import { FILTER_GROUPS, RUN_GROUP_TYPES } from "../constants";
import { useT } from "../i18n/LanguageContext";
import { useIsMobile } from "../hooks/useMediaQuery";

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

function pillLabel(groupKey, group, state, t) {
  const groupLabel = t(`filter.group.${groupKey}`);
  if (!state.enabled) return groupLabel;
  if (state.subs.length === 0 || state.subs.length === group.children.length) {
    return groupLabel;
  }
  const labels = state.subs.map(id => t(`filter.child.${id}`));
  return labels.join("+");
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

export function GlobalFilter({ filter, setFilter, openDropdown, setOpenDropdown }) {
  const t = useT();
  const isMobile = useIsMobile();

  function setAll() {
    setFilter({
      all: true,
      groups: {
        run: { enabled: false, subs: [] },
        strength: { enabled: false, subs: [] },
        hiit: { enabled: false, subs: [] },
      },
    });
    setOpenDropdown(null);
  }

  function disableGroup(key) {
    const next = {
      ...filter,
      groups: { ...filter.groups, [key]: { enabled: false, subs: [] } },
    };
    const stillEnabled = Object.values(next.groups).some(g => g.enabled);
    if (!stillEnabled) next.all = true;
    setFilter(next);
    setOpenDropdown(null);
  }

  // Helper: when enabling a pill would mean ALL top-level groups are on,
  // collapse back to the simpler "all" state instead. (Filtering by all three
  // groups individually is functionally identical to "show everything".)
  function applyPillEnable(key) {
    const nextGroups = { ...filter.groups, [key]: { enabled: true, subs: [] } };
    const everyOn = Object.values(nextGroups).every(g => g.enabled);
    if (everyOn) {
      setAll();
      return;
    }
    setFilter({ ...filter, all: false, groups: nextGroups });
  }

  function clickPill(key) {
    const cur = filter.groups[key];
    const group = FILTER_GROUPS[key];

    if (group.children.length === 0) {
      if (cur.enabled) {
        disableGroup(key);
      } else {
        applyPillEnable(key);
      }
      setOpenDropdown(null);
      return;
    }

    if (!cur.enabled) {
      applyPillEnable(key);
      setOpenDropdown(key);
    } else {
      setOpenDropdown(openDropdown === key ? null : key);
    }
  }

  function toggleSub(key, subId) {
    const cur = filter.groups[key];
    const group = FILTER_GROUPS[key];

    let effective = cur.subs.length === 0
      ? group.children.map(c => c.id)
      : [...cur.subs];

    if (effective.includes(subId)) {
      effective = effective.filter(x => x !== subId);
    } else {
      effective.push(subId);
    }

    if (effective.length === 0) {
      effective = group.children.map(c => c.id);
    }

    if (effective.length === group.children.length) effective = [];

    setFilter({
      ...filter,
      all: false,
      groups: { ...filter.groups, [key]: { enabled: true, subs: effective } },
    });
  }

  function renderPill(key) {
    const group = FILTER_GROUPS[key];
    const state = filter.groups[key];
    const active = state.enabled;
    const label = pillLabel(key, group, state, t);

    return (
      <div key={key} style={{ position: "relative" }}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            clickPill(key);
          }}
          style={s.chip(active)}>
          {label}
        </button>
        {openDropdown === key && group.children.length > 0 && (
          <div style={{
            position: "absolute", top: "100%", left: 0, marginTop: 4,
            background: "#fff", border: "1px solid #ddd", borderRadius: 8, padding: 6,
            zIndex: 100, minWidth: 180, boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
          }}>
            {(() => {
              // Group children by their `section` field so we can render a divider/header
              // before each named subsection. Children without a section render at the top.
              const nodes = [];
              let lastSection = null;
              group.children.forEach(child => {
                if (child.section && child.section !== lastSection) {
                  nodes.push(
                    <div key={`__sec_${child.section}`}
                      style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", color: "#999", padding: "8px 10px 4px", borderTop: lastSection === null ? "1px solid #eee" : "none", marginTop: lastSection === null ? 4 : 0 }}>
                      {t(`filter.section.${child.section}`)}
                    </div>
                  );
                  lastSection = child.section;
                }
                const checked = state.subs.length === 0 || state.subs.includes(child.id);
                nodes.push(
                  <label key={child.id}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", fontSize: 13, color: "#333", cursor: "pointer", borderRadius: 4 }}
                    onMouseEnter={e => e.currentTarget.style.background = "#f5f5f5"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <input type="checkbox" checked={checked}
                      onChange={() => toggleSub(key, child.id)}
                      style={{ width: 14, height: 14 }} />
                    {t(`filter.child.${child.id}`)}
                  </label>
                );
              });
              return nodes;
            })()}
            <div style={{ borderTop: "1px solid #eee", marginTop: 4, paddingTop: 4 }}>
              <button onClick={() => disableGroup(key)}
                style={{ display: "block", width: "100%", border: "none", background: "transparent", padding: "5px 10px", textAlign: "left", fontSize: 12, color: "#c0392b", cursor: "pointer", borderRadius: 4 }}>
                {t("filter.disable")}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Mobile: collapse the chip+dropdown tangle into a single native select.
  // Loses the ability to pick e.g. "Road Run + Trail Run" simultaneously,
  // but the dropdown covers the 90%-common cases in one row.
  if (isMobile) {
    const value = filterToDropdownValue(filter);
    return (
      <div data-global-filter style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <span style={{ ...s.muted, fontSize: 11, flexShrink: 0 }}>{t("filter.type_label")}</span>
        <select value={value}
          onChange={e => setFilter(dropdownValueToFilter(e.target.value))}
          style={{ ...s.input, flex: 1, padding: "6px 10px", fontSize: 13 }}>
          <option value="all">{t("filter.all_activities")}</option>
          <optgroup label={t("filter.group.run")}>
            <option value="run-all">{t("filter.run_all")}</option>
            <option value="run-Road Run">{t("filter.child.Road Run")}</option>
            <option value="run-Trail Run">{t("filter.child.Trail Run")}</option>
            <option value="run-Hiking">{t("filter.child.Hiking")}</option>
            <option value="run-Floor Climbing">{t("filter.child.Floor Climbing")}</option>
          </optgroup>
          <optgroup label={t("filter.group.strength")}>
            <option value="strength-all">{t("filter.strength_all")}</option>
            <option value="strength-Upper Body">{t("filter.child.Upper Body")}</option>
            <option value="strength-Lower Body">{t("filter.child.Lower Body")}</option>
            <option value="strength-Core">{t("filter.child.Core")}</option>
          </optgroup>
          <option value="hiit">{t("filter.group.hiit")}</option>
        </select>
      </div>
    );
  }

  return (
    <div data-global-filter style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap", alignItems: "center", position: "relative" }}>
      <span style={{ ...s.muted, marginRight: 4 }}>{t("filter.type_label")}</span>
      <button onClick={setAll} style={s.chip(filter.all)}>{t("filter.all")}</button>
      <span style={{ color: "#ccc", fontSize: 12 }}>|</span>
      {renderPill("run")}
      {renderPill("strength")}
      {renderPill("hiit")}
    </div>
  );
}
