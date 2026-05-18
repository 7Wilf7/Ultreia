import { useState, useRef, useMemo } from "react";
import { s } from "../styles";
import { RUN_SUBTYPES, RUN_FLAGS, SORT_OPTIONS, ACTIVITY_TYPES } from "../constants";
import { useT } from "../i18n/LanguageContext";
import {
  autoClassifyRun, parseTimeToSeconds,
  formatDuration, formatPaceFromSec, formatDateShort, isDuplicate,
} from "../utils/format";
import { ActivityForm } from "./ActivityForm";

// Best-effort mapping from a Garmin "Activity Type" string to one of our top-level types.
// Returns { type, unknown }. When unknown, type is a safe placeholder ("Running") so the row
// stays renderable while the user is prompted to pick the real mapping.
function mapGarminActivityType(at) {
  if (!at) return { type: "Running", unknown: true };
  if (at.includes("trail")) return { type: "Trail Running", unknown: false };
  if (at.includes("hiking") || at.includes("walking") || at === "walk") return { type: "Hiking", unknown: false };
  if (at.includes("stair") || at.includes("stepper") || at.includes("step machine") || at.includes("floor")) return { type: "Floor Climbing", unknown: false };
  if (at.includes("hiit") || at.includes("interval training") || at.includes("crossfit")) return { type: "HIIT", unknown: false };
  if (at.includes("strength") || at.includes("weight")) return { type: "Strength", unknown: false };
  if (at.includes("yoga") || at.includes("pilates") || at.includes("stretch")) return { type: "Strength", unknown: false };
  if (at.includes("run")) return { type: "Running", unknown: false };
  return { type: "Running", unknown: true };
}

export function ActivitiesTab({ logs, setLogs, periodLogs, setConfirmDelete }) {
  const t = useT();
  const [sortBy, setSortBy] = useState("date_desc");
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState(null); // log.id currently being edited inline
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

  function handleAddSubmit(logData) {
    setLogs([{ id: Date.now(), ...logData }, ...logs]);
    setShowAdd(false);
  }

  function handleEditSubmit(id, logData) {
    setLogs(logs.map(l => l.id === id ? { ...l, ...logData } : l));
    setEditingId(null);
  }

  function handleFileSelect(e) {
    const f = e.target.files[0];
    if (!f) return;
    const name = f.name.toLowerCase();
    if (name.endsWith(".csv")) {
      const reader = new FileReader();
      reader.onload = (ev) => parseGarminCSV(ev.target.result);
      reader.readAsText(f);
    } else if (name.endsWith(".fit")) {
      parseFitFile(f);
    } else {
      setUploadMsg(t("activities.unsupported"));
    }
    e.target.value = "";
  }

  async function parseFitFile(file) {
    setUploadMsg("Loading FIT parser...");
    try {
      if (!window.FitParser) {
        const cdnUrls = [
          "https://cdn.jsdelivr.net/npm/fit-file-parser@1.9.4/dist/fit-parser.js",
          "https://unpkg.com/fit-file-parser@1.9.4/dist/fit-parser.js",
          "https://cdn.jsdelivr.net/npm/fit-file-parser/dist/fit-parser.js",
        ];
        let loaded = false;
        let lastErr = null;
        for (const url of cdnUrls) {
          try {
            await new Promise((resolve, reject) => {
              const script = document.createElement("script");
              script.src = url;
              script.onload = resolve;
              script.onerror = () => reject(new Error(`CDN failed: ${url}`));
              document.head.appendChild(script);
            });
            if (window.FitParser || window.fitParser) { loaded = true; break; }
          } catch (e) { lastErr = e; }
        }
        if (!loaded) {
          throw lastErr || new Error("All CDN sources failed");
        }
      }

      const FitParserClass = window.FitParser
        || (window.fitParser && window.fitParser.default)
        || (window.fitParser && window.fitParser.FitParser)
        || window.fitParser;

      if (!FitParserClass || typeof FitParserClass !== "function") {
        setUploadMsg("FIT parser library loaded but constructor not found. Try uploading CSV from Garmin Connect instead.");
        return;
      }

      const buf = await file.arrayBuffer();
      const fitParser = new FitParserClass({
        force: true, speedUnit: "km/h", lengthUnit: "km",
        temperatureUnit: "celsius", elapsedRecordField: true, mode: "list",
      });

      fitParser.parse(buf, (err, data) => {
        if (err) {
          setUploadMsg(`FIT parse error: ${err.message || JSON.stringify(err) || "unknown"}`);
          return;
        }
        if (!data) { setUploadMsg("FIT file produced no data."); return; }

        const session = data.sessions?.[0]
          || data.activity?.sessions?.[0]
          || (Array.isArray(data.activity?.events) && data.activity);

        let sport, distance, duration, hr, maxHR, cadence, ascent, startTime;
        if (session && session.total_distance !== undefined) {
          sport = (session.sport || "").toLowerCase();
          const subSport = (session.sub_sport || "").toLowerCase();
          if (sport === "running" && subSport.includes("trail")) sport = "trail";
          distance = +(session.total_distance || 0).toFixed(2);
          duration = Math.round(session.total_timer_time || session.total_elapsed_time || 0);
          hr = Math.round(session.avg_heart_rate || 0);
          maxHR = Math.round(session.max_heart_rate || 0);
          cadence = Math.round((session.avg_running_cadence || 0) * 2) || Math.round(session.avg_cadence || 0);
          ascent = Math.round(session.total_ascent || 0);
          startTime = session.start_time;
        } else {
          const records = data.records || data.activity?.records || [];
          if (records.length === 0) {
            setUploadMsg("FIT file parsed but no session or records found.");
            return;
          }
          sport = "running";
          const distArr = records.filter(r => r.distance != null);
          distance = distArr.length ? +(distArr[distArr.length - 1].distance).toFixed(2) : 0;
          const first = records[0], last = records[records.length - 1];
          duration = first.timestamp && last.timestamp ? Math.round((new Date(last.timestamp) - new Date(first.timestamp)) / 1000) : 0;
          const hrArr = records.filter(r => r.heart_rate).map(r => r.heart_rate);
          hr = hrArr.length ? Math.round(hrArr.reduce((a, b) => a + b, 0) / hrArr.length) : 0;
          maxHR = hrArr.length ? Math.max(...hrArr) : 0;
          cadence = 0;
          let asc = 0; const alts = records.filter(r => r.altitude != null).map(r => r.altitude);
          for (let i = 1; i < alts.length; i++) if (alts[i] > alts[i - 1]) asc += alts[i] - alts[i - 1];
          ascent = Math.round(asc);
          startTime = first.timestamp;
        }

        // Use the same mapping as CSV — works because FIT sport strings ("hiking",
        // "trail_running", "stair_climbing") match the same substring checks.
        const mapped = mapGarminActivityType(sport);
        const type = mapped.type;

        const pace = (type !== "Strength" && type !== "HIIT" && distance > 0) ? Math.round(duration / distance) : 0;
        const date = (startTime ? new Date(startTime) : new Date()).toISOString().slice(0, 10);
        const subTypes = type === "Running" ? [autoClassifyRun(hr, false)] : [];

        const newRow = { id: Date.now(), date, type, subTypes, distance, duration, pace, hr, maxHR, ascent, cadence, aerobicTE: 0, gap: 0 };

        const dup = logs.find(l => isDuplicate(l, newRow));
        if (dup) {
          setDuplicateWarning({ existing: dup, incoming: [newRow], source: "fit" });
        } else {
          setLogs([newRow, ...logs]);
          setUploadMsg(t("activities.import_one", { dist: distance, dur: formatDuration(duration), hr: hr || "—" }));
          setTimeout(() => setUploadMsg(""), 5000);
        }
      });
    } catch (err) {
      setUploadMsg(`FIT parser error: ${err.message || "unknown"}. Try exporting as CSV from Garmin Connect instead.`);
    }
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
    const iType = idx("Activity Type"), iDate = idx("Date");
    const iDist = idx("Distance"), iTime = idx("Time");
    const iAvgHR = idx("Avg HR"), iMaxHR = idx("Max HR");
    const iAscent = idx("Total Ascent");
    const iCadence = idx("Avg Run Cadence");
    const iTE = idx("Aerobic TE");
    const iGAP = idx("Avg GAP");

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
      const subTypes = mapped.type === "Running" ? [autoClassifyRun(hr, false)] : [];

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
      if (rest.type === "Running" && (!rest.subTypes || rest.subTypes.length === 0)) {
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

  function confirmDuplicates(skipDups) {
    if (duplicateWarning.source === "fit") {
      if (!skipDups) setLogs([...duplicateWarning.incoming, ...logs]);
      setUploadMsg(skipDups ? t("activities.skipped_one") : t("activities.added_one"));
      setDuplicateWarning(null);
      setTimeout(() => setUploadMsg(""), 4000);
    } else {
      let rows = duplicateWarning.incoming;
      if (skipDups) rows = rows.filter(r => !duplicateWarning.dupIds.includes(r.id));
      setParsedRows(rows);
      setUploadMsg(t("activities.ready", { n: rows.length }));
      setDuplicateWarning(null);
    }
  }

  function importParsed() {
    const toAdd = parsedRows.filter(r => r._selected).map(r => { const { _selected, ...rest } = r; return rest; });
    setLogs([...toAdd, ...logs]);
    setParsedRows(null);
    setUploadMsg(t("activities.import_done", { n: toAdd.length }));
    setTimeout(() => setUploadMsg(""), 4000);
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={() => fileRef.current.click()} style={s.btnGhost}>{t("activities.upload")}</button>
        <input ref={fileRef} type="file" accept=".csv,.fit" style={{ display: "none" }} onChange={handleFileSelect} />
        <button onClick={() => { setShowAdd(!showAdd); setEditingId(null); }} style={s.btn}>{t("activities.add_manual")}</button>
        <button onClick={toggleSelectMode} style={selectMode ? s.btn : s.btnGhost}>
          {selectMode ? t("activities.select_on", { n: selectedIds.size }) : t("activities.select_off")}
        </button>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ ...s.muted }}>{t("activities.sort")}</span>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)}
            style={{ ...s.input, width: "auto", padding: "5px 8px", fontSize: 12 }}>
            {SORT_OPTIONS.map(o => <option key={o.id} value={o.id}>{t(`activities.sort.${o.id}`)}</option>)}
          </select>
        </div>
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
            {duplicateWarning.source === "fit"
              ? t("activities.duplicate_fit", { date: formatDateShort(duplicateWarning.incoming[0].date), dist: duplicateWarning.incoming[0].distance, dur: formatDuration(duplicateWarning.incoming[0].duration) })
              : t("activities.duplicate_csv", { dups: duplicateWarning.dupIds.length, total: duplicateWarning.incoming.length })}
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
                {r.type === "Running" && (
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
                display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
                cursor: "pointer",
                ...(isSelected ? { background: "#eef5ff", borderColor: "#7aa8e0" } : {}),
              }}>
              {selectMode && (
                <input type="checkbox" checked={isSelected} readOnly
                  style={{ width: 16, height: 16, pointerEvents: "none" }} />
              )}
              <div style={{ minWidth: 50, fontSize: 12, color: "#888", fontVariantNumeric: "tabular-nums" }}>{formatDateShort(l.date)}</div>
              <div style={s.tag(l.type)}>{t(`enum.activity.${l.type}`)}</div>
              {l.subTypes.map(st => {
                const isFlag = RUN_FLAGS.includes(st);
                return (
                  <div key={st} style={isFlag
                    ? { ...s.subTag, background: "#fff5e6", color: "#b35900", borderColor: "#e8c897" }
                    : s.subTag}>
                    {isFlag ? "🏆 " : ""}{t(`enum.subtype.${st}`)}
                  </div>
                );
              })}
              <div style={{ flex: 1, minWidth: 120, display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
                <span style={{ fontWeight: 500, fontSize: 14 }}>
                  {l.distance > 0 ? l.distance + " km" : formatDuration(l.duration)}
                </span>
                {l.distance > 0 && (
                  <span style={s.muted}>{formatDuration(l.duration)} {l.pace ? "· " + formatPaceFromSec(l.pace) + "/km" : ""}</span>
                )}
                {l.hr > 0 && (
                  <span style={s.muted}>♥ {l.hr}{l.maxHR > 0 ? ` / ${l.maxHR}` : ""}</span>
                )}
                {l.ascent > 0 && <span style={s.muted}>+{l.ascent}m</span>}
                {l.cadence > 0 && <span style={s.muted}>🦶 {l.cadence}</span>}
                {l.aerobicTE > 0 && <span style={s.muted}>TE {l.aerobicTE}</span>}
                {l.gap > 0 && <span style={s.muted}>GAP {formatPaceFromSec(l.gap)}</span>}
              </div>
              {!selectMode && (
                <button onClick={(e) => { e.stopPropagation(); deleteLog(l.id); }}
                  style={{ border: "none", background: "none", color: "#bbb", cursor: "pointer", fontSize: 14, padding: "0 4px" }}
                  title={t("activities.delete_tooltip")}>✕</button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
