import { useState, useRef, useMemo } from "react";
import { s } from "../styles";
import { RUN_SUBTYPES, RUN_FLAGS, RUN_PACE_TYPES, SORT_OPTIONS, ACTIVITY_TYPES, TYPE_COLOR } from "../constants";
import { useT, useLanguage } from "../i18n/LanguageContext";
import { useIsNarrow, useIsMobile } from "../hooks/useMediaQuery";
import {
  autoClassifyRun, parseTimeToSeconds,
  formatDuration, formatPaceFromSec, formatDateShort, formatWeekdayShort, isDuplicate,
} from "../utils/format";
import { ActivityForm } from "./ActivityForm";
import { ClockIcon, HeartIcon, PeakIcon, FootIcon, BoltIcon, GaugeIcon, RouteIcon, RunnerIcon } from "./Icons";

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

export function ActivitiesTab({ logs, addLog, updateLog, bulkAddLogs, periodLogs, setConfirmDelete }) {
  const t = useT();
  const { lang } = useLanguage();
  // < 1024px: phone OR small tablet. Both can't fit the 8-column metric
  // grid plus the 300px left identifier block — switch to a stacked flex
  // layout where the metric pills wrap naturally.
  const isNarrow = useIsNarrow();
  const isMobile = useIsMobile();
  const [sortBy, setSortBy] = useState("date_desc");
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState(null); // log.id currently being edited inline
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
      const subTypes = mapped.type === "Road Run" ? [autoClassifyRun(hr, false)] : [];

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
        rest.subTypes = [autoClassifyRun(rest.hr, false)];
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

  return (
    <div>
      {/* Compact single-row action bar — short labels so all four (Add /
          Upload / Select / Sort) fit on a 360-wide phone without wrapping. */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14, alignItems: "center" }}>
        <button onClick={() => { setShowAdd(!showAdd); setEditingId(null); }}
          style={{ ...s.btn, padding: "6px 12px", fontSize: 12, flexShrink: 0 }}>
          + {t("activities.add_short")}
        </button>
        <button onClick={() => fileRef.current.click()}
          style={{ ...s.btnGhost, padding: "6px 12px", fontSize: 12, flexShrink: 0 }}>
          {t("activities.upload_short")}
        </button>
        <input ref={fileRef} type="file" accept=".csv" style={{ display: "none" }} onChange={handleFileSelect} />
        <button onClick={toggleSelectMode}
          style={{ ...(selectMode ? s.btn : s.btnGhost), padding: "6px 12px", fontSize: 12, flexShrink: 0 }}>
          {selectMode ? `✓ ${selectedIds.size}` : t("activities.select_short")}
        </button>
        <select value={sortBy} onChange={e => setSortBy(e.target.value)}
          style={{
            marginLeft: "auto",
            border: "1px solid var(--rule)", borderRadius: 2,
            padding: "5px 8px", fontSize: 12,
            background: "var(--bg-elevated)", color: "var(--ink-2)",
            fontFamily: "var(--font-sans)", minWidth: 0,
          }}>
          {SORT_OPTIONS.map(o => (
            <option key={o.id} value={o.id}>
              ⇅ {t(`activities.sort.${o.id}`)}
            </option>
          ))}
        </select>
      </div>

      {selectMode && (
        <div style={{ ...s.cardDark, marginBottom: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={s.muted}>{t("activities.selected", { n: selectedIds.size })}</span>
          <button onClick={selectAll} style={{ ...s.btnGhost, fontSize: 12, padding: "5px 10px" }}>{t("activities.select_all")}</button>
          <button onClick={clearSelection} style={{ ...s.btnGhost, fontSize: 12, padding: "5px 10px" }}>{t("activities.clear_sel")}</button>
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
                <select value={r.type} onChange={e => updateUnknownTypeRow(r.id, e.target.value)}
                  style={{ ...s.input, width: "auto", padding: "4px 8px", fontSize: 12 }}>
                  {ACTIVITY_TYPES.map(at => <option key={at} value={at}>{t(`enum.activity.${at}`)}</option>)}
                </select>
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
                  <select value={r.subTypes[0] || ""} onChange={(e) => setParsedRows(parsedRows.map(x => x.id === r.id ? { ...x, subTypes: [e.target.value] } : x))}
                    style={{ ...s.input, width: "auto", padding: "3px 6px", fontSize: 11 }}>
                    {RUN_SUBTYPES.map(st => <option key={st} value={st}>{t(`enum.subtype.${st}`)}</option>)}
                  </select>
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
        />
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {displayedLogs.length === 0 && (
          <div style={{ ...s.cardDark, textAlign: "center", color: "#888", padding: "30px 16px", fontSize: 13 }}>
            {t("activities.empty")}
          </div>
        )}
        {displayedLogs.map(l => {
          const isEditing = editingId === l.id;
          const isSelected = selectedIds.has(l.id);
          if (isEditing) {
            return (
              <ActivityForm
                key={l.id}
                mode="edit"
                initial={l}
                onSave={(data) => handleEditSubmit(l.id, data)}
                onCancel={() => setEditingId(null)}
              />
            );
          }

          // Mobile compact card — fixed-height two-row layout. Tap expands to
          // reveal all metrics + an Edit button. Tap again to collapse.
          if (isMobile) {
            const isExpanded = expandedId === l.id;
            const onMobileCardClick = () => {
              if (selectMode) toggleSelected(l.id);
              else setExpandedId(isExpanded ? null : l.id);
            };
            return (
              <div key={l.id}
                onClick={onMobileCardClick}
                style={{
                  background: isSelected ? "#eef5ff" : "var(--bg-elevated)",
                  border: "1px solid " + (isSelected ? "#7aa8e0" : "var(--rule)"),
                  borderLeft: "4px solid " + (TYPE_COLOR[l.type] || "var(--rule)"),
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
                  {/* Sub-types — inline joined text, no chips. Allows ellipsis
                      if too long (e.g. "Lower Body · Core · Upper Body"). */}
                  {l.subTypes.length > 0 && (() => {
                    const visible = l.subTypes.filter(st => {
                      if (RUN_FLAGS.includes(st)) return true;
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
                        {visible.map(st => (RUN_FLAGS.includes(st) ? "▲ " : "") + t(`enum.subtype.${st}`)).join(" · ")}
                      </span>
                    );
                  })()}
                  <div style={{ flex: 1 }} />
                  {!selectMode && (
                    <button onClick={(e) => { e.stopPropagation(); deleteLog(l.id); }}
                      aria-label="Delete"
                      style={{
                        border: "none", background: "none", color: "var(--ink-3)",
                        cursor: "pointer", fontSize: 13, padding: "0 4px",
                        minHeight: 28, flexShrink: 0,
                      }}>✕</button>
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

                {/* Expanded: extra metrics + Edit button */}
                {isExpanded && (
                  <div style={{
                    borderTop: "1px solid var(--rule-soft)", paddingTop: 8, marginTop: 2,
                    display: "flex", flexDirection: "column", gap: 8,
                  }}>
                    <ExpandedMetrics log={l} t={t} />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedId(null);
                        setEditingId(l.id);
                        setShowAdd(false);
                      }}
                      style={{ ...s.btn, alignSelf: "flex-start", fontSize: 12, padding: "6px 14px", minHeight: 36 }}>
                      {t("activities.edit")}
                    </button>
                  </div>
                )}
              </div>
            );
          }

          const onCardClick = () => {
            if (selectMode) {
              toggleSelected(l.id);
            } else {
              setEditingId(l.id);
              setShowAdd(false);
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
                <div style={{ flex: 1, minWidth: 0, display: "flex", gap: 6, flexWrap: isNarrow ? "wrap" : "nowrap", overflow: "hidden" }}>
                  {l.subTypes.filter(st => {
                    if (RUN_FLAGS.includes(st)) return true;
                    if (RUN_PACE_TYPES.includes(st)) return l.type === "Road Run";
                    return l.type === "Strength";
                  }).map(st => {
                    const isFlag = RUN_FLAGS.includes(st);
                    return (
                      <div key={st} style={isFlag
                        ? { ...s.subTag, background: "rgba(181,78,26,0.08)", color: "var(--warn)", borderColor: "rgba(181,78,26,0.3)" }
                        : s.subTag}>
                        {isFlag ? "▲ " : ""}{t(`enum.subtype.${st}`)}
                      </div>
                    );
                  })}
                </div>
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
                  flex row that flows naturally on phone widths. */}
              <div style={isNarrow ? {
                display: "flex", flexWrap: "wrap",
                gap: "6px 14px",
                alignItems: "center",
                fontFamily: "var(--font-mono)",
                fontVariantNumeric: "tabular-nums",
              } : {
                display: "grid",
                gridTemplateColumns: "90px 80px 110px 80px 80px 80px 55px 75px",
                gap: 8,
                alignItems: "center",
                fontFamily: "var(--font-mono)",
                fontVariantNumeric: "tabular-nums",
                flexShrink: 0,
              }}>
                {/* 1. Distance */}
                <div>
                  {l.distance > 0 && (
                    <span style={{ fontWeight: 500, fontSize: 14, color: "var(--ink-1)", display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <span style={{ color: "var(--ink-3)" }}><RouteIcon size={13} /></span>
                      {l.distance}<span style={{ color: "var(--ink-3)", marginLeft: 1, fontSize: 10 }}>km</span>
                    </span>
                  )}
                </div>
                {/* 2. Ascent — right after distance */}
                <div>
                  {l.ascent > 0 && (
                    <span style={{ fontSize: 13, color: "var(--moss-deep)", display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <span style={{ color: "var(--moss)" }}><PeakIcon size={13} /></span>
                      +{l.ascent}<span style={{ color: "var(--ink-3)", fontSize: 10, marginLeft: 1 }}>m</span>
                    </span>
                  )}
                </div>
                {/* 3. Duration */}
                <div>
                  {l.duration > 0 && (
                    <span style={{ fontSize: 13, color: "var(--ink-2)", display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <span style={{ color: "var(--ink-3)" }}><ClockIcon size={13} /></span>
                      {formatDuration(l.duration)}
                    </span>
                  )}
                </div>
                {/* 4. Pace — separated from duration so it gets its own icon and column */}
                <div>
                  {l.pace > 0 && (
                    <span style={{ fontSize: 13, color: "var(--ink-2)", display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <span style={{ color: "var(--ink-3)" }}><RunnerIcon size={13} /></span>
                      {formatPaceFromSec(l.pace)}<span style={{ color: "var(--ink-3)", fontSize: 10, marginLeft: 1 }}>/km</span>
                    </span>
                  )}
                </div>
                {/* 5. GAP — grade-adjusted pace, sits right after the regular pace */}
                <div>
                  {l.gap > 0 && (
                    <span style={{ fontSize: 13, color: "var(--ink-2)", display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <span style={{ color: "var(--ink-3)" }}><GaugeIcon size={13} /></span>
                      {formatPaceFromSec(l.gap)}
                    </span>
                  )}
                </div>
                {/* 6. HR */}
                <div>
                  {l.hr > 0 && (
                    <span style={{ fontSize: 13, color: "var(--ink-2)", display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <span style={{ color: "var(--danger)" }}><HeartIcon size={12} /></span>
                      {l.hr}{l.maxHR > 0 ? <span style={{ color: "var(--ink-3)" }}>/{l.maxHR}</span> : null}
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
                {/* 8. Cadence (SPM) — Road Run only, last column per user request */}
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
    </div>
  );
}

// ─── Mobile metric helpers ────────────────────────────────────────────────
// Per-activity-type compact summary shown in row 2 of every card; the
// remaining numbers are deferred to ExpandedMetrics below (tap to reveal).
//   Road Run               → distance · duration · pace
//   Trail / Hiking / Floor → distance · ascent · duration
//   Strength / HIIT        → duration · HR
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

function CompactMetrics({ log: l }) {
  if (l.type === "Road Run") {
    return (
      <>
        {l.distance > 0 && <MetricDistance km={l.distance} />}
        {l.duration > 0 && <MetricDuration sec={l.duration} />}
        {l.pace > 0 && <MetricPace p={l.pace} />}
      </>
    );
  }
  if (l.type === "Trail Run" || l.type === "Hiking" || l.type === "Floor Climbing") {
    return (
      <>
        {l.distance > 0 && <MetricDistance km={l.distance} />}
        {l.ascent > 0 && <MetricAscent m={l.ascent} />}
        {l.duration > 0 && <MetricDuration sec={l.duration} />}
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
  const isTrailLike = l.type === "Trail Run" || l.type === "Hiking" || l.type === "Floor Climbing";
  const isStrengthLike = l.type === "Strength" || l.type === "HIIT";

  return (
    <div style={{
      display: "flex", gap: 14, flexWrap: "wrap",
      fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums",
      fontSize: 12, color: "var(--ink-2)",
    }}>
      {/* Road Run extras */}
      {isRoad && l.ascent > 0 && <MetricAscent m={l.ascent} />}
      {isRoad && l.gap > 0 && <MetricGAP p={l.gap} />}
      {isRoad && l.hr > 0 && <MetricHR hr={l.hr} maxHR={l.maxHR} />}
      {isRoad && l.cadence > 0 && <MetricCadence spm={l.cadence} />}
      {/* Trail-like extras */}
      {isTrailLike && l.pace > 0 && <MetricPace p={l.pace} />}
      {isTrailLike && l.hr > 0 && <MetricHR hr={l.hr} maxHR={l.maxHR} />}
      {isTrailLike && l.cadence > 0 && <MetricCadence spm={l.cadence} />}
      {/* Strength / HIIT extras */}
      {isStrengthLike && l.distance > 0 && <MetricDistance km={l.distance} />}
      {/* Universal: TE if present */}
      {l.aerobicTE > 0 && <MetricTE te={l.aerobicTE} />}
    </div>
  );
}
