import { useState } from "react";
import { s } from "../styles";
import { RACE_PRIORITY, RACE_CATEGORIES, RACE_CATEGORY_COLOR, SPARTAN_SUBTYPES } from "../constants";
import { useT } from "../i18n/LanguageContext";
import { parseDistanceKm, inferRaceCategory } from "../utils/format";
import { useClickOutside } from "../utils/useClickOutside";
import { useIsNarrow, useIsMobile } from "../hooks/useMediaQuery";
import { ClockIcon } from "./Icons";
import { PersonalRecordsBar } from "./PersonalRecordsBar";

// Shared grid template for race rows (desktop only). Same fixed columns for
// the Target and History sections so every column lines up across both lists.
// Order: date · priority · category(+subtype inline) · name · distance · ascent · time · ✕.
// Category cell is fixed 150px — wide enough for the longest combo
// ("HALF MARATHON" or "SPARTAN ULTRA"); subtype sits flush against the
// category tag inside the cell, and the name column starts at the same x
// position on every row.
// Priority is empty for history rows; time/ITRA is empty for target rows.
const RACE_ROW_GRID = "82px 46px 150px minmax(0, 1fr) 78px 84px 108px 22px";

const EMPTY_RACE = (isTarget) => ({
  isTarget, priority: "A", name: "", date: "",
  distance: "", category: "", subtype: "", ascent: "", resultH: "", resultM: "", resultS: "",
  itraScore: "",
});

// Decompose a stored race into the editable form shape. Inverse of how `commitRace` builds the race object.
// Distance is normalized to a plain number string so the input shows just digits,
// even for legacy data stored as "Marathon (42.195 km)" or similar.
function raceToForm(race) {
  const distNum = parseDistanceKm(race.distance);
  return {
    isTarget: !!race.isTarget,
    priority: race.priority || "A",
    name: race.name || "",
    date: race.date || "",
    distance: distNum > 0 ? String(distNum) : "",
    category: race.category || "",
    subtype: race.subtype || "",
    ascent: race.ascent || "",
    resultH: race.resultH || "",
    resultM: race.resultM || "",
    resultS: race.resultS || "",
    itraScore: race.itraScore || "",
  };
}

export function RacesTab({ races, addRace, updateRace, now, setConfirmDelete, itraPI, setItraPI }) {
  const t = useT();
  const isNarrow = useIsNarrow();
  const isMobile = useIsMobile();
  // addingMode: null = no add form; "target" or "history" = the new race kind being added.
  // No more target/history TAB switching — both lists render on the same page.
  const [addingMode, setAddingMode] = useState(null);
  const [editingRaceId, setEditingRaceId] = useState(null);
  const [newRace, setNewRace] = useState(EMPTY_RACE(true));
  const [pastRaceWarning, setPastRaceWarning] = useState(null);
  // Independent category filters for the two lists. Empty array = show all;
  // otherwise show only races whose `category` is in the set. Uncategorized
  // races drop out of any filtered view by design — they reappear once the
  // user picks a category via the inline picker on the card.
  const [targetFilter, setTargetFilter] = useState([]);
  const [historyFilter, setHistoryFilter] = useState([]);
  // Mobile-only sub-navigation. Top tabs split PR (Personal Records bar)
  // from Races (the two lists). Inside Races, sub-tabs split Target vs
  // History — replacing the desktop's stacked sections. Defaults match the
  // user's primary use case: opening the Races bottom-nav tab lands on
  // upcoming target races.
  const [mobileTopTab, setMobileTopTab] = useState("races"); // "pr" | "races"
  const [mobileSubTab, setMobileSubTab] = useState("target"); // "target" | "history"

  function startAdd(mode) {
    if (editingRaceId) cancelEdit();
    // Toggle off if clicking the same Add button while it's already showing
    if (addingMode === mode) {
      setAddingMode(null);
      return;
    }
    setAddingMode(mode);
    setNewRace(EMPTY_RACE(mode === "target"));
    setPastRaceWarning(null);
  }

  function cancelAdd() {
    setAddingMode(null);
    setNewRace(EMPTY_RACE(true));
    setPastRaceWarning(null);
  }

  function startEdit(race) {
    setEditingRaceId(race.id);
    setAddingMode(null);
    setNewRace(raceToForm(race));
  }

  function cancelEdit() {
    setEditingRaceId(null);
    setNewRace(EMPTY_RACE(true));
    setPastRaceWarning(null);
  }

  // Click-outside auto-collapses the inline edit form (race cards). Warn first
  // if the form has unsaved changes; the dirty check compares the current draft
  // to a snapshot of the race being edited.
  function isEditFormDirty() {
    if (!editingRaceId) return false;
    const original = races.find(r => r.id === editingRaceId);
    if (!original) return false;
    return JSON.stringify(newRace) !== JSON.stringify(raceToForm(original));
  }
  const editFormRef = useClickOutside(() => {
    if (!isEditFormDirty() || window.confirm(t("form.discard_confirm"))) cancelEdit();
  }, !!editingRaceId);

  function deleteRace(id) {
    setConfirmDelete({ type: "race", id });
  }

  function updateRaceCategory(id, category) {
    updateRace(id, { category }).catch(() => {});
  }

  function tryAddRace() {
    if (!newRace.name || !newRace.date) return;
    // Only warn-and-move when ADDING a new target whose date slipped past.
    // For edits, trust the user's input — they may be backdating intentionally.
    if (newRace.isTarget && !editingRaceId && new Date(newRace.date) < new Date(now.toISOString().slice(0, 10))) {
      setPastRaceWarning(true);
      return;
    }
    commitRace(newRace.isTarget);
  }

  async function commitRace(asTarget) {
    const finalCategory = newRace.category || inferRaceCategory(newRace) || "";
    // Distance normalized to a plain number (km). UI always re-appends "km" on display.
    const distanceNum = parseDistanceKm(newRace.distance);
    const built = {
      ...newRace,
      distance: distanceNum,
      category: finalCategory,
      isTarget: asTarget,
      priority: asTarget ? newRace.priority : null,
    };
    try {
      if (editingRaceId) {
        await updateRace(editingRaceId, built);
      } else {
        await addRace(built);
      }
      setNewRace(EMPTY_RACE(true));
      setAddingMode(null);
      setEditingRaceId(null);
      setPastRaceWarning(null);
    } catch {
      // alert already shown by the wrapper; keep the form open so the user can retry
    }
  }

  // Sort: target races by date ASC (next race coming up first); history by date DESC (most recent first).
  // Missing date sorts last for targets and first for history (treated as "unknown future" / "recent unknown").
  const targetRacesAll = races.filter(r => r.isTarget).sort((a, b) => {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return new Date(a.date) - new Date(b.date);
  });
  const historyRacesAll = races.filter(r => !r.isTarget).sort((a, b) => {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return new Date(b.date) - new Date(a.date);
  });
  // Apply per-section category filter. Empty filter = show all.
  function applyFilter(list, filter) {
    return filter.length === 0 ? list : list.filter(r => filter.includes(r.category));
  }
  const targetRacesList = applyFilter(targetRacesAll, targetFilter);
  const historyRacesList = applyFilter(historyRacesAll, historyFilter);

  function toggleFilter(filter, setFilter, cat) {
    setFilter(filter.includes(cat) ? filter.filter(c => c !== cat) : [...filter, cat]);
  }
  function renderFilterChips(filter, setFilter) {
    // Mobile: single-select native dropdown — one row, far less screen real
    // estate than the chip grid. Trades multi-select for a cleaner layout
    // (the chip grid wrapped to 2 rows on a 360-wide phone).
    if (isMobile) {
      const value = filter[0] || "";
      return (
        // No marginBottom here — renderMobileSection lays this out in a flex
        // row next to the Add button, and the extra bottom margin pushed the
        // filter's center off-axis relative to the button. The surrounding
        // row owns the spacing.
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ ...s.muted, fontSize: 11, flexShrink: 0 }}>{t("races.filter_label")}</span>
          <select
            value={value}
            onChange={e => setFilter(e.target.value ? [e.target.value] : [])}
            style={{ ...s.input, flex: 1, padding: "0 10px", height: 40, fontSize: 13 }}>
            <option value="">{t("races.filter_all")}</option>
            {RACE_CATEGORIES.map(c => (
              <option key={c} value={c}>{t(`enum.race_cat.${c}`)}</option>
            ))}
          </select>
        </div>
      );
    }
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10, alignItems: "center" }}>
        <span style={{ ...s.muted, fontSize: 11, marginRight: 2 }}>{t("races.filter_label")}</span>
        <button onClick={() => setFilter([])}
          style={{ ...s.chip(filter.length === 0), padding: "4px 10px", fontSize: 12 }}>
          {t("races.filter_all")}
        </button>
        {RACE_CATEGORIES.map(c => (
          <button key={c} onClick={() => toggleFilter(filter, setFilter, c)}
            style={{ ...s.chip(filter.includes(c)), padding: "4px 10px", fontSize: 12 }}>
            {t(`enum.race_cat.${c}`)}
          </button>
        ))}
      </div>
    );
  }

  function renderCategoryTag(cat) {
    if (!cat) return null;
    return (
      <span style={{
        fontFamily: "var(--font-mono)",
        fontSize: 11, padding: "2px 8px", borderRadius: 2,
        background: RACE_CATEGORY_COLOR[cat] || "var(--rule-soft)",
        color: "var(--ink-1)", fontWeight: 500, whiteSpace: "nowrap",
        textTransform: "uppercase", letterSpacing: "0.05em",
        flexShrink: 0,
      }}>{t(`enum.race_cat.${cat}`)}</span>
    );
  }

  // Render a single race card OR its inline edit form. Used twice below (target + history sections).
  function renderRaceCard(r) {
    const timeStr = [r.resultH, r.resultM, r.resultS].some(Boolean)
      ? `${r.resultH || "0"}:${String(r.resultM || "0").padStart(2, "0")}:${String(r.resultS || "0").padStart(2, "0")}`
      : "";
    if (editingRaceId === r.id) {
      return <div key={r.id} ref={editFormRef}>{renderRaceForm("edit")}</div>;
    }
    return renderRaceCardInner(r, timeStr);
  }

  // Section renderers — desktop still uses these stacked. Mobile uses a
  // sub-tab version that omits the section header (the count moves into
  // the sub-tab label) and stacks Filter on the left + Add on the right.
  function renderTargetSection() {
    return (
      <>
        <div style={{ ...s.section, marginTop: 8, display: "flex", alignItems: "baseline", gap: 8 }}>
          <span>{t("races.section_target")}</span>
          <span style={{ ...s.muted, fontWeight: 400 }}>
            {targetFilter.length > 0 ? `${targetRacesList.length} / ${targetRacesAll.length}` : targetRacesAll.length}
          </span>
        </div>
        {targetRacesAll.length > 0 && renderFilterChips(targetFilter, setTargetFilter)}
        {targetRacesList.length === 0 ? (
          <div style={{ ...s.cardDark, textAlign: "center", color: "var(--ink-3)", padding: "24px 16px", marginBottom: 22, fontSize: 13 }}>
            {targetRacesAll.length > 0 ? t("races.filter_empty") : t("races.empty_target")}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 22 }}>
            {targetRacesList.map(renderRaceCard)}
          </div>
        )}
      </>
    );
  }
  function renderHistorySection() {
    return (
      <>
        <div style={{ ...s.section, display: "flex", alignItems: "baseline", gap: 8 }}>
          <span>{t("races.section_history")}</span>
          <span style={{ ...s.muted, fontWeight: 400 }}>
            {historyFilter.length > 0 ? `${historyRacesList.length} / ${historyRacesAll.length}` : historyRacesAll.length}
          </span>
        </div>
        {historyRacesAll.length > 0 && renderFilterChips(historyFilter, setHistoryFilter)}
        {historyRacesList.length === 0 ? (
          <div style={{ ...s.cardDark, textAlign: "center", color: "var(--ink-3)", padding: "24px 16px", fontSize: 13 }}>
            {historyRacesAll.length > 0 ? t("races.filter_empty") : t("races.empty_history")}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {historyRacesList.map(renderRaceCard)}
          </div>
        )}
      </>
    );
  }

  // Mobile section — drops the "Target Races (N)" header (count is now in
  // the sub-tab label) and puts Filter on the left + Add on the right in
  // a single row. The race list reuses renderRaceCard so cards stay
  // consistent with the desktop layout.
  function renderMobileSection({ kind, list, all, filter, setFilter, emptyMessage }) {
    return (
      <>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, marginTop: 4 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {all.length > 0 && renderFilterChips(filter, setFilter)}
          </div>
          <button onClick={() => startAdd(kind)}
            style={{
              ...(addingMode === kind ? s.btn : s.btnGhost),
              padding: "6px 12px", fontSize: 12, flexShrink: 0,
            }}>
            + {kind === "target" ? t("races.add_target_short") : t("races.add_history_short")}
          </button>
        </div>
        {list.length === 0 ? (
          <div style={{ ...s.cardDark, textAlign: "center", color: "var(--ink-3)", padding: "24px 16px", fontSize: 13 }}>
            {emptyMessage}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {list.map(renderRaceCard)}
          </div>
        )}
      </>
    );
  }

  // ── Mobile layout ──────────────────────────────────────────────────────
  // Top tabs: Races (left, default) | PR (right). Inside Races, full-width
  // sub-tabs Target / History; the count lives in the sub-tab label so the
  // section header above the list goes away. Filter + Add share one row.
  if (isMobile) {
    return (
      <div>
        {/* Sticky header: top tab strip + (Races sub-tab strip when active).
            Side margins bleed past main's 14px gutters; negative top margin
            extends the background up through main's top padding so the sticky
            doesn't leave a thin visible gap when scrolled. */}
        <div style={{
          position: "sticky", top: 0, zIndex: 10,
          background: "var(--bg)",
          marginLeft: -14, marginRight: -14, paddingLeft: 14, paddingRight: 14,
          marginTop: "calc(-1 * max(env(safe-area-inset-top), 14px))",
          paddingTop: "calc(max(env(safe-area-inset-top), 14px) + 4px)",
        }}>
        {/* Top tab strip: Races (left) | PR (right) */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--rule)", marginBottom: 14 }}>
          {[
            { id: "races", label: t("races.tab_races") },
            { id: "pr",    label: t("races.tab_pr") },
          ].map(tab => {
            const active = mobileTopTab === tab.id;
            return (
              <button key={tab.id} onClick={() => setMobileTopTab(tab.id)}
                style={{
                  flex: 1, background: "transparent", border: "none",
                  padding: "12px 8px",
                  fontSize: 14, fontWeight: active ? 600 : 500,
                  color: active ? "var(--ink-1)" : "var(--ink-3)",
                  borderBottom: active ? "2px solid var(--ink-1)" : "2px solid transparent",
                  marginBottom: -1,
                  borderRadius: 0,
                }}>
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Sub-tab strip — sticks below the top tab strip when Races is active.
            Stays inside the sticky wrapper so both nav rows pin together. */}
        {mobileTopTab === "races" && (
          <div style={{
            display: "flex",
            marginBottom: 12,
            border: "1px solid var(--rule)",
            borderRadius: 2,
            background: "var(--bg-elevated)",
          }}>
            {[
              { id: "target",  label: t("races.section_target"),  count: targetRacesAll.length },
              { id: "history", label: t("races.section_history"), count: historyRacesAll.length },
            ].map((tab, i) => {
              const active = mobileSubTab === tab.id;
              return (
                <button key={tab.id} onClick={() => {
                  // Close any open Add form when switching sub-tab. Otherwise
                  // a target-add form would linger over the history list and
                  // its title text would lie ("New target race" while on
                  // History). cancelAdd resets newRace draft too.
                  if (addingMode) cancelAdd();
                  setMobileSubTab(tab.id);
                }}
                  style={{
                    flex: 1, minHeight: 36, padding: "8px 10px",
                    background: active ? "var(--ink-1)" : "transparent",
                    color: active ? "var(--ink-inv)" : "var(--ink-2)",
                    border: "none",
                    borderRight: i === 0 ? "1px solid var(--rule)" : "none",
                    fontFamily: "var(--font-sans)", fontSize: 13,
                    fontWeight: active ? 600 : 500,
                    textAlign: "center",
                    cursor: "pointer", borderRadius: 0,
                  }}>
                  {tab.label} ({tab.count})
                </button>
              );
            })}
          </div>
        )}
        </div> {/* /sticky header */}

        {mobileTopTab === "pr" && (
          <PersonalRecordsBar races={races} itraPI={itraPI} setItraPI={setItraPI} />
        )}

        {mobileTopTab === "races" && (
          <>
            {pastRaceWarning && (
              <div style={{ ...s.cardDark, marginBottom: 14, border: "1px solid #d4a017", background: "#fffbea" }}>
                <div style={{ ...s.section, color: "#7a5a00" }}>{t("races.past_warn_title")}</div>
                <div style={{ fontSize: 13, color: "#555", marginBottom: 10 }}>{t("races.past_warn_body")}</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button onClick={() => commitRace(false)} style={s.btn}>{t("races.past_warn_move")}</button>
                  <button onClick={() => setPastRaceWarning(null)} style={s.btnGhost}>{t("common.cancel")}</button>
                </div>
              </div>
            )}

            {addingMode && !editingRaceId && renderRaceForm("add")}

            {mobileSubTab === "target" && renderMobileSection({
              kind: "target",
              list: targetRacesList,
              all: targetRacesAll,
              filter: targetFilter,
              setFilter: setTargetFilter,
              emptyMessage: targetRacesAll.length > 0 ? t("races.filter_empty") : t("races.empty_target"),
            })}
            {mobileSubTab === "history" && renderMobileSection({
              kind: "history",
              list: historyRacesList,
              all: historyRacesAll,
              filter: historyFilter,
              setFilter: setHistoryFilter,
              emptyMessage: historyRacesAll.length > 0 ? t("races.filter_empty") : t("races.empty_history"),
            })}
          </>
        )}
      </div>
    );
  }

  // ── Desktop layout (unchanged): PR bar, both lists stacked ─────────────
  return (
    <div>
      <PersonalRecordsBar races={races} itraPI={itraPI} setItraPI={setItraPI} />

      <div style={{ marginBottom: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={() => startAdd("target")} style={addingMode === "target" ? s.btn : s.btnGhost}>{t("races.add_target")}</button>
        <button onClick={() => startAdd("history")} style={addingMode === "history" ? s.btn : s.btnGhost}>{t("races.add_history")}</button>
        <span style={{ ...s.muted, fontSize: 11 }}>{t("races.edit_hint")}</span>
      </div>

      {pastRaceWarning && (
        <div style={{ ...s.cardDark, marginBottom: 14, border: "1px solid #d4a017", background: "#fffbea" }}>
          <div style={{ ...s.section, color: "#7a5a00" }}>{t("races.past_warn_title")}</div>
          <div style={{ fontSize: 13, color: "#555", marginBottom: 10 }}>{t("races.past_warn_body")}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => commitRace(false)} style={s.btn}>{t("races.past_warn_move")}</button>
            <button onClick={() => setPastRaceWarning(null)} style={s.btnGhost}>{t("common.cancel")}</button>
          </div>
        </div>
      )}

      {addingMode && !editingRaceId && renderRaceForm("add")}

      {renderTargetSection()}
      {renderHistorySection()}
    </div>
  );

  // Single-line card layout — mirrors the activity row pattern so all metric
  // columns line up vertically across many rows. Layout (left to right):
  //   date | priority? | category-tag | subtype? | name + (distance · +ascent)
  //   | spacer | time | ✕
  // For Trail we surface distance + ascent inline after the name; road
  // categories (HM/M/10K) get their distance from the category tag itself.
  function renderRaceCardInner(r, timeStr) {
    const distStr = r.distance > 0 ? `${r.distance} km` : "";
    const ascStr  = r.ascent && parseInt(r.ascent) > 0 ? `+${r.ascent} m` : "";

    // Mobile: fixed-shape card.
    //   Row 1 = date · priority · category tag · delete (every race).
    //   Row 2 = race name (ellipsised) · time (right) — every race.
    //   Row 3 = distance + ascent — Trail category only (it doesn't carry
    //           the distance in its category tag the way Marathon/HM/10K
    //           do, so the trail row needs to surface them explicitly).
    if (isNarrow) {
      const isTrailLike = r.category === "Trail";
      // Row 2 suffix: time (always) + ascent (only when NOT trail, since
      // trail moves ascent to row 3 with distance).
      const row2Suffix = [];
      if (!isTrailLike && ascStr) row2Suffix.push(ascStr);
      if (timeStr) row2Suffix.push(timeStr);
      // Row 3 parts: trail-only, distance + ascent.
      const row3Parts = [];
      if (isTrailLike) {
        if (distStr) row3Parts.push(distStr);
        if (ascStr) row3Parts.push(ascStr);
      }
      return (
        <div key={r.id} onClick={() => startEdit(r)}
          style={{
            ...s.card, cursor: "pointer",
            display: "flex", flexDirection: "column",
            gap: 5, padding: "10px 14px",
          }}>
          {/* Row 1: date · priority · category · subtype · delete (no wrap) */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
            <span style={{
              fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-3)",
              fontVariantNumeric: "tabular-nums", flexShrink: 0,
            }}>{r.date || "—"}</span>
            {r.isTarget && r.priority && (
              <span style={{
                fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600,
                color: r.priority === "A" ? "var(--ink-inv)" : "var(--ink-1)",
                background: r.priority === "A" ? "var(--ink-1)" : r.priority === "B" ? "var(--moss-bg)" : "transparent",
                border: "1px solid " + (r.priority === "A" ? "var(--ink-1)" : "var(--rule)"),
                padding: "2px 7px", flexShrink: 0,
              }}>▲ {r.priority}</span>
            )}
            {renderCategoryTag(r.category)}
            {r.subtype && <span style={{ ...s.subTag, flexShrink: 0 }}>{r.subtype}</span>}
            <div style={{ flex: 1 }} />
            <button onClick={(e) => { e.stopPropagation(); deleteRace(r.id); }}
              aria-label="Delete"
              style={{ border: "none", background: "none", color: "var(--ink-3)", cursor: "pointer", fontSize: 13, padding: "0 4px", minHeight: 24, flexShrink: 0 }}>✕</button>
          </div>
          {/* Row 2: name (truncate) + time/ascent suffix (right-aligned) */}
          <div style={{ display: "flex", gap: 10, alignItems: "baseline", minWidth: 0 }}>
            <span
              title={r.name}
              style={{
                fontWeight: 500, fontSize: 14, color: "var(--ink-1)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                minWidth: 0, flex: 1,
              }}>
              {r.name}
            </span>
            {row2Suffix.length > 0 && (
              <span style={{
                fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-3)",
                fontVariantNumeric: "tabular-nums", flexShrink: 0,
              }}>{row2Suffix.join(" · ")}</span>
            )}
          </div>
          {/* Row 3: Trail-only, distance + ascent */}
          {row3Parts.length > 0 && (
            <div style={{
              fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-3)",
              fontVariantNumeric: "tabular-nums",
            }}>
              {row3Parts.join(" · ")}
            </div>
          )}
          {!r.category && (
            <select value=""
              onClick={(e) => e.stopPropagation()}
              onChange={e => updateRaceCategory(r.id, e.target.value)}
              style={{ ...s.input, padding: "3px 6px", fontSize: 11, color: "#888" }}>
              <option value="">{t("races.set_category")}</option>
              {RACE_CATEGORIES.map(c => <option key={c} value={c}>{t(`enum.race_cat.${c}`)}</option>)}
            </select>
          )}
          {r.itraScore && <span style={{ ...s.subTag, fontSize: 10, alignSelf: "flex-start" }}>ITRA {r.itraScore}</span>}
        </div>
      );
    }

    // Desktop: fixed-column grid so distance and ascent line up vertically
    // across every row, even when some races have neither (road categories,
    // Spartan, Hyrox). The same template is used for target + history sections
    // so the two lists also align column-for-column.
    return (
      <div key={r.id} onClick={() => startEdit(r)}
        style={{
          ...s.card, cursor: "pointer", padding: "10px 14px",
          display: "grid",
          gridTemplateColumns: RACE_ROW_GRID,
          alignItems: "center", gap: 12,
        }}>
        {/* date */}
        <div style={{
          fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--ink-3)",
          fontVariantNumeric: "tabular-nums",
        }}>{r.date || "—"}</div>

        {/* priority (target only — empty cell for history keeps the grid aligned) */}
        <div>
          {r.isTarget && r.priority && (
            <span style={{
              fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600,
              color: r.priority === "A" ? "var(--ink-inv)" : "var(--ink-1)",
              background: r.priority === "A" ? "var(--ink-1)" : r.priority === "B" ? "var(--moss-bg)" : "transparent",
              border: "1px solid " + (r.priority === "A" ? "var(--ink-1)" : "var(--rule)"),
              padding: "2px 8px",
              whiteSpace: "nowrap",
            }}>▲ {r.priority}</span>
          )}
        </div>

        {/* category + optional subtype, clustered side-by-side. Auto-width so
            the subtype (e.g. Spartan ULTRA) sits flush against the category;
            name then begins immediately to the right. */}
        <div style={{ display: "flex", gap: 6, alignItems: "center", minWidth: 0 }}>
          {r.category ? renderCategoryTag(r.category) : (
            <select value=""
              onClick={(e) => e.stopPropagation()}
              onChange={e => updateRaceCategory(r.id, e.target.value)}
              style={{ ...s.input, padding: "3px 6px", fontSize: 11, color: "#888" }}>
              <option value="">{t("races.set_category")}</option>
              {RACE_CATEGORIES.map(c => <option key={c} value={c}>{t(`enum.race_cat.${c}`)}</option>)}
            </select>
          )}
          {r.subtype && <span style={s.subTag}>{r.subtype}</span>}
        </div>

        {/* name — fills remaining space, truncates */}
        <div style={{
          fontWeight: 500, fontSize: 14, color: "var(--ink-1)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          minWidth: 0,
        }}>{r.name}</div>

        {/* distance column */}
        <div style={{
          fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-3)",
          fontVariantNumeric: "tabular-nums", textAlign: "right",
        }}>{distStr}</div>

        {/* ascent column */}
        <div style={{
          fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-3)",
          fontVariantNumeric: "tabular-nums", textAlign: "right",
        }}>{ascStr}</div>

        {/* time + ITRA column (history rows; empty for target) */}
        <div style={{
          fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums",
          display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2,
        }}>
          {timeStr && (
            <span style={{
              fontSize: 14, fontWeight: 500, color: "var(--ink-1)",
              letterSpacing: "-0.01em",
              display: "inline-flex", alignItems: "center", gap: 5,
            }}>
              <span style={{ color: "var(--ink-3)" }}><ClockIcon size={13} /></span>
              {timeStr}
            </span>
          )}
          {r.itraScore && (
            <span style={{ ...s.subTag, fontSize: 10 }}>ITRA {r.itraScore}</span>
          )}
        </div>

        {/* delete */}
        <button onClick={(e) => { e.stopPropagation(); deleteRace(r.id); }}
          style={{ border: "none", background: "none", color: "var(--ink-3)", cursor: "pointer", fontSize: 14, padding: 0, lineHeight: 1, justifySelf: "end" }}>✕</button>
      </div>
    );
  }

  // Renders the add/edit form. Layout:
  //   Row 1: Category + Race name
  //   Row 2: Date + Distance + Ascent (each shown based on category)
  //   ITRA row: only for Trail HISTORY races
  //   Time row: only for HISTORY races
  function renderRaceForm(mode) {
    const isEdit = mode === "edit";
    // Field visibility by category. Road races (HM/M/10K) skip ascent;
    // Hyrox is fixed-format indoor so skips both distance and ascent.
    const isRoadOnly = ["Half Marathon", "Marathon", "10K"].includes(newRace.category);
    const isHyrox = newRace.category === "Hyrox";
    const isSpartan = newRace.category === "Spartan";
    const showAscent = !isRoadOnly && !isHyrox && !isSpartan;
    // Distance hidden when the category itself implies the distance (road
    // categories like Half Marathon / Marathon / 10K), when the format is
    // fixed-indoor (Hyrox), or when the user picks a Spartan tier (tier
    // already carries the size signal). Trail still shows it.
    const showDistance = !isHyrox && !isRoadOnly && !isSpartan;
    // ITRA fields removed from the form per user request (2026-05). The DB
    // column is retained for backward compat with already-imported data.
    const showItra = false;

    return (
      <div style={{ ...s.cardDark, marginBottom: 14 }}>
        <div style={s.section}>
          {isEdit
            ? t("races.edit_title")
            : (newRace.isTarget ? t("races.new_target") : t("races.new_history"))}
        </div>

        {newRace.isTarget && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ ...s.label, marginBottom: 6 }}>{t("races.priority")}</div>
            <div style={{ display: "flex", gap: 6 }}>
              {RACE_PRIORITY.map(p => (
                <button key={p} onClick={() => setNewRace({ ...newRace, priority: p })}
                  style={s.chip(newRace.priority === p)}>{p}{t("races.priority_suffix")}</button>
              ))}
            </div>
            <div style={{ ...s.muted, marginTop: 4, fontSize: 11 }}>{t("races.priority_hint")}</div>
          </div>
        )}

        {/* Mobile: race name on its own row (full width — input is what the
            user actually types so it needs the most space), then Date +
            Category on one row. Category dropdown gets a short label for
            "Half Marathon" so it doesn't overflow the cell. */}
        {isMobile ? (
          <>
            <div style={{ marginBottom: 10 }}>
              <div style={{ ...s.label, marginBottom: 6 }}>{t("races.name_label")}</div>
              <input placeholder={t("races.name_placeholder")} value={newRace.name}
                onChange={e => setNewRace({ ...newRace, name: e.target.value })}
                style={s.input} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
              <div>
                <div style={{ ...s.label, marginBottom: 6 }}>{t("races.date_label")}</div>
                <input type="date" value={newRace.date}
                  onChange={e => setNewRace({ ...newRace, date: e.target.value })}
                  style={s.input} />
              </div>
              <div>
                <div style={{ ...s.label, marginBottom: 6 }}>{t("races.category_label")}</div>
                <select value={newRace.category}
                  onChange={e => setNewRace({ ...newRace, category: e.target.value })}
                  style={s.input}>
                  <option value="">{t("races.category_placeholder")}</option>
                  {RACE_CATEGORIES.map(c => (
                    <option key={c} value={c}>
                      {/* Abbreviate Half Marathon on the narrow phone select. */}
                      {c === "Half Marathon" ? t("enum.race_cat.Half Marathon_short") : t(`enum.race_cat.${c}`)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </>
        ) : (
          /* Desktop unchanged: Category (200px) + Name (flex) on one row. */
          <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 10, marginBottom: 10 }}>
            <div>
              <div style={{ ...s.label, marginBottom: 6 }}>{t("races.category_label")}</div>
              <select value={newRace.category}
                onChange={e => setNewRace({ ...newRace, category: e.target.value })}
                style={s.input}>
                <option value="">{t("races.category_placeholder")}</option>
                {RACE_CATEGORIES.map(c => <option key={c} value={c}>{t(`enum.race_cat.${c}`)}</option>)}
              </select>
            </div>
            <div>
              <div style={{ ...s.label, marginBottom: 6 }}>{t("races.name_label")}</div>
              <input placeholder={t("races.name_placeholder")} value={newRace.name}
                onChange={e => setNewRace({ ...newRace, name: e.target.value })}
                style={s.input} />
            </div>
          </div>
        )}

        {/* Spartan-only: pick the event tier. Acts as the "size" signal in
            place of distance/ascent for this category. */}
        {isSpartan && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ ...s.label, marginBottom: 6 }}>{t("races.spartan_tier")}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {SPARTAN_SUBTYPES.map(st => (
                <button key={st} type="button"
                  onClick={() => setNewRace({ ...newRace, subtype: st })}
                  style={s.chip(newRace.subtype === st)}>{t(`enum.spartan.${st}`)}</button>
              ))}
            </div>
          </div>
        )}

        {/* Mobile: Distance + Ascent on one row (2-col); Date already covered
            in the row above with Category. Desktop: Date + Distance + Ascent
            in a 3-col row as before. The `(km)` suffix in the label is dropped
            on mobile so the label doesn't wrap to two lines in the narrow cell
            and break the row alignment. */}
        {isMobile ? (
          (showDistance || showAscent) && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, marginBottom: 10 }}>
              {showDistance && (
                <div>
                  <div style={{ ...s.label, marginBottom: 6 }}>{t("races.distance_label_short")}</div>
                  <input type="number" step="0.001" placeholder="km" value={newRace.distance}
                    onChange={e => setNewRace({ ...newRace, distance: e.target.value })}
                    style={s.input} />
                </div>
              )}
              {showAscent && (
                <div>
                  <div style={{ ...s.label, marginBottom: 6 }}>{t("races.ascent_label_short")}</div>
                  <input type="number" placeholder="m" value={newRace.ascent}
                    onChange={e => setNewRace({ ...newRace, ascent: e.target.value })}
                    style={s.input} />
                </div>
              )}
            </div>
          )
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginBottom: 10 }}>
            <div>
              <div style={{ ...s.label, marginBottom: 6 }}>{t("races.date_label")}</div>
              <input type="date" value={newRace.date}
                onChange={e => setNewRace({ ...newRace, date: e.target.value })}
                style={s.input} />
            </div>
            {showDistance && (
              <div>
                <div style={{ ...s.label, marginBottom: 6 }}>{t("races.distance_label")}</div>
                <input type="number" step="0.001" placeholder="0" value={newRace.distance}
                  onChange={e => setNewRace({ ...newRace, distance: e.target.value })}
                  style={s.input} />
              </div>
            )}
            {showAscent && (
              <div>
                <div style={{ ...s.label, marginBottom: 6 }}>{t("races.ascent_label")}</div>
                <input type="number" placeholder="0" value={newRace.ascent}
                  onChange={e => setNewRace({ ...newRace, ascent: e.target.value })}
                  style={s.input} />
              </div>
            )}
          </div>
        )}

        {/* ITRA — Trail history races only */}
        {showItra && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginBottom: 10 }}>
            <div>
              <div style={{ ...s.label, marginBottom: 6 }}>{t("races.itra_label")}</div>
              <input type="number" placeholder="0" value={newRace.itraScore}
                onChange={e => setNewRace({ ...newRace, itraScore: e.target.value })}
                style={s.input} />
            </div>
          </div>
        )}

        {/* Time fields only for history races — target races don't have a finish time yet */}
        {!newRace.isTarget && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ ...s.label, marginBottom: 6 }}>{t("races.result_time")}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <input type="number" placeholder={t("races.h")} value={newRace.resultH} onChange={e => setNewRace({ ...newRace, resultH: e.target.value })} style={s.input} />
              <input type="number" placeholder={t("races.m")} value={newRace.resultM} onChange={e => setNewRace({ ...newRace, resultM: e.target.value })} style={s.input} />
              <input type="number" placeholder={t("races.s")} value={newRace.resultS} onChange={e => setNewRace({ ...newRace, resultS: e.target.value })} style={s.input} />
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={tryAddRace} style={s.btn}>{isEdit ? t("common.save_changes") : t("common.save")}</button>
          <button onClick={() => {
            if (isEdit) cancelEdit();
            else { cancelAdd(); }
          }} style={s.btnGhost}>{t("common.cancel")}</button>
        </div>
      </div>
    );
  }
}
