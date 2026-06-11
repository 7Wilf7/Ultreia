import { useState, useRef, useMemo } from "react";
import { s } from "../styles";
import { RUN_SUBTYPES, RUN_FLAGS, RUN_PACE_TYPES, RUN_GROUP_TYPES, SORT_OPTIONS, ACTIVITY_TYPES, TYPE_COLOR } from "../constants";
import { useT, useLanguage } from "../i18n/LanguageContext";
import { useIsNarrow, useIsMobile } from "../hooks/useMediaQuery";
import {
  recommendRunType, parseTimeToSeconds,
  formatDuration, formatPaceFromSec, formatSpeedKmh, formatSwimPace, formatDateShort, formatWeekdayShort, isDuplicate,
} from "../utils/format";
import { computeHRZones, calculateAge } from "../utils/profile";
import { parseFitFile } from "../lib/fit";
import { weatherWindowEligible } from "../lib/weather";
import { ActivityForm } from "./ActivityForm";
import { Dropdown } from "./Dropdown";
import { ItemActionModal } from "./ItemActionModal";
import { ModalRoot } from "./ModalRoot";
import {
  ClockIcon, HeartIcon, PeakIcon, FootIcon, RouteIcon, RunnerIcon,
  PlusIcon, UploadIcon, CheckSquareIcon,
} from "./Icons";

// Best-effort mapping from a Garmin "Activity Type" string to one of our top-level types.
// Returns { type, unknown }. When unknown, type is a safe placeholder ("Road Run") so the row
// stays renderable while the user is prompted to pick the real mapping.
function mapGarminActivityType(at) {
  if (!at) return { type: "Road Run", unknown: true };
  if (at.includes("trail")) return { type: "Trail Run", unknown: false };
  if (at.includes("hiking") || at.includes("walking") || at === "walk") return { type: "Hiking", unknown: false };
  if (at.includes("stair") || at.includes("stepper") || at.includes("step machine") || at.includes("floor")) return { type: "Floor Climbing", unknown: false };
  if (at.includes("cycl") || at.includes("bike") || at.includes("biking")) return { type: "Cycling", unknown: false };
  if (at.includes("swim")) return { type: "Swimming", unknown: false };
  if (at.includes("hiit") || at.includes("interval training") || at.includes("crossfit")) return { type: "HIIT", unknown: false };
  // Coros logs gym/class cardio as "training cardio_training" — treat as HIIT
  // (the dominant case; the occasional short one can be edited to Strength).
  if (at.includes("cardio")) return { type: "HIIT", unknown: false };
  if (at.includes("strength") || at.includes("weight")) return { type: "Strength", unknown: false };
  if (at.includes("yoga") || at.includes("pilates") || at.includes("stretch")) return { type: "Strength", unknown: false };
  if (at.includes("run")) return { type: "Road Run", unknown: false };
  return { type: "Road Run", unknown: true };
}

export function ActivitiesTab({ logs, addLog, updateLog, bulkAddLogs, periodLogs, setConfirmDelete, profile, toolbarStickyTop = 0, stickyHeader = null, loadChip = null, onCoachReviewRequest }) {
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
  const [unknownTypeRows, setUnknownTypeRows] = useState(null); // staged rows until user maps unknown types
  const [unknownChoices, setUnknownChoices] = useState({}); // originalType → target type | "__skip__"
  const [parseProgress, setParseProgress] = useState(null); // { done, total } during a batch FIT/ZIP parse
  const [importWeather, setImportWeather] = useState(true); // fetch weather for import rows inside Caiyun's 24h window
  // Cap how many rows render at once. With hundreds of activities, rendering
  // them all builds a huge DOM (each card has several SVG icons) → slow tab
  // switch + janky pull-to-refresh. Show a page at a time via "load more".
  const PAGE = 60;
  const [shown, setShown] = useState(PAGE);
  const fileRef = useRef();

  // Distinct unknown-type groups (by original sport name) + their row counts,
  // so the mapping modal asks once per type instead of once per row (a Coros
  // folder can have 100+ rows of the same unmapped type).
  const unknownGroups = useMemo(() => {
    if (!unknownTypeRows) return [];
    const m = new Map();
    for (const r of unknownTypeRows) {
      if (!r._unknown) continue;
      const k = r._originalType || "(empty)";
      m.set(k, (m.get(k) || 0) + 1);
    }
    return [...m.entries()].map(([orig, count]) => ({ orig, count }));
  }, [unknownTypeRows]);

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

  // Live selected count — only ids that still exist in the current list. After
  // a bulk delete the removed ids linger in selectedIds; counting against the
  // live list keeps the "N selected" badge correct (was: deleted 17 + 1 = 18).
  const selectedCount = useMemo(() => {
    if (selectedIds.size === 0) return 0;
    let n = 0;
    for (const l of periodLogs) if (selectedIds.has(l.id)) n++;
    return n;
  }, [periodLogs, selectedIds]);

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
      const created = await addLog(logData);
      setShowAdd(false);
      if (onCoachReviewRequest && created && !created.isPlanned) {
        onCoachReviewRequest([created], { count: 1, source: "manual" });
      }
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
    const reader = new FileReader();
    if (name.endsWith(".csv")) {
      reader.onload = (ev) => parseGarminCSV(ev.target.result);
      reader.readAsText(f);
    } else if (name.endsWith(".fit")) {
      reader.onload = (ev) => parseFitImport([ev.target.result]);
      reader.readAsArrayBuffer(f);
    } else if (name.endsWith(".zip")) {
      reader.onload = (ev) => parseZipImport(ev.target.result);
      reader.readAsArrayBuffer(f);
    } else {
      setUploadMsg(t("activities.unsupported"));
    }
    e.target.value = "";
  }

  // HR zones for the FIT zone-time calc: use the user's configured zones, else
  // fall back to an age-based estimate (Max ≈ 220−age, Resting 60) so the
  // distribution still works even if they haven't filled Resting/Max HR.
  function fitHrZones() {
    if (hrZones) return hrZones;
    const age = calculateAge(profile?.birthDate);
    if (!age) return null;
    return computeHRZones(60, 220 - age, profile?.hrZoneMethod);
  }

  // Shape one parsed FIT summary into an import row — same shape as a CSV row,
  // plus the FIT-only extras (startedAt / hrZoneSeconds / gpsTrack) that ride
  // straight through to the DB.
  function fitRow(d, idSeed) {
    const mapped = mapGarminActivityType(d.sportStr);
    // pace (min/km) only for running types; Cycling/Swimming/Strength/HIIT don't use it.
    const pace = (RUN_GROUP_TYPES.includes(mapped.type) && d.distance > 0) ? Math.round(d.duration / d.distance) : 0;
    const subTypes = mapped.type === "Road Run" ? [recommendRunType(d.hr, false, hrZones)] : [];
    return {
      id: idSeed,
      date: d.date,
      type: mapped.type, subTypes,
      distance: d.distance, duration: d.duration, pace,
      hr: d.hr, maxHR: d.maxHR, ascent: d.ascent, cadence: d.cadence,
      startedAt: d.startedAt,
      hrZoneSeconds: d.hrZoneSeconds, gpsTrack: d.gpsTrack,
      _selected: true,
      _unknown: mapped.unknown,
      _originalType: mapped.unknown ? (d.sportStr || "(empty)") : undefined,
    };
  }

  // Parse one or more FIT ArrayBuffers → the shared review / dedup / import
  // pipeline (FIT reuses everything the CSV path uses).
  async function parseFitImport(buffers) {
    const total = buffers.length;
    const batch = total > 1;
    if (batch) { setParseProgress({ done: 0, total }); setUploadMsg(""); }
    else setUploadMsg(t("activities.fit_parsing"));
    const zones = fitHrZones();
    const rows = [];
    for (let i = 0; i < buffers.length; i++) {
      try {
        const d = await parseFitFile(buffers[i], zones);
        if (d.duration) rows.push(fitRow(d, Date.now() + rows.length));
      } catch (err) { console.error("[FIT] parse failed:", err); }
      // Update progress + yield to the event loop every few files so the bar
      // actually repaints during a long batch (awaiting the parser alone only
      // flushes microtasks, which don't paint).
      if (batch && (i % 5 === 4 || i === buffers.length - 1)) {
        setParseProgress({ done: i + 1, total });
        await new Promise(r => setTimeout(r, 0));
      }
    }
    setParseProgress(null);
    if (!rows.length) { setUploadMsg(t("activities.fit_empty")); return; }
    setUploadMsg("");
    if (rows.some(r => r._unknown)) { setUnknownChoices({}); setUnknownTypeRows(rows); return; }
    finalizeParsedRows(rows);
  }

  // .zip of .fit files → unzip in-browser (lazy-loaded fflate), parse each.
  async function parseZipImport(arrayBuffer) {
    setUploadMsg(t("activities.fit_parsing"));
    try {
      const { unzipSync } = await import("fflate");
      const files = unzipSync(new Uint8Array(arrayBuffer));
      const fits = Object.entries(files)
        .filter(([n]) => n.toLowerCase().endsWith(".fit") && !n.startsWith("__MACOSX"))
        .map(([, bytes]) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      if (!fits.length) { setUploadMsg(t("activities.zip_no_fit")); return; }
      await parseFitImport(fits);
    } catch (err) {
      console.error("[ZIP] failed:", err);
      setUploadMsg(t("activities.fit_failed"));
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
      // pace only meaningful for running types; placeholder Running for unknowns is overridden later
      const pace = (RUN_GROUP_TYPES.includes(mapped.type) && distance > 0) ? Math.round(duration / distance) : 0;
      const date = c[iDate].split(" ")[0];
      const subTypes = mapped.type === "Road Run" ? [recommendRunType(hr, false, hrZones)] : [];

      rows.push({
        id: Date.now() + i, date,
        type: mapped.type, subTypes,
        distance, duration, pace, hr, maxHR, ascent, cadence,
        _selected: true,
        _unknown: mapped.unknown,
        _originalType: mapped.unknown ? (c[iType] || "(empty)") : undefined,
      });
    }

    // If any row had an unrecognized type, surface the mapping modal first.
    // Duplicate detection waits until after mapping is resolved (type may change).
    const unknowns = rows.filter(r => r._unknown);
    if (unknowns.length > 0) {
      setUnknownChoices({});
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
    // Per-group choice: map every row of that original type to the chosen type,
    // or drop it entirely when the group is set to skip. Known rows pass through.
    const cleaned = [];
    for (const r of unknownTypeRows) {
      if (!r._unknown) {
        const rest = { ...r };
        delete rest._unknown; delete rest._originalType;
        cleaned.push(rest);
        continue;
      }
      const choice = unknownChoices[r._originalType || "(empty)"];
      if (choice === "__skip__") continue; // dropped — not imported
      const rest = { ...r, type: choice };
      delete rest._unknown; delete rest._originalType;
      if (rest.type === "Road Run" && (!rest.subTypes || rest.subTypes.length === 0)) {
        rest.subTypes = [recommendRunType(rest.hr, false, hrZones)];
      }
      // A mapped non-running type shouldn't carry a leftover placeholder pace.
      if (!RUN_GROUP_TYPES.includes(rest.type)) rest.pace = 0;
      cleaned.push(rest);
    }
    setUnknownTypeRows(null);
    setUnknownChoices({});
    finalizeParsedRows(cleaned);
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
      const created = await bulkAddLogs(toAdd, { fetchWeather: importWeather });
      setParsedRows(null);
      setUploadMsg(t("activities.import_done", { n: toAdd.length }));
      setTimeout(() => setUploadMsg(""), 4000);
      if (onCoachReviewRequest && created?.length) {
        onCoachReviewRequest(created.slice(0, 3), { count: created.length, source: "import" });
      }
    } catch {
      // alert shown by wrapper; leave the review panel open so user can retry / cancel
    }
  }

  function cancelParsedImport() {
    setParsedRows(null);
    setUploadMsg("");
    setParseProgress(null);
    setDuplicateWarning(null);
  }

  // Icon-only toolbar buttons (labels dropped — the watch-file Upload flow is
  // now the primary path, so the bar is glyphs + a black-filled Upload first).
  const iconBtnStyle = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    position: "relative",
    padding: isMobile ? "0 11px" : "0 12px",
    flexShrink: 0,
    minHeight: isMobile ? 36 : 32,
  };
  return (
    <div>
      {/* Icon-only action bar. Upload (black-filled) leads since uploading a
          .fit / .zip / .csv is the main way activities get in; Add stays as a
          glyph for the occasional manual entry. Fits a 360-wide phone easily.
          Sticky: pins right below the (sticky) stats row so upload/add/select/
          sort stay reachable while the list scrolls. Page bg + a top gap; on
          mobile the negative side margins let the bg cover the 14px gutter so
          scrolled list rows don't peek through at the edges. */}
      <div style={{
        display: stickyHeader ? "block" : "flex",
        gap: stickyHeader ? 0 : 6,
        alignItems: "center",
        position: "sticky", top: toolbarStickyTop, zIndex: stickyHeader ? 10 : 8,
        background: "var(--bg)",
        marginLeft: isMobile ? -14 : 0, marginRight: isMobile ? -14 : 0,
        marginTop: stickyHeader && isMobile ? "calc(-1 * max(env(safe-area-inset-top), 14px))" : 0,
        paddingLeft: isMobile ? 14 : 0, paddingRight: isMobile ? 14 : 0,
        paddingTop: stickyHeader
          ? (isMobile ? "calc(max(env(safe-area-inset-top), 14px) + 4px)" : 8)
          : (isMobile ? 6 : 8),
        paddingBottom: stickyHeader ? 0 : (isMobile ? 8 : 6),
        marginBottom: stickyHeader && isMobile ? 6 : 14,
        boxSizing: "border-box",
      }}>
        {stickyHeader}
        <div style={{
          display: "flex", gap: 6, alignItems: "center",
          minHeight: isMobile ? 50 : 46,
          paddingTop: isMobile ? 6 : 8,
          paddingBottom: isMobile ? 8 : 6,
          boxSizing: "border-box",
        }}>
        <button onClick={() => fileRef.current.click()} title={t("activities.upload_short")}
          aria-label={t("activities.upload_short")} style={{ ...s.btn, ...iconBtnStyle }}>
          <UploadIcon size={15} />
          {isMobile && <span style={{ fontSize: 12 }}>{t("activities.upload_short")}</span>}
        </button>
        {/* No accept filter: Android greys out .fit (no registered MIME for the
            extension), making them unselectable. We validate by extension in
            handleFileSelect instead, so any picked non-.fit/.csv/.zip is rejected
            there with a message. */}
        <input ref={fileRef} type="file" style={{ display: "none" }} onChange={handleFileSelect} />
        <button onClick={() => { setShowAdd(!showAdd); setEditingId(null); }} title={t("activities.add_short")}
          aria-label={t("activities.add_short")} style={{ ...s.btnGhost, ...iconBtnStyle }}>
          <PlusIcon size={15} />
        </button>
        <button onClick={toggleSelectMode} title={t("activities.select_short")}
          aria-label={t("activities.select_short")} style={{ ...(selectMode ? s.btn : s.btnGhost), ...iconBtnStyle }}>
          <CheckSquareIcon size={15} />
          {selectMode && selectedCount > 0 && (
            <span style={{ fontSize: 12, fontFamily: "var(--font-mono)" }}>{selectedCount}</span>
          )}
        </button>
        {/* Sort — a fixed-width field dropdown so the menu lines up under the
            box (same width, right-anchored) and the box height matches the
            icon buttons on its left. */}
        <div style={{ marginLeft: "auto", width: isMobile ? 112 : 132, flexShrink: 0 }}>
          <Dropdown
            variant="field"
            align="right"
            ariaLabel="Sort activities"
            triggerStyle={{ minHeight: isMobile ? 36 : 32, padding: "0 10px", fontSize: 13 }}
            options={SORT_OPTIONS.map(o => ({ value: o.id, label: t(`activities.sort.${o.id}`) }))}
            value={sortBy}
            onChange={setSortBy}
          />
        </div>
        </div>
        {/* Training-load strip — lives inside the sticky block so it pins with
            the stats + toolbar and doesn't scroll away. */}
        {loadChip}
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
          <button onClick={bulkDeleteSelected} disabled={selectedCount === 0}
            style={{ ...s.btn, fontSize: 12, padding: "5px 12px", background: "#c0392b", borderColor: "#c0392b", opacity: selectedCount === 0 ? 0.5 : 1 }}>
            {t("activities.delete_sel")}
          </button>
        </div>
      )}

      {uploadMsg && (
        <div style={{ fontSize: 12, color: "#555", background: "#f0f0f0", borderRadius: 6, padding: "8px 12px", marginBottom: 14, lineHeight: 1.6 }}>{uploadMsg}</div>
      )}

      {parseProgress && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: "#555", marginBottom: 6, fontFamily: "var(--font-mono)" }}>
            {t("activities.parsing_progress", { done: parseProgress.done, total: parseProgress.total })}
          </div>
          <div style={{ height: 6, background: "var(--bg-sunken, #eee)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{
              height: "100%",
              width: `${Math.round((parseProgress.done / parseProgress.total) * 100)}%`,
              background: "var(--ink-1)", transition: "width 0.15s ease",
            }} />
          </div>
        </div>
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
            {t("activities.unknown_type_body", { n: unknownTypeRows.filter(r => r._unknown).length, g: unknownGroups.length })}
          </div>
          {/* Grouped by original sport name — one choice per type covers all its
              rows. No inner scroll (it clipped the Dropdown menu); page scrolls. */}
          <div style={{ marginBottom: 10 }}>
            {unknownGroups.map(({ orig, count }) => (
              <div key={orig} style={{ background: "#fff", borderRadius: 6, padding: "8px 10px", marginBottom: 6, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{ fontSize: 12, flex: 1, minWidth: 150 }}>
                  <span style={{ color: "#999" }}>{t("activities.unknown_type_original")}</span>
                  <span style={{ fontFamily: "var(--font-mono)", color: "#333" }}>{orig}</span>
                  <span style={{ color: "#aaa", marginLeft: 6 }}>{t("activities.unknown_count", { n: count })}</span>
                </div>
                <div style={{ width: 170 }}>
                  <Dropdown
                    ariaLabel={t("form.type")}
                    options={[
                      ...ACTIVITY_TYPES.map(at => ({ value: at, label: t(`enum.activity.${at}`) })),
                      { value: "__skip__", label: t("activities.unknown_skip") },
                    ]}
                    value={unknownChoices[orig] || ""}
                    placeholder={t("form.type")}
                    onChange={(v) => setUnknownChoices(c => ({ ...c, [orig]: v }))}
                  />
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={applyUnknownMappings}
              disabled={!unknownGroups.every(g => unknownChoices[g.orig])}
              style={{ ...s.btn, opacity: unknownGroups.every(g => unknownChoices[g.orig]) ? 1 : 0.5 }}>
              {t("activities.unknown_type_apply")}
            </button>
            <button onClick={() => { setUnknownTypeRows(null); setUnknownChoices({}); setUploadMsg(""); }} style={s.btnGhost}>{t("common.cancel")}</button>
          </div>
        </div>
      )}

      {parsedRows && (
        <div style={{ ...s.cardDark, marginBottom: 14 }}>
          <div style={{ ...s.section, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>{t("activities.review", { sel: parsedRows.filter(r => r._selected).length, total: parsedRows.length })}</span>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={cancelParsedImport} style={{ ...s.btnGhost, fontSize: 12, padding: "5px 10px" }}>{t("common.cancel")}</button>
              <button onClick={importParsed} style={{ ...s.btn, fontSize: 12, padding: "5px 12px" }}>{t("activities.import")}</button>
            </div>
          </div>
          {/* Weather toggle — only when at least one selected row falls inside
              Caiyun's 24h window (older rows can't get weather). Uses the FIT's
              own GPS for location; default on. */}
          {parsedRows.some(r => r._selected && weatherWindowEligible({ startedAt: r.startedAt, date: r.date })) && (
            <label style={{ display: "flex", alignItems: "center", gap: 8, margin: "10px 0", cursor: "pointer" }}>
              <input type="checkbox" checked={importWeather}
                onChange={e => setImportWeather(e.target.checked)}
                style={{ width: 16, height: 16, flexShrink: 0, minHeight: 0 }} />
              <span style={{ fontSize: 12, color: "#666" }}>{t("activities.import_weather")}</span>
            </label>
          )}
          {/* No inner scroll — it clipped the run-type Dropdown's menu (it had
              to be scrolled to). The page scrolls instead. */}
          <div>
            {parsedRows.map(r => (
              <div key={r.id} style={{ background: "#fff", borderRadius: 6, padding: "8px 10px", marginBottom: 6, display: "flex", flexDirection: "column", gap: 6 }}>
                {/* Line 1 — select · date · type · (Road Run) subtype picker */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="checkbox" checked={r._selected} onChange={() => setParsedRows(parsedRows.map(x => x.id === r.id ? { ...x, _selected: !x._selected } : x))} style={{ width: 16, height: 16, flexShrink: 0, minHeight: 0 }} />
                  <div style={{ fontSize: 11, color: "#888", flexShrink: 0 }}>{formatDateShort(r.date)}</div>
                  <div style={s.tag(r.type)}>{t(`enum.activity.${r.type}`)}</div>
                  {r.type === "Road Run" && (
                    <div style={{ width: 132, marginLeft: "auto" }}>
                      <Dropdown
                        ariaLabel={t("form.run_type")}
                        triggerStyle={{ fontSize: 11.5, padding: "6px 8px", minHeight: 0 }}
                        options={RUN_SUBTYPES.map(st => ({ value: st, label: t(`enum.subtype.${st}`) }))}
                        value={r.subTypes[0] || ""}
                        onChange={(v) => setParsedRows(parsedRows.map(x => x.id === r.id ? { ...x, subTypes: [v] } : x))}
                      />
                    </div>
                  )}
                </div>
                {/* Line 2 — metrics + a small RPE box at the end */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ fontSize: 12, flex: 1, color: "#555", fontFamily: "var(--font-mono)", minWidth: 0 }}>
                    {r.distance > 0 && <span>{r.distance}km · </span>}
                    {formatDuration(r.duration)}{r.hr > 0 && ` · HR ${r.hr}`}{r.ascent > 0 && ` · +${r.ascent}m`}
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                    <span style={{ fontSize: 11, color: "#888" }}>RPE</span>
                    <input type="number" inputMode="numeric" min="1" max="10" value={r.rpe || ""} placeholder="–"
                      onChange={e => {
                        const raw = e.target.value;
                        const v = raw === "" ? 0 : Math.max(1, Math.min(10, parseInt(raw, 10) || 0));
                        setParsedRows(parsedRows.map(x => x.id === r.id ? { ...x, rpe: v } : x));
                      }}
                      style={{ width: 44, fontSize: 12, padding: "4px 6px", textAlign: "center", minHeight: 0, border: "1px solid var(--rule)", borderRadius: 4, background: "#fff", color: "var(--ink-1)" }} />
                  </label>
                </div>
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
        {displayedLogs.slice(0, shown).map(l => {
          const isSelected = selectedIds.has(l.id);

          // Mobile compact card — fixed-height two-row layout. Tap expands to
          // reveal all metrics + an Edit button. Tap again to collapse.
          if (isMobile) {
            const expandable = hasExpandableMetrics(l);
            const isExpanded = expandedId === l.id && expandable;
            const onMobileCardClick = () => {
              if (selectMode) toggleSelected(l.id);
              // Nothing extra to reveal (e.g. an indoor Strength/HIIT with just
              // duration + HR) → no expand animation, the chip stays put.
              else if (expandable) setExpandedId(isExpanded ? null : l.id);
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
                {/* 3. Distance — Swimming reads in meters, others in km */}
                <div>
                  {l.distance > 0 && (
                    <span style={{ fontWeight: 500, fontSize: 14, color: "var(--ink-1)", display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <span style={{ color: "var(--ink-3)" }}><RouteIcon size={13} /></span>
                      {l.type === "Swimming"
                        ? <>{Math.round(l.distance * 1000)}<span style={{ color: "var(--ink-3)", marginLeft: 1, fontSize: 10 }}>m</span></>
                        : <>{l.distance}<span style={{ color: "var(--ink-3)", marginLeft: 1, fontSize: 10 }}>km</span></>}
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
                {/* 5. Pace — Cycling shows speed (km/h), Swimming /100m, runs /km */}
                <div>
                  {l.type === "Cycling" && l.distance > 0 && l.duration > 0 ? (
                    <span style={{ fontSize: 13, color: "var(--ink-2)", display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <span style={{ color: "var(--ink-3)" }}><RunnerIcon size={13} /></span>
                      {formatSpeedKmh(l.distance, l.duration)}<span style={{ color: "var(--ink-3)", fontSize: 10, marginLeft: 1 }}>km/h</span>
                    </span>
                  ) : l.type === "Swimming" && l.distance > 0 && l.duration > 0 ? (
                    <span style={{ fontSize: 13, color: "var(--ink-2)", display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <span style={{ color: "var(--ink-3)" }}><RunnerIcon size={13} /></span>
                      {formatSwimPace(l.distance, l.duration)}<span style={{ color: "var(--ink-3)", fontSize: 10, marginLeft: 1 }}>/100m</span>
                    </span>
                  ) : l.pace > 0 ? (
                    <span style={{ fontSize: 13, color: "var(--ink-2)", display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <span style={{ color: "var(--ink-3)" }}><RunnerIcon size={13} /></span>
                      {formatPaceFromSec(l.pace)}<span style={{ color: "var(--ink-3)", fontSize: 10, marginLeft: 1 }}>/km</span>
                    </span>
                  ) : null}
                </div>
                {/* Cadence (SPM) — Road Run only */}
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
        {displayedLogs.length > shown && (
          <button onClick={() => setShown(n => n + PAGE)}
            style={{ ...s.btnGhost, alignSelf: "center", marginTop: 4, fontSize: 13, padding: "8px 18px" }}>
            {t("activities.load_more", { n: displayedLogs.length - shown })}
          </button>
        )}
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
// Cycling headline = speed (km/h). Swimming headline = pace per 100m. Both
// reuse the pace icon slot (they're the "how fast" metric for their sport).
function MetricSpeed({ kmh }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{ color: "var(--ink-3)" }}><RunnerIcon size={12} /></span>
      {kmh}<span style={{ color: "var(--ink-3)", fontSize: 10, marginLeft: 1 }}>km/h</span>
    </span>
  );
}
function MetricSwimPace({ p }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{ color: "var(--ink-3)" }}><RunnerIcon size={12} /></span>
      {p}<span style={{ color: "var(--ink-3)", fontSize: 10, marginLeft: 1 }}>/100m</span>
    </span>
  );
}
// Swim distance reads in meters (1500m), not km.
function MetricSwimDistance({ km }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{ color: "var(--ink-3)" }}><RouteIcon size={12} /></span>
      {Math.round(km * 1000)}<span style={{ color: "var(--ink-3)", fontSize: 10, marginLeft: 1 }}>m</span>
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
// Show the weather chip whenever a row actually has weather. Indoor sessions
// normally carry none (the add form defaults the toggle off for them), so this
// stays clean — but if the user deliberately captured weather for, say, an
// outdoor strength session, we honor it and show the chip.
function showWeather(log) {
  return !!log.weather;
}
// Whether tapping a mobile card would reveal anything beyond the compact row —
// mirrors what ExpandedMetrics actually renders (+ the weather line). When
// false we skip the expand entirely so the card doesn't open to a blank panel.
function hasExpandableMetrics(l) {
  if (showWeather(l)) return true;
  switch (l.type) {
    case "Road Run":       return l.ascent > 0 || l.hr > 0 || l.cadence > 0;
    case "Trail Run":
    case "Hiking":         return l.pace > 0 || l.hr > 0 || l.cadence > 0;
    case "Floor Climbing": return l.distance > 0 || l.pace > 0 || l.hr > 0;
    case "Cycling":        return l.ascent > 0 || l.hr > 0;
    case "Swimming":       return l.hr > 0;
    case "Strength":
    case "HIIT":           return l.distance > 0;
    default:               return false;
  }
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
  if (l.type === "Cycling") {
    return (
      <>
        {l.duration > 0 && <MetricDuration sec={l.duration} />}
        {l.distance > 0 && <MetricDistance km={l.distance} />}
        {l.distance > 0 && l.duration > 0 && <MetricSpeed kmh={formatSpeedKmh(l.distance, l.duration)} />}
      </>
    );
  }
  if (l.type === "Swimming") {
    return (
      <>
        {l.duration > 0 && <MetricDuration sec={l.duration} />}
        {l.distance > 0 && <MetricSwimDistance km={l.distance} />}
        {l.distance > 0 && l.duration > 0 && <MetricSwimPace p={formatSwimPace(l.distance, l.duration)} />}
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
  const isCycling = l.type === "Cycling";
  const isSwimming = l.type === "Swimming";
  const isStrengthLike = l.type === "Strength" || l.type === "HIIT";

  return (
    <>
      {/* Metric data on its own row (weather goes on the line below). All types
          left-pack now — Road Run lost GAP/TE so it no longer needs the
          space-between spread to fit on one line. */}
      <div style={{
        display: "flex", flexWrap: "wrap",
        gap: 14,
        justifyContent: "flex-start",
        fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums",
        fontSize: 12, color: "var(--ink-2)",
      }}>
        {/* Road Run extras */}
        {isRoad && l.ascent > 0 && <MetricAscent m={l.ascent} />}
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
        {/* Cycling extras — ascent + HR (speed/distance are in compact) */}
        {isCycling && l.ascent > 0 && <MetricAscent m={l.ascent} />}
        {isCycling && l.hr > 0 && <MetricHR hr={l.hr} maxHR={l.maxHR} />}
        {/* Swimming extras — HR (distance/pace are in compact) */}
        {isSwimming && l.hr > 0 && <MetricHR hr={l.hr} maxHR={l.maxHR} />}
        {/* Strength / HIIT extras */}
        {isStrengthLike && l.distance > 0 && <MetricDistance km={l.distance} />}
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
