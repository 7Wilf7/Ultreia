import { useState, useEffect } from "react";
import { s } from "../styles";
import { RACE_PRIORITY, RACE_CATEGORIES, RACE_CATEGORY_COLOR } from "../constants";
import { useT } from "../i18n/LanguageContext";
import { inferRaceCategory } from "../utils/migrate";
import { parseDistanceKm } from "../utils/format";
import { useClickOutside } from "../utils/useClickOutside";
import { RouteIcon, PeakIcon, ClockIcon } from "./Icons";

const EMPTY_RACE = (isTarget) => ({
  isTarget, priority: "A", name: "", date: "",
  distance: "", category: "", ascent: "", resultH: "", resultM: "", resultS: "",
  itraScore: "", isTrailDetected: null,
});

const BOCHA_ENDPOINT = "https://api.bochaai.com/v1/web-search";

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
    ascent: race.ascent || "",
    resultH: race.resultH || "",
    resultM: race.resultM || "",
    resultS: race.resultS || "",
    itraScore: race.itraScore || "",
    isTrailDetected: race.isTrailDetected ?? null,
  };
}

export function RacesTab({ races, setRaces, now, setConfirmDelete, apiKey, apiEndpoint, apiModel, bochaApiKey }) {
  const t = useT();
  const [showRaceAdd, setShowRaceAdd] = useState(false);
  const [editingRaceId, setEditingRaceId] = useState(null);
  const [raceMode, setRaceMode] = useState("target");
  const [newRace, setNewRace] = useState(EMPTY_RACE(true));
  const [raceLookupMsg, setRaceLookupMsg] = useState("");
  const [raceLookupLoading, setRaceLookupLoading] = useState(false);
  const [raceCategoryModal, setRaceCategoryModal] = useState(null);
  const [pastRaceWarning, setPastRaceWarning] = useState(null);

  useEffect(() => {
    setShowRaceAdd(false);
    setEditingRaceId(null);
    setRaceLookupMsg("");
    setRaceCategoryModal(null);
    setPastRaceWarning(null);
    setNewRace(EMPTY_RACE(raceMode === "target"));
  }, [raceMode]);

  function startEdit(race) {
    setEditingRaceId(race.id);
    setShowRaceAdd(false);
    setNewRace(raceToForm(race));
    setRaceLookupMsg("");
    setRaceCategoryModal(null);
  }

  function cancelEdit() {
    setEditingRaceId(null);
    setNewRace(EMPTY_RACE(raceMode === "target"));
    setRaceLookupMsg("");
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
    setRaces(races.map(r => r.id === id ? { ...r, category } : r));
  }

  async function lookupRace(input) {
    // Two-step lookup: Bocha web search → AI Coach LLM parses results into structured categories.
    // Both keys are required; warn early if either is missing.
    if (!bochaApiKey) {
      setRaceLookupMsg(t("races.lookup_no_bocha"));
      setTimeout(() => setRaceLookupMsg(""), 6000);
      return;
    }
    if (!apiKey) {
      setRaceLookupMsg(t("races.lookup_no_coach"));
      setTimeout(() => setRaceLookupMsg(""), 6000);
      return;
    }
    setRaceLookupLoading(true);
    setRaceLookupMsg(t("races.lookup_searching_web"));

    const currentDate = now.toISOString().slice(0, 10);
    const searchHint = newRace.isTarget
      ? `The user is adding a FUTURE target race. Today is ${currentDate}. Prefer the NEXT upcoming edition if you know its date; otherwise omit the date and let the user fill it in.`
      : `The user is adding a HISTORICAL race result. Today is ${currentDate}. The edition is in the past.`;

    // --- Step 1: Bocha web search ---
    let searchResults;
    try {
      const bochaResp = await fetch(BOCHA_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${bochaApiKey}`,
        },
        body: JSON.stringify({
          query: input,
          freshness: "noLimit",
          summary: true,
          count: 8,
        }),
      });
      const bochaData = await bochaResp.json();
      if (!bochaResp.ok || (bochaData.code && bochaData.code !== 200)) {
        const msg = bochaData.msg || bochaData.message || `HTTP ${bochaResp.status}`;
        setRaceLookupMsg(t("races.lookup_bocha_error", { msg }));
        setTimeout(() => setRaceLookupMsg(""), 6000);
        setRaceLookupLoading(false);
        return;
      }
      searchResults = bochaData?.data?.webPages?.value || [];
      if (searchResults.length === 0) {
        setRaceLookupMsg(t("races.lookup_no_results"));
        setTimeout(() => setRaceLookupMsg(""), 5000);
        setRaceLookupLoading(false);
        return;
      }
    } catch (err) {
      console.error("[Race Lookup] Bocha error:", err);
      setRaceLookupMsg(t("races.lookup_bocha_error", { msg: err.message }));
      setTimeout(() => setRaceLookupMsg(""), 5000);
      setRaceLookupLoading(false);
      return;
    }

    // --- Step 2: hand snippets to AI Coach LLM for structured extraction ---
    setRaceLookupMsg(t("races.lookup_parsing"));
    const snippets = searchResults.slice(0, 8).map((r, i) =>
      `[${i + 1}] ${r.name || ""}\nURL: ${r.url || ""}\n${r.summary || r.snippet || ""}`
    ).join("\n\n");

    // max_tokens 8000: reasoning models (deepseek-v4-pro) burn most tokens in `thinking` blocks
    // before producing text output. 1000 was too low and stopped the model mid-think (max_tokens stop_reason).
    const parseBody = {
      model: apiModel,
      max_tokens: 8000,
      messages: [{
        role: "user",
        content: `Today's date is ${currentDate}. The user entered race name: "${input}".

${searchHint}

Below are web search results about this race. Extract structured info from them.

WEB RESULTS:
${snippets}

Return one JSON object only (no prose, no markdown):
{"baseName": "Official base name without year", "year": "YYYY", "date": "YYYY-MM-DD or empty (event-level date when no per-category dates)", "isTrail": true/false, "raceFamily": "<one of: Half Marathon | Marathon | 10K | Trail | Spartan | Hyrox | Other>", "categories": [{"name": "Category", "distance": "Distance with km/miles", "category": "<one of the raceFamily values>", "ascent": "Number only or empty", "date": "YYYY-MM-DD or empty"}]}

- raceFamily = overall classification of the race event.
- For each category, same raceFamily applies (e.g. UTMB has Trail family, CCC/OCC/UTMB-main are all Trail).
- isTrail: true if it's off-road/mountain.
- For trail races: list all distance categories with typical ascent (numbers only, e.g. "1200").
- For road races: list distance options, ascent empty.
- Only output dates you can verify from the search snippets above. If unsure, leave date empty.
- Top-level "date" should be the main event date when there are no per-category dates, or empty if unknown.
- If the snippets don't cover this race: {"baseName": "${input}", "year": "", "date": "", "isTrail": false, "raceFamily": "Other", "categories": []}
JSON ONLY.`,
      }],
    };

    try {
      const resp = await fetch(apiEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify(parseBody),
      });
      const data = await resp.json();
      if (!resp.ok || data.error) {
        const msg = data.error?.message || `HTTP ${resp.status}`;
        setRaceLookupMsg(t("races.lookup_api_error", { msg }));
        setTimeout(() => setRaceLookupMsg(""), 6000);
        setRaceLookupLoading(false);
        return;
      }
      const text = data.content?.filter(b => b.type === "text").map(b => b.text).join("") || "";
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        const family = RACE_CATEGORIES.includes(parsed.raceFamily) ? parsed.raceFamily : "";
        setNewRace(prev => ({ ...prev, isTrailDetected: parsed.isTrail, category: family || prev.category }));
        if (parsed.categories && parsed.categories.length > 0) {
          setRaceCategoryModal(parsed);
          setRaceLookupMsg(t("races.lookup_categories_web", { n: parsed.categories.length }));
        } else {
          // No sub-categories — fall back to event-level fields. Top-level date helps for events
          // without per-category breakdown (single-distance road races, future editions).
          setNewRace(prev => ({
            ...prev,
            name: parsed.baseName ? `${parsed.year} ${parsed.baseName}`.trim() : input,
            date: parsed.date || prev.date,
            isTrailDetected: parsed.isTrail,
            category: family || prev.category,
          }));
          setRaceLookupMsg(parsed.date ? t("races.lookup_name_date_web") : t("races.lookup_name_web"));
          setTimeout(() => setRaceLookupMsg(""), 5000);
        }
      } else {
        setRaceLookupMsg(t("races.lookup_parse_fail"));
        setTimeout(() => setRaceLookupMsg(""), 4000);
      }
    } catch (err) {
      console.error("[Race Lookup] LLM parse error:", err);
      setRaceLookupMsg(t("races.lookup_search_fail", { msg: err.message }));
      setTimeout(() => setRaceLookupMsg(""), 5000);
    }
    setRaceLookupLoading(false);
  }

  function selectRaceCategory(cat) {
    const category = RACE_CATEGORIES.includes(cat.category)
      ? cat.category
      : (RACE_CATEGORIES.includes(raceCategoryModal.raceFamily) ? raceCategoryModal.raceFamily : "");
    // LLM returns distance as a string like "42.195km"; normalize for the form input.
    const distNum = parseDistanceKm(cat.distance);
    setNewRace(prev => ({
      ...prev,
      name: `${raceCategoryModal.year} ${raceCategoryModal.baseName} - ${cat.name}`,
      distance: distNum > 0 ? String(distNum) : "",
      ascent: cat.ascent || "",
      date: cat.date || prev.date,
      category: category || prev.category,
      isTrailDetected: raceCategoryModal.isTrail,
    }));
    setRaceCategoryModal(null);
    setRaceLookupMsg(t("races.lookup_filled"));
    setTimeout(() => setRaceLookupMsg(""), 4000);
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

  function commitRace(asTarget) {
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
    if (editingRaceId) {
      setRaces(races.map(r => r.id === editingRaceId ? { ...r, ...built } : r));
    } else {
      setRaces([{ id: Date.now(), ...built }, ...races]);
    }
    setNewRace(EMPTY_RACE(raceMode === "target"));
    setShowRaceAdd(false);
    setEditingRaceId(null);
    setRaceLookupMsg("");
    setPastRaceWarning(null);
  }

  // Sort: target races by date ASC (next race coming up first); history by date DESC (most recent first).
  // Missing date sorts last for targets and first for history (treated as "unknown future" / "recent unknown").
  const targetRacesList = races.filter(r => r.isTarget).sort((a, b) => {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return new Date(a.date) - new Date(b.date);
  });
  const historyRacesList = races.filter(r => !r.isTarget).sort((a, b) => {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return new Date(b.date) - new Date(a.date);
  });

  function renderCategoryTag(cat) {
    if (!cat) return null;
    return (
      <span style={{
        fontSize: 11, padding: "2px 8px", borderRadius: 10,
        background: RACE_CATEGORY_COLOR[cat] || "#f0f0f0",
        color: "#333", fontWeight: 500, whiteSpace: "nowrap",
      }}>{t(`enum.race_cat.${cat}`)}</span>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        <button onClick={() => setRaceMode("target")} style={s.chip(raceMode === "target")}>{t("races.target_tab", { n: targetRacesList.length })}</button>
        <button onClick={() => setRaceMode("history")} style={s.chip(raceMode === "history")}>{t("races.history_tab", { n: historyRacesList.length })}</button>
      </div>

      <div style={{ marginBottom: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={() => {
          if (editingRaceId) cancelEdit();
          setNewRace(EMPTY_RACE(raceMode === "target"));
          setShowRaceAdd(!showRaceAdd);
        }} style={s.btn}>{raceMode === "target" ? t("races.add_target") : t("races.add_history")}</button>
        <span style={{ ...s.muted, fontSize: 11 }}>{t("races.edit_hint")}</span>
      </div>

      {pastRaceWarning && (
        <div style={{ ...s.cardDark, marginBottom: 14, border: "1px solid #d4a017", background: "#fffbea" }}>
          <div style={{ ...s.section, color: "#7a5a00" }}>{t("races.past_warn_title")}</div>
          <div style={{ fontSize: 13, color: "#555", marginBottom: 10 }}>{t("races.past_warn_body")}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => { setRaceMode("history"); commitRace(false); }} style={s.btn}>{t("races.past_warn_move")}</button>
            <button onClick={() => setPastRaceWarning(null)} style={s.btnGhost}>{t("common.cancel")}</button>
          </div>
        </div>
      )}

      {raceCategoryModal && (
        <div style={{ ...s.cardDark, marginBottom: 14, border: "1px solid #888" }}>
          <div style={s.section}>{t("races.cat_modal_title", { name: raceCategoryModal.baseName })}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {raceCategoryModal.categories.map((cat, i) => (
              <button key={i} onClick={() => selectRaceCategory(cat)}
                style={{ ...s.btnGhost, justifyContent: "flex-start", textAlign: "left", padding: "10px 14px" }}>
                <div style={{ fontWeight: 500, fontSize: 14 }}>{cat.name}</div>
                <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
                  {cat.distance}{cat.ascent ? ` · +${cat.ascent}m` : ""}{cat.date ? ` · ${cat.date}` : ""}
                </div>
              </button>
            ))}
            <button onClick={() => setRaceCategoryModal(null)} style={{ ...s.btnGhost, fontSize: 12, marginTop: 6 }}>{t("common.cancel")}</button>
          </div>
        </div>
      )}

      {/* Add-mode form sits at the top. Edit-mode form replaces the card in-place (rendered inside the list below). */}
      {showRaceAdd && !editingRaceId && renderRaceForm("add")}

      {(raceMode === "target" ? targetRacesList : historyRacesList).length === 0 ? (
        <div style={{ ...s.cardDark, textAlign: "center", color: "#888", padding: "30px 16px" }}>
          {raceMode === "target" ? t("races.empty_target") : t("races.empty_history")}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {(raceMode === "target" ? targetRacesList : historyRacesList).map(r => {
            const timeStr = [r.resultH, r.resultM, r.resultS].some(Boolean)
              ? `${r.resultH || "0"}:${String(r.resultM || "0").padStart(2, "0")}:${String(r.resultS || "0").padStart(2, "0")}`
              : "";
            if (editingRaceId === r.id) {
              return <div key={r.id} ref={editFormRef}>{renderRaceForm("edit")}</div>;
            }
            return (
              <div key={r.id} onClick={() => startEdit(r)}
                style={{ ...s.card, cursor: "pointer" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                    {r.isTarget && r.priority && (
                      <span style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 12,
                        fontWeight: 600,
                        color: r.priority === "A" ? "var(--ink-inv)" : "var(--ink-1)",
                        background: r.priority === "A" ? "var(--ink-1)" : r.priority === "B" ? "var(--moss-bg)" : "transparent",
                        border: "1px solid " + (r.priority === "A" ? "var(--ink-1)" : "var(--rule)"),
                        padding: "2px 8px",
                      }}>▲ {r.priority}</span>
                    )}
                    <div style={{ fontWeight: 500, fontSize: 15, color: "var(--ink-1)" }}>{r.name}</div>
                    {renderCategoryTag(r.category)}
                  </div>
                  <div style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
                    <div style={{ ...s.dataNum, fontSize: 13, color: "var(--ink-3)" }}>{r.date}</div>
                    <button onClick={(e) => { e.stopPropagation(); deleteRace(r.id); }}
                      style={{ border: "none", background: "none", color: "var(--ink-3)", cursor: "pointer", fontSize: 14, padding: 0, lineHeight: 1 }}>✕</button>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>
                  {r.distance > 0 && (
                    <span style={{ fontSize: 14, color: "var(--ink-1)", display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <span style={{ color: "var(--ink-3)" }}><RouteIcon size={13} /></span>
                      {r.distance}<span style={{ color: "var(--ink-3)", marginLeft: 1, fontSize: 11 }}>km</span>
                    </span>
                  )}
                  {r.ascent && (
                    <span style={{ fontSize: 14, color: "var(--moss-deep)", display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <span style={{ color: "var(--moss)" }}><PeakIcon size={13} /></span>
                      +{r.ascent}<span style={{ color: "var(--ink-3)", marginLeft: 1, fontSize: 11 }}>m</span>
                    </span>
                  )}
                  {timeStr && (
                    <span style={{ fontSize: 17, fontWeight: 500, color: "var(--ink-1)", letterSpacing: "-0.01em", display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <span style={{ color: "var(--ink-3)" }}><ClockIcon size={13} /></span>
                      {timeStr}
                    </span>
                  )}
                  {r.itraScore && <span style={s.subTag}>ITRA {r.itraScore}</span>}
                  {!r.category && (
                    <select value=""
                      onClick={(e) => e.stopPropagation()}
                      onChange={e => updateRaceCategory(r.id, e.target.value)}
                      style={{ ...s.input, width: "auto", padding: "3px 6px", fontSize: 11, color: "#888" }}>
                      <option value="">{t("races.set_category")}</option>
                      {RACE_CATEGORIES.map(c => <option key={c} value={c}>{t(`enum.race_cat.${c}`)}</option>)}
                    </select>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  // Renders the add/edit form. Goal time is hidden for target races (only finished races have actual result times).
  function renderRaceForm(mode) {
    const isEdit = mode === "edit";
    return (
      <div style={{ ...s.cardDark, marginBottom: 14 }}>
        <div style={s.section}>
          {isEdit
            ? t("races.edit_title")
            : (raceMode === "target" ? t("races.new_target") : t("races.new_history"))}
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

        <div style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input placeholder={t("races.name_placeholder")} value={newRace.name}
              onChange={e => setNewRace({ ...newRace, name: e.target.value })}
              style={{ ...s.input, flex: 1 }} />
            <button onClick={() => lookupRace(newRace.name)}
              disabled={raceLookupLoading || !newRace.name.trim()}
              title={t("races.lookup_web")}
              style={{ ...s.btnGhost, padding: "9px 14px", opacity: raceLookupLoading ? 0.5 : 1 }}>
              {raceLookupLoading ? "..." : "🔍"}
            </button>
          </div>
          <div style={{ fontSize: 11, color: "#888", marginTop: 6, lineHeight: 1.5 }}>
            {t("races.lookup_web_hint")}
          </div>
          {raceLookupMsg && <div style={{ fontSize: 11, color: "#444", marginTop: 4 }}>{raceLookupMsg}</div>}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
          <input type="date" value={newRace.date}
            onChange={e => setNewRace({ ...newRace, date: e.target.value })}
            onClick={e => e.currentTarget.showPicker?.()}
            style={{ ...s.input, cursor: "pointer" }} />
          <input type="number" step="0.001" placeholder={t("races.distance_placeholder")} value={newRace.distance} onChange={e => setNewRace({ ...newRace, distance: e.target.value })} style={s.input} />
          <select value={newRace.category}
            onChange={e => setNewRace({ ...newRace, category: e.target.value })}
            style={s.input}>
            <option value="">{t("races.category_placeholder")}</option>
            {RACE_CATEGORIES.map(c => <option key={c} value={c}>{t(`enum.race_cat.${c}`)}</option>)}
          </select>
        </div>

        {newRace.isTrailDetected !== false && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
            <input placeholder={t("races.ascent_placeholder")} value={newRace.ascent} onChange={e => setNewRace({ ...newRace, ascent: e.target.value })} style={s.input} />
            <input placeholder={t("races.itra_placeholder")} value={newRace.itraScore} onChange={e => setNewRace({ ...newRace, itraScore: e.target.value })} style={s.input} />
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
            else { setShowRaceAdd(false); setRaceLookupMsg(""); }
          }} style={s.btnGhost}>{t("common.cancel")}</button>
        </div>
      </div>
    );
  }
}
