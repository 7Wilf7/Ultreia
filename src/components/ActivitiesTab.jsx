import { useState, useRef, useMemo } from "react";
import { s } from "../styles";
import { RUN_SUBTYPES, RUN_FLAGS, RUN_PACE_TYPES, SORT_OPTIONS, ACTIVITY_TYPES, TYPE_COLOR, WEATHER_RELEVANT_TYPES } from "../constants";
import { useT, useLanguage } from "../i18n/LanguageContext";
import { useIsNarrow, useIsMobile } from "../hooks/useMediaQuery";
import {
  recommendRunType, parseTimeToSeconds,
  formatDuration, formatPaceFromSec, formatDateShort, formatWeekdayShort, isDuplicate,
} from "../utils/format";
import { computeHRZones } from "../utils/profile";
import { ActivityForm } from "./ActivityForm";
import { Dropdown } from "./Dropdown";
import { ItemActionModal } from "./ItemActionModal";
import { ModalRoot } from "./ModalRoot";
import {
  ClockIcon, HeartIcon, PeakIcon, FootIcon, BoltIcon, GaugeIcon, RouteIcon, RunnerIcon,
  PlusIcon, UploadIcon, CheckSquareIcon, SortIcon,
} from "./Icons";

// Best-effort mapping from a Garmin "Activity Type" string to one of our top-level types.
// Returns { type, unknown }. When unknown, type is a safe placeholder ("Road Run") so the row
// stays renderable while the user is prompted to pick the real mapping.
function mapGarminActivityType(at) {
  if (!at) return { type: "Road Run", unknown: true };
  if (at.includes("trail")) return { type: "Trail Run", unknown: false };
  if (at.includes("hiking") || at.includes("walking") || at === "walk") return { type: "Hiking", unknown: false };
  if (at.includes("stair") || at.includes("stepper") || at.includes("step machine") || at.includes("floor")) return { type: "Floor Climbing", unknown: false };
  if (at.includes("hiit") || at.includes("interval training") || at.includes("crossfit")) return { type: "HIIT", unknown: false };
  if (at.includes("strength") || at.includes("weight")) return { type: "Strength", unknown: false };
  if (at.includes("yoga") || at.includes("pilates") || at.includes("stretch")) return { type: "Strength", unknown: false };
  if (at.includes("run")) return { type: "Road Run", unknown: false };
  return { type: "Road Run", unknown: true };
}

export function ActivitiesTab({ logs, addLog, updateLog, bulkAddLogs, periodLogs, setConfirmDelete, profile }) {
  // Personalized HR zones derived once per render from the user's profile
  // (Resting HR + Max HR + selected Karvonen method). Threaded down into
  // ActivityForm for the chip "recommended" badge, and used inline below for
  // CSV-import row classification. recommendRunType() handles the null case
  // by falling back to the legacy hard-coded thresholds.
  const hrZones = useMemo(
    () => computeHRZones(profile?.restingHR, profile?.maxHR, profile?.hrZoneMethod),
    [profile?.restingHR, profile?.maxHR, profile?.hrZoneMethod]
  );

  const t = useT();
  const { lang } = useLanguage();
  // < 1024px: phone OR small tablet. Both can't fit the 8-column metric
  // grid plus the 300px left identifier block — switch to a stacked flex
  // layout where the metric pills wrap naturally.
  const isNarrow = useIsNarrow();
  const isMobile = useIsMobile();
  const [sortBy, setSortBy] = useState("date_desc");
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState(null); // log.id currently being edited (in a modal)
  const [actionTarget, setActionTarget] = useState(null); // log shown in the long-press Edit/Delete modal
  const [expandedId, setExpandedId] = useState(null); // mobile only — tap to expand a card
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [uploadMsg, setUploadMsg] = useState("");
  const [parsedRows, setParsedRows] = useState(null);
  const [duplicateWarning, setDuplicateWarning] = useState(null);
  const [unknownTypeRows, setUnknownTypeRows] = useState(null); // { rows, dupIds? } – staged until user maps
  const fileRef = useRef();

  const displayedLogs = useMemo(() => {
    const sorted = [...periodLogs];
    sorted.sort((a, b) => {
      switch (sortBy) {
        case "date_desc": return new Date(b.date) - new Date(a.date);
        case "date_asc": return new Date(a.date) - new Date(b.date);
        case "distance_desc": return (b.distance || 0) - (a.distance || 0);
        case "distance_asc": return (a.distance || 0) - (b.distance || 0);
        case "duration_desc": return (b.duration || 0) - (a.duration || 0);
        case "duration_asc": return (a.duration || 0) - (b.duration || 0);
        case "hr_desc": return (b.hr || 0) - (a.hr || 0);
        case "hr_asc": return (a.hr || 0) - (b.hr || 0);
        default: return 0;
      }
    });
    return sorted;
  }, [periodLogs, sortBy]);

  function deleteLog(id) {
    setConfirmDelete({ type: "log", id });
  }

  // Enter inline edit for a row — but not while it's still an optimistic
  // (not-yet-persisted) row. Editing a temp id would hit updateWorkout with
  // an id the DB doesn't have yet → write fails and the row rolls back. The
  // optimistic window is ~1–3s (weather capture + insert); the user can tap
  // again once the "saving…" cue clears.
  function startEdit(l) {
    if (l.isOptimistic) return;
    setEditingId(l.id);
    setShowAdd(false);
  }

  // Long-press (press-and-hold ~450ms) → open the Edit/Delete action modal.
  // A single timer ref is enough (one touch at a time). longPressFired
  // suppresses the click that follows so a hold doesn't also expand the card.
  const pressTimer = useRef(null);
  const longPressFired = useRef(false);
  function startPress(l) {
    if (selectMode || l.isOptimistic) return;
    longPressFired.current = false;
    pressTimer.current = setTimeout(() => { longPressFired.current = true; setActionTarget(l); }, 450);
  }
  function endPress() {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; }
  }

  function bulkDeleteSelected() {
    if (selectedIds.size === 0) return;
    setConfirmDelete({ type: "logs", ids: Array.from(selectedIds) });
  }

  function toggleSelectMode() {
    setSelectMode(!selectMode);
    setSelectedIds(new Set());
    setEditingId(null);
  }

  function toggleSelected(id) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  }

  function selectAll() {
    setSelectedIds(new Set(displayedLogs.map(l => l.id)));
  }
  function clearSelection() {
    setSelectedIds(new Set());
  }

  async function handleAddSubmit(logData) {
    try {
      await addLog(logData);
      setShowAdd(false);
    } catch {
      // alert already shown by the wrapper; keep the form open so the user can retry
    }
  }

  async function handleEditSubmit(id, logData) {
    try {
      await updateLog(id, logData);
      setEditingId(null);
    } catch {
      // keep the edit form open on failure
    }
  }

  function handleFileSelect(e) {
    const f = e.target.files[0];
    if (!f) return;
    const name = f.name.toLowerCase();
    if (name.endsWith(".csv")) {
      const reader = new FileReader();
      reader.onload = (ev) => parseGarminCSV(ev.target.result);
      reader.readAsText(f);
    } else {
      setUploadMsg(t("activities.unsupported"));
    }
    e.target.value = "";
  }

  function parseGarminCSV(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) { setUploadMsg(t("activities.csv_empty")); return; }
    const parseLine = (line) => {
      const out = []; let cur = ""; let inQ = false;
      for (const ch of line) {
        if (ch === '"') inQ = !inQ;
        else if (ch === "," && !inQ) { out.push(cur); cur = ""; } else cur += ch;
      }
      out.push(cur);
      return out.map(v => v.replace(/^"|"$/g, "").trim());
    };
    const header = parseLine(lines[0]);
    const idx = (n) => header.findIndex(h => h.toLowerCase() === n.toLowerCase());
    // Try several known Garmin column names — they vary by app version,
    // device type, and locale. First match wins.
    const idxAny = (...names) => {
      for (const n of names) {
        const i = idx(n);
        if (i >= 0) return i;
      }
      return -1;
    };
    const iType = idx("Activity Type"), iDate = idx("Date");
    const iDist = idx("Distance");
    const iTime = idxAny("Time", "Total Time", "Moving Time", "Elapsed Time");
    const iAvgHR = idx("Avg HR"), iMaxHR = idx("Max HR");
    const iAscent = idx("Total Ascent");
    const iCadence = idx("Avg Run Cadence");
    const iTE = idx("Aerobic TE");
    const iGAP = idx("Avg GAP");

    if (iTime < 0) {
      console.warn("[CSV] No duration column found. Headers were:", header);
    }

    const num = (raw) => {
      const s = String(raw || "").replace(/,/g, "").trim();
      if (!s || s === "--") return 0;
      const n = parseFloat(s);
      return isFinite(n) ? n : 0;
    };

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const c = parseLine(lines[i]);
      if (!c[iDate]) continue;
      const at = (c[iType] || "").toLowerCase();
      const mapped = mapGarminActivityType(at);

      const distance = num(c[iDist]);
      const duration = parseTimeToSeconds(c[iTime]);
      const hr = Math.round(num(c[iAvgHR]));
      const maxHR = iMaxHR >= 0 ? Math.round(num(c[iMaxHR])) : 0;
      const ascent = Math.round(num(c[iAscent]));
      const cadence = iCadence >= 0 ? Math.round(num(c[iCadence])) : 0;
      const aerobicTE = iTE >= 0 ? +num(c[iTE]).toFixed(1) : 0;
      const gap = iGAP >= 0 ? parseTimeToSeconds(c[iGAP]) : 0;
      // pace only meaningful for activities with real distance (Run/Trail/Hiking/Stair); placeholder Running for unknowns is overridden later
      const isAerobicLike = mapped.type === "Strength" || mapped.type === "HIIT";
      const pace = (!isAerobicLike && distance > 0) ? Math.round(duration / distance) : 0;
      const date = c[iDate].split(" ")[0];
      const subTypes = mapped.type === "Road Run" ? [recommendRunType(hr, false, hrZones)] : [];

      rows.push({
        id: Date.now() + i, date,
        type: mapped.type, subTypes,
        distance, duration, pace, hr, maxHR, ascent, cadence, aerobicTE, gap,
        _selected: true,
        _unknown: mapped.unknown,
        _originalType: mapped.unknown ? (c[iType] || "(empty)") : undefined,
      });
    }

    // If any row had an unrecognized type, surface the mapping modal first.
    // Duplicate detection waits until after mapping is resolved (type may change).
    const unknowns = rows.filter(r => r._unknown);
    if (unknowns.length > 0) {
      setUnknownTypeRows(rows);
      setUploadMsg("");
      return;
    }

    finalizeParsedRows(rows);
  }

  function finalizeParsedRows(rows) {
    const dups = rows.filter(r => logs.some(l => isDuplicate(l, r)));
    if (dups.length > 0) {
      setDuplicateWarning({ existing: null, incoming: rows, dupIds: dups.map(d => d.id), source: "csv" });
    } else {
      setParsedRows(rows);
      setUploadMsg(t("activities.parsed", { n: rows.length }));
    }
  }

  function applyUnknownMappings() {
    // user picked a type for each unknown row; strip the staging-only flags and continue
    const cleaned = unknownTypeRows.map(r => {
      const rest = { ...r };
      delete rest._unknown;
      delete rest._originalType;
      // recompute subTypes if the user remapped a row into Running
      if (rest.type === "Road Run" && (!rest.subTypes || rest.subTypes.length === 0)) {
        rest.subTypes = [recommendRunType(rest.hr, false, hrZones)];
      }
      return rest;
    });
    setUnknownTypeRows(null);
    finalizeParsedRows(cleaned);
  }

  function updateUnknownTypeRow(id, newType) {
    setUnknownTypeRows(unknownTypeRows.map(r => r.id === id ? { ...r, type: newType, _unknown: false } : r));
  }

  async function confirmDuplicates(skipDups) {
    // CSV is the only import source now. (FIT support was removed; the
    // single-row "fit" branch with its own bulk-add path went with it.)
    let rows = duplicateWarning.incoming;
    if (skipDups) rows = rows.filter(r => !duplicateWarning.dupIds.includes(r.id));
    setParsedRows(rows);
    setUploadMsg(t("activities.ready", { n: rows.length }));
    setDuplicateWarning(null);
  }

  async function importParsed() {
    // Strip every staging-only key (anything prefixed with `_`) plus the
    // client-side numeric id — Supabase generates a uuid for each new row.
    const toAdd = parsedRows.filter(r => r._selected).map(r => {
      const out = {};
      for (const k of Object.keys(r)) {
        if (k === "id" || k.startsWith("_")) continue;
        out[k] = r[k];
      }
      return out;
    });
    try {
      await bulkAddLogs(toAdd);
      setParsedRows(null);
      setUploadMsg(t("activities.import_done", { n: toAdd.length }));
      setTimeout(() => setUploadMsg(""), 4000);
    } catch {
      // alert shown by wrapper; leave the review panel open so user can retry / cancel
    }
  }

  const actionBtnStyle = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: isMobile ? "6px 9px" : "6px 12px",
    fontSize: 12,
    flexShrink: 0,
    minHeight: isMobile ? 36 : undefined,
  };

  return (
    <div>
      {/* Compact single-row action bar — short labels so all four (Add /
          Upload / Select / Sort) fit on a 360-wide phone without wrapping. */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14, alignItems: "center" }}>
        <button onClick={() => { setShowAdd(!showAdd); setEditingId(null); }}
          style={{ ...s.btn, ...actionBtnStyle }}>
          <PlusIcon size={13} />
          <span>{t("activities.add_short")}</span>
        </button>
        <button onClick={() => fileRef.current.click()}
          style={{ ...s.btnGhost, ...actionBtnStyle }}>
          <UploadIcon size={13} />
          <span>{t("activities.upload_short")}</span>
        </button>
        <input ref={fileRef} type="file" accept=".csv" style={{ display: "none" }} onChange={handleFileSelect} />
        <button onClick={toggleSelectMode}
          style={{ ...(selectMode ? s.btn : s.btnGhost), ...actionBtnStyle }}>
          <CheckSquareIcon size={13} />
          <span>{selectMode ? selectedIds.size : t("activities.select_short")}</span>
        </button>
        <label style={{
          marginLeft: "auto",
          display: "inline-flex",
          alignItems: "center",
          // Mobile drops SortIcon and uses our own chevron outside the
          // select. Native select chevrons reserve different widths across
          // browsers and can overflow this compact control.
          gap: isMobile ? 4 : 6,
          border: "1px solid var(--rule)",
          borderRadius: 2,
          padding: isMobile ? "0 8px 0 8px" : "0 10px",
          minHeight: isMobile ? 36 : 32,
          background: "var(--bg-elevated)",
          color: "var(--ink-2)",
          flexShrink: 0,
          minWidth: 0,
          overflow: "hidden",
        }}>
          {!isMobile && <SortIcon size={13} />}
          <Dropdown
            variant="inline"
            fontSize={12}
            ariaLabel="Sort activities"
            options={SORT_OPTIONS.map(o => ({ value: o.id, label: t(`activities.sort.${o.id}`) }))}
            value={sortBy}
            onChange={setSortBy}
          />
        </label>
      </div>

      {selectMode && (
        // Select All / Clear / Delete share one row. The "N selected" label
        // was dropped — the Select button itself shows ✓N, already conveys
        // the count.
        <div style={{ ...s.cardDark, marginBottom: 12, display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={selectAll}
            style={{ ...s.btnGhost, fontSize: 12, padding: "5px 10px" }}>
            {t("activities.select_all")}
          </button>
          <button onClick={clearSelection}
            style={{ ...s.btnGhost, fontSize: 12, padding: "5px 10px" }}>
            {t("activities.clear_sel")}
          </button>
          <div style={{ flex: 1 }} />
          <button onClick={bulkDeleteSelected} disabled={selectedIds.size === 0}
            style={{ ...s.btn, fontSize: 12, padding: "5px 12px", background: "#c0392b", borderColor: "#c0392b", opacity: selectedIds.size === 0 ? 0.5 : 1 }}>
            {t("activities.delete_sel")}
          </button>
        </div>
      )}

      {uploadMsg && (
        <div style={{ fontSize: 12, color: "#555", background: "#f0f0f0", borderRadius: 6, padding: "8px 12px", marginBottom: 14, lineHeight: 1.6 }}>{uploadMsg}</div>
      )}

      {duplicateWarning && (
        <div style={{ ...s.cardDark, marginBottom: 14, border: "1px solid #d4a017", background: "#fffbea" }}>
          <div style={{ ...s.section, color: "#7a5a00" }}>{t("activities.duplicate_title")}</div>
          <div style={{ fontSize: 13, color: "#555", marginBottom: 10 }}>
            {t("activities.duplicate_csv", { dups: duplicateWarning.dupIds.length, total: duplicateWarning.incoming.length })}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => confirmDuplicates(true)} style={s.btn}>{t("activities.skip_dups")}</button>
            <button onClick={() => confirmDuplicates(false)} style={s.btnGhost}>{t("activities.add_anyway")}</button>
            <button onClick={() => setDuplicateWarning(null)} style={s.btnGhost}>{t("common.cancel")}</button>
          </div>
        </div>
      )}

      {unknownTypeRows && (
        <div style={{ ...s.cardDark, marginBottom: 14, border: "1px solid #d4a017", background: "#fffbea" }}>
          <div style={{ ...s.section, color: "#7a5a00" }}>{t("activities.unknown_type_title")}</div>
          <div style={{ fontSize: 13, color: "#555", marginBottom: 10 }}>
            {t("activities.unknown_type_body", { n: unknownTypeRows.filter(r => r._unknown).length })}
          </div>
          <div style={{ maxHeight: 320, overflowY: "auto", marginBottom: 10 }}>
            {unknownTypeRows.filter(r => r._unknown).map(r => (
              <div key={r.id} style={{ background: "#fff", borderRadius: 6, padding: "8px 10px", marginBottom: 6, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{ fontSize: 11, color: "#888", minWidth: 60 }}>{formatDateShort(r.date)}</div>
                <div style={{ fontSize: 12, flex: 1, minWidth: 160 }}>
                  <span style={{ color: "#999" }}>{t("activities.unknown_type_original")}</span>
                  <span style={{ fontFamily: "var(--font-mono)", color: "#333" }}>{r._originalType}</span>
                </div>
                <div style={{ width: 150 }}>
                  <Dropdown
                    ariaLabel={t("form.type")}
                    options={ACTIVITY_TYPES.map(at => ({ value: at, label: t(`enum.activity.${at}`) }))}
                    value={r.type}
                    onChange={(v) => updateUnknownTypeRow(r.id, v)}
                  />
                </div>
                <button onClick={() => updateUnknownTypeRow(r.id, r.type)}
                  style={{ ...s.btnGhost, fontSize: 11, padding: "4px 10px" }}>
                  ✓
                </button>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={applyUnknownMappings}
              disabled={unknownTypeRows.some(r => r._unknown)}
              style={{ ...s.btn, opacity: unknownTypeRows.some(r => r._unknown) ? 0.5 : 1 }}>
              {t("activities.unknown_type_apply")}
            </button>
            <button onClick={() => { setUnknownTypeRows(null); setUploadMsg(""); }} style={s.btnGhost}>{t("common.cancel")}</button>
          </div>
        </div>
      )}

      {parsedRows && (
        <div style={{ ...s.cardDark, marginBottom: 14 }}>
          <div style={{ ...s.section, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>{t("activities.review", { sel: parsedRows.filter(r => r._selected).length, total: parsedRows.length })}</span>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => setParsedRows(null)} style={{ ...s.btnGhost, fontSize: 12, padding: "5px 10px" }}>{t("common.cancel")}</button>
              <button onClick={importParsed} style={{ ...s.btn, fontSize: 12, padding: "5px 12px" }}>{t("activities.import")}</button>
            </div>
          </div>
          <div style={{ maxHeight: 320, overflowY: "auto" }}>
            {parsedRows.map(r => (
              <div key={r.id} style={{ background: "#fff", borderRadius: 6, padding: "8px 10px", marginBottom: 6, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <input type="checkbox" checked={r._selected} onChange={() => setParsedRows(parsedRows.map(x => x.id === r.id ? { ...x, _selected: !x._selected } : x))} style={{ width: 16, height: 16 }} />
                <div style={{ minWidth: 60, fontSize: 11, color: "#888" }}>{formatDateShort(r.date)}</div>
                <div style={s.tag(r.type)}>{t(`enum.activity.${r.type}`)}</div>
                <div style={{ fontSize: 12, flex: 1 }}>
                  {r.distance > 0 && <span>{r.distance}km · </span>}
                  {formatDuration(r.duration)} {r.hr > 0 && `· HR ${r.hr}`} {r.ascent > 0 && `· +${r.ascent}m`} {r.aerobicTE > 0 && `· TE ${r.aerobicTE}`}
                </div>
                {r.type === "Road Run" && (
                  <div style={{ width: 130 }}>
                    <Dropdown
                      ariaLabel={t("form.run_type")}
                      options={RUN_SUBTYPES.map(st => ({ value: st, label: t(`enum.subtype.${st}`) }))}
                      value={r.subTypes[0] || ""}
                      onChange={(v) => setParsedRows(parsedRows.map(x => x.id === r.id ? { ...x, subTypes: [v] } : x))}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {showAdd && (
        <ActivityForm
          mode="add"
          initial={null}
          onSave={handleAddSubmit}
          onCancel={() => setShowAdd(false)}
          hrZones={hrZones}
        />
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {displayedLogs.length === 0 && (
          <div style={{ ...s.cardDark, textAlign: "center", color: "#888", padding: "30px 16px", fontSize: 13 }}>
            {t("activities.empty")}
          </div>
        )}
        {displayedLogs.map(l => {
          const isSelected = selectedIds.has(l.id);

          // Mobile compact card — fixed-height two-row layout. Tap expands to
          // reveal all metrics + an Edit button. Tap again to collapse.
          if (isMobile) {
            const isExpanded = expandedId === l.id;
            const onMobileCardClick = () => {
              if (selectMode) toggleSelected(l.id);
              else setExpandedId(isExpanded ? null : l.id);
            };
            // NB: explicit per-side borders. The `border` shorthand combined
            // with a separate `borderLeft` longhand was inconsistently re-
            // applied on certain state transitions (exiting select mode
            // without changes) — the colored stripe would vanish until the
            // next full re-render. Setting each side independently sidesteps
            // the shorthand/longhand interaction entirely.
            return (
              <div key={l.id}
                onClick={() => { if (longPressFired.current) { longPressFired.current = false; return; } onMobileCardClick(); }}
                onTouchStart={() => startPress(l)} onTouchEnd={endPress} onTouchMove={endPress} onTouchCancel={endPress}
                onMouseDown={() => startPress(l)} onMouseUp={endPress} onMouseLeave={endPress}
                style={{
                  background: isSelected ? "#eef5ff" : "var(--bg-elevated)",
                  borderTop:    "1px solid " + (isSelected ? "#7aa8e0" : "var(--rule)"),
                  borderRight:  "1px solid " + (isSelected ? "#7aa8e0" : "var(--rule)"),
                  borderBottom: "1px solid " + (isSelected ? "#7aa8e0" : "var(--rule)"),
                  borderLeft:   "4px solid " + (TYPE_COLOR[l.type] || "var(--rule)"),
                  padding: "9px 12px 10px",
                  display: "flex", flexDirection: "column", gap: 5,
                  cursor: "pointer",
                }}>
                {/* Row 1: date + weekday + type tag + sub-types + delete */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  {selectMode && (
                    <input type="checkbox" checked={isSelected} readOnly
                      style={{ width: 16, height: 16, pointerEvents: "none", flexShrink: 0 }} />
                  )}
                  <span style={{
                    fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-3)",
                    fontVariantNumeric: "tabular-nums", flexShrink: 0,
                  }}>{formatDateShort(l.date)}</span>
                  <span style={{
                    fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-3)", flexShrink: 0,
                  }}>{formatWeekdayShort(l.date, lang)}</span>
                  <span style={{ ...s.tag(l.type), fontSize: 10, padding: "2px 7px", flexShrink: 0 }}>
                    {t(`enum.activity.${l.type}`)}
                  </span>
                  {/* Race flag — pulled out of the inline subtype text into its
                      own trophy chip with a background so it actually reads as
                      "this was a race" (the faint "▲ RACE" text didn't). */}
                  {l.subTypes.includes("Race") && (
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 3, flexShrink: 0,
                      fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600,
                      color: "var(--ink-2)", letterSpacing: "0.04em",
                    }}>🏆 {t("enum.subtype.Race")}</span>
                  )}
                  {/* Sub-types — inline joined text, no chips. Allows ellipsis
                      if too long (e.g. "Lower Body · Core · Upper Body"). Race
                      is excluded here — it's the trophy chip above. */}
                  {l.subTypes.length > 0 && (() => {
                    const visible = l.subTypes.filter(st => {
                      if (RUN_FLAGS.includes(st)) return false;
                      if (RUN_PACE_TYPES.includes(st)) return l.type === "Road Run";
                      return l.type === "Strength";
                    });
                    if (visible.length === 0) return null;
                    return (
                      <span style={{
                        fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-2)",
                        textTransform: "uppercase", letterSpacing: "0.04em",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        minWidth: 0, flex: "0 1 auto",
                      }}>
                        {visible.map(st => {
                          // Mobile drops the "Run" suffix on pace types ("Easy Run" → "Easy") and
                          // the "Body" suffix on strength subtypes ("Lower Body" → "Lower") so the
                          // compact row doesn't ellipsis away a later tag (e.g. Core). Flags
                          // ("Race") stay verbatim. The strip is a no-op for the Chinese labels.
                          const label = (RUN_PACE_TYPES.includes(st) ? t(`enum.subtype.${st}_short`) : t(`enum.subtype.${st}`)).replace(/ Body$/, "");
                          return (RUN_FLAGS.includes(st) ? "▲ " : "") + label;
                        }).join(" · ")}
                      </span>
                    );
                  })()}
                  <div style={{ flex: 1 }} />
                  {/* Weather chip — outdoor types only; apparent ("feels like")
                      temp headline (that's what drives pace + HR in heat). Full
                      breakdown (raw temp + humidity + wind + AQI) is on its own
                      line in the expanded view below. Sits before RPE so RPE is
                      the last item on the header row. */}
                  {showWeather(l) && (
                    <span style={{
                      fontFamily: "var(--font-mono)", fontSize: 11,
                      color: "var(--ink-2)", flexShrink: 0,
                    }}>
                      <MetricWeather w={l.weather} />
                    </span>
                  )}
                  {/* RPE — last item on the header row. Delete moved to the
                      long-press action modal (no inline ✕ anymore). */}
                  {l.rpe > 0 && (
                    <span style={{
                      fontFamily: "var(--font-mono)", fontSize: 11,
                      color: "var(--ink-3)", flexShrink: 0,
                    }}>RPE{l.rpe}</span>
                  )}
                </div>

                {/* Row 2: type-specific compact metrics */}
                <div style={{
                  display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap",
                  fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums",
                  fontSize: 13, color: "var(--ink-1)",
                }}>
                  <CompactMetrics log={l} t={t} />
                </div>

                {/* Expanded: extra metrics. Edit/Delete now live in the
                    long-press action modal, so no inline Edit button here. */}
                {isExpanded && (
                  <div style={{
                    borderTop: "1px solid var(--rule-soft)", paddingTop: 8, marginTop: 2,
                    display: "flex", flexDirection: "column", gap: 8,
                  }}>
                    <ExpandedMetrics log={l} t={t} />
                  </div>
                )}
              </div>
            );
          }

          const onCardClick = () => {
            if (selectMode) {
              toggleSelected(l.id);
            } else {
              startEdit(l);
            }
          };
          return (
            <div key={l.id}
              onClick={onCardClick}
              style={{
                ...s.card,
                display: "flex",
                flexDirection: isNarrow ? "column" : "row",
                alignItems: isNarrow ? "stretch" : "center",
                gap: isNarrow ? 8 : 12,
                cursor: "pointer",
                ...(isSelected ? { background: "#eef5ff", borderColor: "#7aa8e0" } : {}),
              }}>
              {/* Top row (narrow: header line; desktop: left identifier block).
                  Contains: checkbox? · date · type tag · subtype chips · delete-button-on-narrow.
                  On desktop this is the 300px-fixed left column; on narrow it
                  spans full width with the delete button pushed to the right. */}
              <div style={isNarrow ? {
                display: "flex", alignItems: "center", gap: 10,
                flexWrap: "wrap",
              } : {
                width: 300, minWidth: 300, flexShrink: 0,
                display: "flex", alignItems: "center", gap: 10,
                overflow: "hidden",
              }}>
                {selectMode && (
                  <input type="checkbox" checked={isSelected} readOnly
                    style={{ width: 16, height: 16, pointerEvents: "none", flexShrink: 0 }} />
                )}
                <div style={{ minWidth: 50, fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--ink-3)", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{formatDateShort(l.date)}</div>
                <div style={{ ...s.tag(l.type), flexShrink: 0 }}>{t(`enum.activity.${l.type}`)}</div>
                {l.isOptimistic && (
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-3)", flexShrink: 0 }}>
                    {t("activities.saving")}
                  </span>
                )}
                <div style={{ flex: 1, minWidth: 0, display: "flex", gap: 6, flexWrap: isNarrow ? "wrap" : "nowrap", overflow: "hidden" }}>
                  {l.subTypes.filter(st => {
                    if (RUN_FLAGS.includes(st)) return true;
                    if (RUN_PACE_TYPES.includes(st)) return l.type === "Road Run";
                    return l.type === "Strength";
                  }).map(st => {
                    const isFlag = RUN_FLAGS.includes(st);
                    // Race flag → trophy + label, NO background fill (the moss
                    // green clashed with Trail Run's green; the 🏆 is enough).
                    return (
                      <div key={st} style={isFlag
                        ? { ...s.subTag, display: "inline-flex", alignItems: "center", gap: 3, border: "none", padding: "2px 4px", color: "var(--ink-2)" }
                        : s.subTag}>
                        {isFlag ? "🏆 " : ""}{t(`enum.subtype.${st}`)}
                      </div>
                    );
                  })}
                </div>
                {/* Weather chip — apparent temp + icon, outdoor types only.
                    Sits before RPE so RPE is the last item; mirrors mobile. */}
                {showWeather(l) && (
                  <span style={{
                    fontFamily: "var(--font-mono)", fontSize: 12,
                    color: "var(--ink-2)", flexShrink: 0,
                  }}>
                    <MetricWeather w={l.weather} />
                  </span>
                )}
                {/* RPE — last item in the identifier block, mirrors mobile. */}
                {l.rpe > 0 && (
                  <span style={{
                    fontFamily: "var(--font-mono)", fontSize: 12,
                    color: "var(--ink-3)", flexShrink: 0,
                  }}>RPE{l.rpe}</span>
                )}
                {/* Delete button on narrow lives at the right end of the header line;
                    desktop puts it at the very end of the row (later in this JSX). */}
                {isNarrow && !selectMode && (
                  <button onClick={(e) => { e.stopPropagation(); deleteLog(l.id); }}
                    style={{ border: "none", background: "none", color: "var(--ink-3)", cursor: "pointer", fontSize: 14, padding: "0 4px", marginLeft: "auto", flexShrink: 0 }}
                    title={t("activities.delete_tooltip")}>✕</button>
                )}
              </div>
              {/* Metrics container — on desktop, an 8-column fixed grid so
                  values align vertically across rows. On narrow, a wrapping
                  flex row that flows naturally on phone widths. Column order
                  is duration-first (then HR, then distance/ascent/pace/...)
                  so the most universally-present metric anchors column 1
                  across every activity type. */}
              <div style={isNarrow ? {
                display: "flex", flexWrap: "wrap",
                gap: "6px 14px",
                alignItems: "center",
                fontFamily: "var(--font-mono)",
                fontVariantNumeric: "tabular-nums",
              } : {
                display: "grid",
                gridTemplateColumns: "110px 80px 90px 80px 80px 80px 55px 75px",
                gap: 8,
                alignItems: "center",
                fontFamily: "var(--font-mono)",
                fontVariantNumeric: "tabular-nums",
                flexShrink: 0,
              }}>
                {/* 1. Duration */}
                <div>
                  {l.duration > 0 && (
                    <span style={{ fontSize: 13, color: "var(--ink-2)", display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <span style={{ color: "var(--ink-3)" }}><ClockIcon size={13} /></span>
                      {formatDuration(l.duration)}
                    </span>
                  )}
                </div>
                {/* 2. HR */}
                <div>
                  {l.hr > 0 && (
                    <span style={{ fontSize: 13, color: "var(--ink-2)", display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <span style={{ color: "var(--danger)" }}><HeartIcon size={12} /></span>
                      {l.hr}{l.maxHR > 0 ? <span style={{ color: "var(--ink-3)" }}>/{l.maxHR}</span> : null}
                    </span>
                  )}
                </div>
                {/* 3. Distance */}
                <div>
                  {l.distance > 0 && (
                    <span style={{ fontWeight: 500, fontSize: 14, color: "var(--ink-1)", display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <span style={{ color: "var(--ink-3)" }}><RouteIcon size={13} /></span>
                      {l.distance}<span style={{ color: "var(--ink-3)", marginLeft: 1, fontSize: 10 }}>km</span>
                    </span>
                  )}
                </div>
                {/* 4. Ascent */}
                <div>
                  {l.ascent > 0 && (
                    <span style={{ fontSize: 13, color: "var(--moss-deep)", display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <span style={{ color: "var(--moss)" }}><PeakIcon size={13} /></span>
                      +{l.ascent}<span style={{ color: "var(--ink-3)", fontSize: 10, marginLeft: 1 }}>m</span>
                    </span>
                  )}
                </div>
                {/* 5. Pace */}
                <div>
                  {l.pace > 0 && (
                    <span style={{ fontSize: 13, color: "var(--ink-2)", display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <span style={{ color: "var(--ink-3)" }}><RunnerIcon size={13} /></span>
                      {formatPaceFromSec(l.pace)}<span style={{ color: "var(--ink-3)", fontSize: 10, marginLeft: 1 }}>/km</span>
                    </span>
                  )}
                </div>
                {/* 6. GAP — grade-adjusted pace, sits right after the regular pace */}
                <div>
                  {l.gap > 0 && (
                    <span style={{ fontSize: 13, color: "var(--ink-2)", display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <span style={{ color: "var(--ink-3)" }}><GaugeIcon size={13} /></span>
                      {formatPaceFromSec(l.gap)}
                    </span>
                  )}
                </div>
                {/* 7. TE */}
                <div>
                  {l.aerobicTE > 0 && (
                    <span style={{ fontSize: 13, color: "var(--ink-2)", display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <span style={{ color: "var(--warn)" }}><BoltIcon size={12} /></span>
                      {l.aerobicTE}
                    </span>
                  )}
                </div>
                {/* 8. Cadence (SPM) — Road Run only */}
                <div>
                  {l.cadence > 0 && l.type === "Road Run" && (
                    <span style={{ fontSize: 13, color: "var(--ink-2)", display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <span style={{ color: "var(--ink-3)" }}><FootIcon size={13} /></span>
                      {l.cadence}<span style={{ color: "var(--ink-3)", fontSize: 10, marginLeft: 1 }}>spm</span>
                    </span>
                  )}
                </div>
              </div>
              {/* Spacer pushes the delete button to the far right edge. The
                  delete is duplicated in the header row on narrow widths,
                  so render this one only on desktop to avoid the two-✕ bug. */}
              <div style={{ flex: 1 }} />
              {!selectMode && !isNarrow && (
                <button onClick={(e) => { e.stopPropagation(); deleteLog(l.id); }}
                  style={{ border: "none", background: "none", color: "var(--ink-3)", cursor: "pointer", fontSize: 14, padding: "0 4px", flexShrink: 0 }}
                  title={t("activities.delete_tooltip")}>✕</button>
              )}
            </div>
          );
        })}
      </div>

      {/* Long-press actions — Edit / Delete (replaces the inline ✕ on cards). */}
      {actionTarget && (
        <ItemActionModal
          title={`${formatDateShort(actionTarget.date)} · ${t(`enum.activity.${actionTarget.type}`)}`}
          onEdit={() => { const tgt = actionTarget; setActionTarget(null); startEdit(tgt); }}
          onDelete={() => { const id = actionTarget.id; setActionTarget(null); deleteLog(id); }}
          onClose={() => setActionTarget(null)}
        />
      )}

      {/* Edit form — opens as a blurred modal (was an inline card swap). */}
      {editingId && (() => {
        const editLog = displayedLogs.find(l => l.id === editingId);
        if (!editLog) return null;
        return (
          <ModalRoot onClose={() => setEditingId(null)}>
            <div onClick={() => setEditingId(null)} style={{
              position: "fixed", inset: 0, background: "rgba(20,20,19,0.45)",
              backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
              display: "flex", alignItems: "flex-start", justifyContent: "center",
              zIndex: 9999, padding: 16, overflowY: "auto", overscrollBehavior: "contain",
            }}>
              <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 640, margin: "16px 0" }}>
                <ActivityForm
                  mode="edit"
                  initial={editLog}
                  onSave={(data) => handleEditSubmit(editLog.id, data)}
                  onCancel={() => setEditingId(null)}
                  hrZones={hrZones}
                />
              </div>
            </div>
          </ModalRoot>
        );
      })()}
    </div>
  );
}

// ─── Mobile metric helpers ────────────────────────────────────────────────
// Per-activity-type compact summary shown in row 2 of every card; the
// remaining numbers are deferred to ExpandedMetrics below (tap to reveal).
// Order is intentionally duration-first across all types so the first
// metric column visually aligns down the list.
//   Road Run         → duration · distance · pace
//   Trail / Hiking   → duration · distance · ascent
//   Floor Climbing   → duration · ascent
//   Strength / HIIT  → duration · HR
// ──────────────────────────────────────────────────────────────────────────

function MetricDistance({ km }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{ color: "var(--ink-3)" }}><RouteIcon size={12} /></span>
      {km}<span style={{ color: "var(--ink-3)", fontSize: 10, marginLeft: 1 }}>km</span>
    </span>
  );
}
function MetricDuration({ sec }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{ color: "var(--ink-3)" }}><ClockIcon size={12} /></span>
      {formatDuration(sec)}
    </span>
  );
}
function MetricPace({ p }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{ color: "var(--ink-3)" }}><RunnerIcon size={12} /></span>
      {formatPaceFromSec(p)}<span style={{ color: "var(--ink-3)", fontSize: 10, marginLeft: 1 }}>/km</span>
    </span>
  );
}
function MetricAscent({ m }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--moss-deep)" }}>
      <span style={{ color: "var(--moss)" }}><PeakIcon size={12} /></span>
      +{m}<span style={{ color: "var(--ink-3)", fontSize: 10, marginLeft: 1 }}>m</span>
    </span>
  );
}
function MetricHR({ hr, maxHR }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{ color: "var(--danger)" }}><HeartIcon size={11} /></span>
      {hr}{maxHR > 0 ? <span style={{ color: "var(--ink-3)" }}>/{maxHR}</span> : null}
    </span>
  );
}
function MetricGAP({ p }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{ color: "var(--ink-3)" }}><GaugeIcon size={12} /></span>
      {formatPaceFromSec(p)}
    </span>
  );
}
function MetricTE({ te }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{ color: "var(--warn)" }}><BoltIcon size={11} /></span>
      {te}
    </span>
  );
}
function MetricCadence({ spm }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{ color: "var(--ink-3)" }}><FootIcon size={12} /></span>
      {spm}<span style={{ color: "var(--ink-3)", fontSize: 10, marginLeft: 1 }}>spm</span>
    </span>
  );
}
// Weather chip — two variants:
//   • compact (default) → icon + APPARENT TEMP. "Feels like" is what
//     drives pace + HR in heat, so it's the headline on row 1. Falls
//     back to raw temp when apparent missing.
//   • full → icon + RAW AIR TEMP + humidity + wind + AQI. Apparent is
//     already on row 1, so expanded skips it entirely and surfaces the
//     air temperature — the "实测 32°C, RH75%, wind 4km/h, AQI 50"
//     breakdown a runner uses to decide hydration and hard-effort risk.
// log.weather is absent on indoor types by design (Strength, Floor
// Climbing) and on rows recorded before weather support landed.
function MetricWeather({ w, full = false }) {
  if (!w) return null;
  // Realtime + historical: tempC / apparentC. Daily forecast: tempAvgC / apparentAvgC.
  const temp = w.tempC ?? w.tempAvgC;
  const apparent = w.apparentC ?? w.apparentAvgC;
  // Compact: apparent (fall back to raw). Expanded: raw (fall back to apparent).
  const headline = full
    ? (Number.isFinite(temp) ? temp : apparent)
    : (Number.isFinite(apparent) ? apparent : temp);
  const meta = w.skycon ? skyconShort(w.skycon) : null;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      color: "var(--ink-2)",
    }}>
      {meta && <span aria-hidden="true">{meta.icon}</span>}
      {Number.isFinite(headline) && (
        <span>{Math.round(headline)}<span style={{ color: "var(--ink-3)", fontSize: 10, marginLeft: 1 }}>°C</span></span>
      )}
      {full && Number.isFinite(w.humidity) && (
        <span style={{ color: "var(--ink-3)", fontSize: 11 }}>
          · RH{w.humidity > 1 ? Math.round(w.humidity) : Math.round(w.humidity * 100)}%
        </span>
      )}
      {full && Number.isFinite(w.windSpeed) && w.windSpeed >= 1 && (
        <span style={{ color: "var(--ink-3)", fontSize: 11 }}>
          · {w.windSpeed}km/h
        </span>
      )}
      {full && Number.isFinite(w.aqi) && w.aqi > 0 && (
        <span style={{ color: "var(--ink-3)", fontSize: 11 }}>
          · AQI{w.aqi}
        </span>
      )}
    </span>
  );
}
// Outdoor-only filter — weather is irrelevant for indoor gym sessions
// (Strength) and stair-machine workouts (Floor Climbing). The capture
// still happens silently (no harm in storing the data), we just don't
// show it for these types.
function showWeather(log) {
  return !!log.weather && WEATHER_RELEVANT_TYPES.includes(log.type);
}
// Tiny inline lookup avoiding a circular import — duplicates the SKYCON_MAP
// names/icons from src/lib/weather.js. Keep this small list in sync if you
// add new entries there; adding a Caiyun skycon enum on this side is cheap
// (just an icon + label) but missing one only loses the icon — the temp
// numbers still render.
const _SKYCON_ICON = {
  CLEAR_DAY: '☀️', CLEAR_NIGHT: '🌙',
  PARTLY_CLOUDY_DAY: '⛅', PARTLY_CLOUDY_NIGHT: '☁️',
  CLOUDY: '☁️',
  LIGHT_HAZE: '🌫️', MODERATE_HAZE: '🌫️', HEAVY_HAZE: '🌫️',
  LIGHT_RAIN: '🌦️', MODERATE_RAIN: '🌧️', HEAVY_RAIN: '🌧️', STORM_RAIN: '⛈️',
  FOG: '🌫️',
  LIGHT_SNOW: '🌨️', MODERATE_SNOW: '🌨️', HEAVY_SNOW: '❄️', STORM_SNOW: '❄️',
  DUST: '🌪️', SAND: '🌪️', WIND: '💨',
};
function skyconShort(name) {
  return { icon: _SKYCON_ICON[name] || '☁️' };
}

// Compact metric strip — duration + the 1-2 most useful per-type numbers.
// Weather chip is rendered separately at the END of row 1 (header line)
// for outdoor-relevant types, so it doesn't appear here.
function CompactMetrics({ log: l }) {
  if (l.type === "Road Run") {
    return (
      <>
        {l.duration > 0 && <MetricDuration sec={l.duration} />}
        {l.distance > 0 && <MetricDistance km={l.distance} />}
        {l.pace > 0 && <MetricPace p={l.pace} />}
      </>
    );
  }
  if (l.type === "Trail Run" || l.type === "Hiking") {
    return (
      <>
        {l.duration > 0 && <MetricDuration sec={l.duration} />}
        {l.distance > 0 && <MetricDistance km={l.distance} />}
        {l.ascent > 0 && <MetricAscent m={l.ascent} />}
      </>
    );
  }
  if (l.type === "Floor Climbing") {
    // Stair/floor climbing has no meaningful distance to a user — surface
    // duration + ascent only; distance (if recorded) drops into Expanded.
    return (
      <>
        {l.duration > 0 && <MetricDuration sec={l.duration} />}
        {l.ascent > 0 && <MetricAscent m={l.ascent} />}
      </>
    );
  }
  // Strength + HIIT
  return (
    <>
      {l.duration > 0 && <MetricDuration sec={l.duration} />}
      {l.hr > 0 && <MetricHR hr={l.hr} maxHR={l.maxHR} />}
    </>
  );
}

function ExpandedMetrics({ log: l }) {
  // Everything that's NOT already in the CompactMetrics summary, rendered
  // as a wrap-flex below the divider. Items with no value (0/missing) skip.
  const isRoad = l.type === "Road Run";
  const isTrailOrHike = l.type === "Trail Run" || l.type === "Hiking";
  const isFloor = l.type === "Floor Climbing";
  const isStrengthLike = l.type === "Strength" || l.type === "HIIT";

  return (
    <>
      {/* Metric data on its own row (weather goes on the line below). Road Run
          has the most metrics, so ONLY there do we tighten the gap + spread
          with space-between to fit them on one line on narrow phones. Other
          types (Trail / Hiking / etc.) have few metrics, so they keep the
          normal left-packed gap — space-between would leave 3 items awkwardly
          spaced edge-to-edge. */}
      <div style={{
        display: "flex", flexWrap: "wrap",
        gap: isRoad ? "6px 10px" : 14,
        justifyContent: isRoad ? "space-between" : "flex-start",
        fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums",
        fontSize: 12, color: "var(--ink-2)",
      }}>
        {/* Road Run extras */}
        {isRoad && l.ascent > 0 && <MetricAscent m={l.ascent} />}
        {isRoad && l.gap > 0 && <MetricGAP p={l.gap} />}
        {isRoad && l.hr > 0 && <MetricHR hr={l.hr} maxHR={l.maxHR} />}
        {isRoad && l.cadence > 0 && <MetricCadence spm={l.cadence} />}
        {/* Trail / Hiking extras */}
        {isTrailOrHike && l.pace > 0 && <MetricPace p={l.pace} />}
        {isTrailOrHike && l.hr > 0 && <MetricHR hr={l.hr} maxHR={l.maxHR} />}
        {isTrailOrHike && l.cadence > 0 && <MetricCadence spm={l.cadence} />}
        {/* Floor Climbing extras — distance moves here since it's not in compact */}
        {isFloor && l.distance > 0 && <MetricDistance km={l.distance} />}
        {isFloor && l.pace > 0 && <MetricPace p={l.pace} />}
        {isFloor && l.hr > 0 && <MetricHR hr={l.hr} maxHR={l.maxHR} />}
        {/* Strength / HIIT extras */}
        {isStrengthLike && l.distance > 0 && <MetricDistance km={l.distance} />}
        {/* Universal: TE if present */}
        {l.aerobicTE > 0 && <MetricTE te={l.aerobicTE} />}
      </div>
      {/* Full weather chip on its OWN line — raw air temp + humidity / wind /
          AQI. The compact chip in the header shows only the apparent ("feels
          like") temp; this fills in the rest. Outdoor types only. */}
      {showWeather(l) && (
        <div style={{
          display: "flex", fontFamily: "var(--font-mono)",
          fontVariantNumeric: "tabular-nums", fontSize: 12, color: "var(--ink-2)",
        }}>
          <MetricWeather w={l.weather} full />
        </div>
      )}
    </>
  );
}
