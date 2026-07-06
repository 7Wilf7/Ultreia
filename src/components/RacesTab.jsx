import { useState, useEffect, useRef } from "react";
import { s } from "../styles";
import { RACE_PRIORITY, RACE_CATEGORIES, RACE_CATEGORY_COLOR, SPARTAN_SUBTYPES, SPARTAN_TIER_COLOR, getHyroxSubtypesForGender } from "../constants";
import { useT, useLanguage } from "../i18n/LanguageContext";
import { forwardGeocode, fetchRaceDayWeather, fetchHistoryRaceWeather, skyconMeta } from "../lib/weather";
import { parseDistanceKm, inferRaceCategory } from "../utils/format";
import { useIsNarrow, useIsMobile } from "../hooks/useMediaQuery";
import { ClockIcon } from "./Icons";
import { ModalRoot } from "./ModalRoot";
import { ItemActionModal } from "./ItemActionModal";
import { PersonalRecordsBar } from "./PersonalRecordsBar";
import { Dropdown } from "./Dropdown";
import { useAppDialog } from "./AppDialogContext";
import { Spinner } from "./Spinner";
import { useInstantPress } from "../hooks/useInstantPress";
import { useDeferredCommit } from "../hooks/useDeferredCommit";

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
  locationName: "", locationLat: null, locationLng: null,
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
    locationName: race.locationName || "",
    locationLat: race.locationLat ?? null,
    locationLng: race.locationLng ?? null,
  };
}

// Whole days from `now` to a race date, using LOCAL midnight on both sides so
// users east of UTC don't get an off-by-one. Returns null for missing/invalid
// dates, 0 for race day, negative for past.
function daysUntilRace(dateStr, now) {
  if (!dateStr) return null;
  const race = new Date(`${dateStr}T00:00:00`);
  if (isNaN(race.getTime())) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((race - today) / 86400000);
}

function shouldSkipRaceSwipe(target) {
  return !!target?.closest?.("button,input,textarea,select,a,[role='button'],[data-dropdown-menu]");
}

export function RacesTab({
  races, addRace, updateRace, now, setConfirmDelete, itraPI, setItraPI,
  profile,
  // Lifted to AppShell so the chosen top/sub tab survives switching away to
  // another top-level tab and back (within one app session).
  mobileTopTab, setMobileTopTab, mobileSubTab, setMobileSubTab,
}) {
  const t = useT();
  const appDialog = useAppDialog();
  const { lang } = useLanguage();
  const isNarrow = useIsNarrow();
  const isMobile = useIsMobile();
  const topSwipe = useRef(null);
  const instantPress = useInstantPress();
  const [topTabMotionDir, setTopTabMotionDir] = useState(0);
  const [selectedMobileTopTab, setSelectedMobileTopTab] = useState(mobileTopTab || "races");
  const [selectedMobileSubTab, setSelectedMobileSubTab] = useState(mobileSubTab || "target");
  const commitParentMobileTopTab = useDeferredCommit(setMobileTopTab);
  const commitParentMobileSubTab = useDeferredCommit(setMobileSubTab);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setSelectedMobileTopTab(mobileTopTab || "races");
    });
    return () => { cancelled = true; };
  }, [mobileTopTab]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setSelectedMobileSubTab(mobileSubTab || "target");
    });
    return () => { cancelled = true; };
  }, [mobileSubTab]);

  function changeMobileTopTab(nextTab) {
    if (nextTab === selectedMobileTopTab) return;
    const order = { races: 0, pr: 1 };
    setTopTabMotionDir((order[nextTab] ?? 0) > (order[selectedMobileTopTab] ?? 0) ? 1 : -1);
    setSelectedMobileTopTab(nextTab);
    commitParentMobileTopTab(nextTab);
  }

  function changeMobileSubTab(nextTab) {
    if (nextTab === selectedMobileSubTab) return;
    if (addingMode) cancelAdd();
    setSelectedMobileSubTab(nextTab);
    commitParentMobileSubTab(nextTab);
  }

  function onTopSwipeStart(e) {
    if (!isMobile || e.touches.length !== 1 || shouldSkipRaceSwipe(e.target)) {
      topSwipe.current = null;
      return;
    }
    const p = e.touches[0];
    topSwipe.current = {
      x: p.clientX,
      y: p.clientY,
      t: e.timeStamp || 0,
      w: e.currentTarget?.clientWidth || window.innerWidth || 1,
      mode: null,
    };
  }

  function onTopSwipeMove(e) {
    if (!isMobile || e.touches.length !== 1 || !topSwipe.current) return;
    const st = topSwipe.current;
    const p = e.touches[0];
    const dx = p.clientX - st.x;
    const dy = p.clientY - st.y;
    if (st.mode == null) {
      if (Math.abs(dx) > Math.abs(dy) * 1.08 && Math.abs(dx) > 8) {
        const dir = dx < 0 ? 1 : -1;
        const canMove = (dir > 0 && selectedMobileTopTab === "races") || (dir < 0 && selectedMobileTopTab === "pr");
        st.mode = canMove ? "inner" : "pass";
      } else if (Math.abs(dy) > 6 || Math.abs(dx) > 6) {
        st.mode = "scroll";
      } else {
        return;
      }
    }
    if (st.mode === "inner") {
      e.stopPropagation();
      e.preventDefault?.();
    }
  }

  function onTopSwipeEnd(e) {
    if (!isMobile || !topSwipe.current) return;
    const st = topSwipe.current;
    topSwipe.current = null;
    if (st.mode !== "inner") {
      return;
    }
    const p = e.changedTouches?.[0];
    if (!p) return;
    const dx = p.clientX - st.x;
    const dy = p.clientY - st.y;
    const dt = Math.max(1, (e.timeStamp || 0) - (st.t || 0));
    const velocity = dx / dt;
    const threshold = Math.min((st.w || 1) * 0.16, 58);
    const shouldCommit = Math.abs(dx) >= threshold || Math.abs(velocity) > 0.38;
    if (!shouldCommit || Math.abs(dx) < Math.abs(dy) * 1.08) {
      return;
    }
    if (dx < 0 && selectedMobileTopTab === "races") {
      e.stopPropagation();
      changeMobileTopTab("pr");
    } else if (dx > 0 && selectedMobileTopTab === "pr") {
      e.stopPropagation();
      changeMobileTopTab("races");
    } else {
      return;
    }
  }

  // Race-day weather for upcoming TARGET races that have a location (outdoor
  // only — Hyrox is indoor, skipped). Within ~2 weeks → real forecast; further
  // out → climate normal. Fetched lazily, keyed by race id. Re-runs when the
  // race list changes (new/edited location or date).
  const [raceWeather, setRaceWeather] = useState({});
  // Per-race weather fold state — weather is hidden until the user taps the
  // "weather" chip on the card (keeps the cards compact). Keyed by race id.
  const [weatherOpen, setWeatherOpen] = useState({});
  function toggleWeather(id, e) {
    e?.stopPropagation();
    setWeatherOpen(prev => ({ ...prev, [id]: !prev[id] }));
  }
  useEffect(() => {
    // Outdoor races with a location. Targets (future) → forecast/climate normal;
    // history (past) → the ACTUAL archived weather of that day. Hyrox is indoor.
    const located = races.filter(r => r.category !== "Hyrox"
      && Number.isFinite(r.locationLat) && Number.isFinite(r.locationLng) && r.date);
    let cancelled = false;
    (async () => {
      for (const r of located) {
        const w = r.isTarget
          ? await fetchRaceDayWeather({ lat: r.locationLat, lng: r.locationLng, date: r.date })
          : await fetchHistoryRaceWeather({ lat: r.locationLat, lng: r.locationLng, date: r.date });
        if (cancelled) return;
        if (w) setRaceWeather(prev => ({ ...prev, [r.id]: w }));
      }
    })();
    return () => { cancelled = true; };
  }, [races]);

  // Compact race-day weather line for a target card. Forecast → skycon icon +
  // range + feels-like; climate → range + feels-like + typical rain. Returns
  // null when no weather was resolved for this race.
  // ≥3h sessions get a temperature RANGE; shorter ones a single representative
  // temp. History races store no start time, so for a short past race we use
  // the day average in place of "start temp".
  const LONG_RACE_SEC = 3 * 3600;

  function renderRaceWeather(r) {
    const w = raceWeather[r.id];
    if (!w) return null;
    const isLong = Number(r.resultSeconds) >= LONG_RACE_SEC;
    const parts = [];
    if (w.kind === "forecast" && w.skycon) {
      const meta = skyconMeta(w.skycon, lang);
      if (meta?.icon) parts.push(meta.icon);
    }
    // History (archive): long race → min–max range; short → day average.
    // Target (forecast/climate): keep the existing min–max-or-avg behaviour.
    if (w.kind === "archive") {
      if (isLong && Number.isFinite(w.tempMinC) && Number.isFinite(w.tempMaxC)) {
        parts.push(`${w.tempMinC}–${w.tempMaxC}°C`);
      } else if (Number.isFinite(w.tempAvgC)) {
        parts.push(`${w.tempAvgC}°C`);
      } else if (Number.isFinite(w.tempMaxC)) {
        parts.push(`${w.tempMaxC}°C`);
      }
    } else if (Number.isFinite(w.tempMinC) && Number.isFinite(w.tempMaxC)) {
      parts.push(`${w.tempMinC}–${w.tempMaxC}°C`);
    } else if (Number.isFinite(w.tempAvgC)) {
      parts.push(`${w.tempAvgC}°C`);
    }
    const app = Number.isFinite(w.apparentAvgC) ? w.apparentAvgC : w.apparentMaxC;
    if (Number.isFinite(app)) parts.push(`${t("races.weather_feels")}${Math.round(app)}°C`);
    if ((w.kind === "climate" || w.kind === "archive") && Number.isFinite(w.precipMm) && w.precipMm >= 0.5) {
      parts.push(`${t("races.weather_rain")}${w.precipMm}mm`);
    }
    if (!parts.length) return null;
    const sourceLabel = w.kind === "forecast" ? t("races.weather_forecast")
      : w.kind === "archive" ? t("races.weather_actual")
      : t("races.weather_climate");
    return (
      <div style={{
        display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap",
        fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-2)",
        marginTop: 2,
      }}>
        <span style={{ color: "var(--ink-3)" }}>{sourceLabel}</span>
        <span>{parts.join(" ")}</span>
      </div>
    );
  }

  // Weather is revealed by TAPPING the race card (see the card's onClick), not
  // a dedicated chip — keeps the folded card as clean as an indoor race.

  // addingMode: null = no add form; "target" or "history" = the new race kind being added.
  // No more target/history TAB switching — both lists render on the same page.
  const [addingMode, setAddingMode] = useState(null);
  const [editingRaceId, setEditingRaceId] = useState(null);
  const [newRace, setNewRace] = useState(EMPTY_RACE(true));
  const [pastRaceWarning, setPastRaceWarning] = useState(null);
  const [raceSaving, setRaceSaving] = useState(false);
  // Independent category filters for the two lists. Empty array = show all;
  // otherwise show only races whose `category` is in the set. Uncategorized
  // races drop out of any filtered view by design — they reappear once the
  // user picks a category via the inline picker on the card.
  const [targetFilter, setTargetFilter] = useState([]);
  const [historyFilter, setHistoryFilter] = useState([]);
  const [selectedTargetFilter, setSelectedTargetFilter] = useState(targetFilter);
  const [selectedHistoryFilter, setSelectedHistoryFilter] = useState(historyFilter);
  const commitTargetFilter = useDeferredCommit(setTargetFilter);
  const commitHistoryFilter = useDeferredCommit(setHistoryFilter);
  // Mobile-only sub-navigation. Top tabs split PR (Personal Records bar)
  // from Races (the two lists). Inside Races, sub-tabs split Target vs
  // History — replacing the desktop's stacked sections. Defaults match the
  // user's primary use case: opening the Races bottom-nav tab lands on
  // upcoming target races.
  // mobileTopTab ("pr" | "races") + mobileSubTab ("target" | "history") are
  // now passed in from AppShell (lifted for cross-tab session memory).

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

  // "Enter result" for a target race that's reached race day: open the edit
  // form pre-flipped to HISTORY (isTarget:false) so the finish-time fields
  // appear. Saving runs commitRace(false), which moves it to the history list.
  function startEnterResult(race, e) {
    e?.stopPropagation();
    setAddingMode(null);
    setEditingRaceId(race.id);
    setNewRace({ ...raceToForm(race), isTarget: false });
  }

  function cancelEdit() {
    setEditingRaceId(null);
    setNewRace(EMPTY_RACE(true));
    setPastRaceWarning(null);
  }

  // Race long-press → Edit/Delete action modal. Single press timer (one touch
  // at a time); longPressFired suppresses the click that follows.
  const [actionRace, setActionRace] = useState(null);
  const pressTimer = useRef(null);
  const longPressFired = useRef(false);
  function outerPagerIsDragging() {
    return typeof document !== "undefined"
      && !!document.querySelector(".ultreia-mobile-shell[data-pager-touching='true']");
  }
  function startPress(r) {
    endPress();
    longPressFired.current = false;
    pressTimer.current = setTimeout(() => {
      pressTimer.current = null;
      if (outerPagerIsDragging()) return;
      longPressFired.current = true;
      setActionRace(r);
    }, 450);
  }
  function endPress() {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; }
  }

  // The edit form now opens as a blurred modal (was inline). Closing warns if
  // there are unsaved changes (dirty = current draft differs from the race).
  function isEditFormDirty() {
    if (!editingRaceId) return false;
    const original = races.find(r => r.id === editingRaceId);
    if (!original) return false;
    return JSON.stringify(newRace) !== JSON.stringify(raceToForm(original));
  }
  async function attemptCloseEdit() {
    if (!isEditFormDirty() || await appDialog.confirm(t("form.discard_confirm"))) cancelEdit();
  }

  // Add form is also a blurred modal now (was inline on the page). Same
  // dirty-guard so a tap on the backdrop doesn't silently drop a half-entered
  // race. "Dirty" = the draft has diverged from the pristine empty template.
  function isAddFormDirty() {
    if (!addingMode) return false;
    return JSON.stringify(newRace) !== JSON.stringify(EMPTY_RACE(addingMode === "target"));
  }
  async function attemptCloseAdd() {
    if (!isAddFormDirty() || await appDialog.confirm(t("form.discard_confirm"))) cancelAdd();
  }

  function deleteRace(id) {
    setConfirmDelete({ type: "race", id });
  }

  function updateRaceCategory(id, category) {
    updateRace(id, { category }).catch(() => {});
  }

  function updateDraftRaceCategory(category) {
    setNewRace((prev) => ({
      ...prev,
      category,
      subtype: category === prev.category ? prev.subtype : "",
    }));
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
    if (raceSaving) return;
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
    setRaceSaving(true);
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
    } finally {
      setRaceSaving(false);
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
  function changeTargetFilter(next) {
    setSelectedTargetFilter(next);
    commitTargetFilter(next);
  }
  function changeHistoryFilter(next) {
    setSelectedHistoryFilter(next);
    commitHistoryFilter(next);
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
          <div style={{ flex: 1, minWidth: 0 }}>
            <Dropdown
              ariaLabel={t("races.filter_label")}
              options={[{ value: "", label: t("races.filter_all") }, ...RACE_CATEGORIES.map(c => ({ value: c, label: t(`enum.race_cat.${c}`) }))]}
              value={value}
              onChange={(v) => setFilter(v ? [v] : [])}
            />
          </div>
        </div>
      );
    }
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10, alignItems: "center" }}>
        <span style={{ ...s.muted, fontSize: 11, marginRight: 2 }}>{t("races.filter_label")}</span>
        <button {...instantPress("race-filter-all", () => setFilter([]))}
          style={{ ...s.chip(filter.length === 0), padding: "4px 10px", fontSize: 12, touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}>
          {t("races.filter_all")}
        </button>
        {RACE_CATEGORIES.map(c => (
          <button key={c} {...instantPress(`race-filter-${c}`, () => toggleFilter(filter, setFilter, c))}
            style={{ ...s.chip(filter.includes(c)), padding: "4px 10px", fontSize: 12, touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}>
            {t(`enum.race_cat.${c}`)}
          </button>
        ))}
      </div>
    );
  }

  // Spartan tier ribbon — colored bg using the official tier palette so the
  // race card visually carries the same red/blue/green/black signal as the
  // event. Non-Spartan subtypes (none currently) fall back to the plain
  // outlined subTag style.
  function spartanTierStyle(tier) {
    const color = SPARTAN_TIER_COLOR[tier];
    if (!color) return s.subTag;
    return {
      ...s.subTag,
      background: `${color}26`,
      borderColor: color,
      color: "var(--ink-1)",
      fontWeight: 600,
      boxShadow: `0 0 16px ${color}22`,
    };
  }

  function renderCategoryTag(cat) {
    if (!cat) return null;
    const color = RACE_CATEGORY_COLOR[cat] || "#6b7469";
    return (
      <span style={{
        fontFamily: "var(--font-mono)",
        fontSize: 11, padding: "2px 8px", borderRadius: 4,
        background: `linear-gradient(180deg, ${color}33, ${color}1f)`,
        border: `1px solid ${color}`,
        color: "var(--ink-1)", fontWeight: 650, whiteSpace: "nowrap",
        textTransform: "uppercase", letterSpacing: "0.05em",
        boxShadow: `0 0 14px ${color}20`,
        flexShrink: 0,
      }}>{t(`enum.race_cat.${cat}`)}</span>
    );
  }

  // Countdown badge for an upcoming target race — "in 9w" / "还有 9 周". Only
  // for target races with a future (or today) date; returns null otherwise so
  // history rows and undated/past targets stay clean. Weeks once ≥7 days out,
  // days inside the final week — the periodization signal a runner actually
  // reads ("9 weeks → still base; 2 weeks → taper").
  function renderCountdown(r) {
    if (!r.isTarget || !r.date) return null;
    const days = daysUntilRace(r.date, now);
    if (days == null || days < 0) return null;
    let label;
    if (days === 0) label = t("races.countdown_today");
    else if (days < 7) label = t("races.countdown_days", { n: days });
    else if (days < 30) {
      // Under a month → weeks + days (the taper-window granularity).
      const w = Math.floor(days / 7), d = days % 7;
      label = d === 0 ? t("races.countdown_weeks", { n: w }) : t("races.countdown_weeks_days", { w, d });
    } else {
      // A month or more out → months + days (approx, 30-day months).
      const m = Math.floor(days / 30), d = days % 30;
      label = d === 0 ? t("races.countdown_months", { n: m }) : t("races.countdown_months_days", { m, d });
    }
    return (
      <span style={{
        fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600,
        color: "var(--moss-deep)", background: "var(--moss-bg)",
        border: "1px solid var(--moss)", borderRadius: 2,
        padding: "1px 6px", whiteSpace: "nowrap", letterSpacing: "0.02em",
      }}>{label}</span>
    );
  }

  // Render a single race card. Editing opens as a blurred modal (rendered once
  // at the bottom), not inline.
  function renderRaceCard(r) {
    const timeStr = [r.resultH, r.resultM, r.resultS].some(Boolean)
      ? `${r.resultH || "0"}:${String(r.resultM || "0").padStart(2, "0")}:${String(r.resultS || "0").padStart(2, "0")}`
      : "";
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
        {targetRacesAll.length > 0 && renderFilterChips(selectedTargetFilter, changeTargetFilter)}
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
        {historyRacesAll.length > 0 && renderFilterChips(selectedHistoryFilter, changeHistoryFilter)}
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
          <button
            {...instantPress(`races-add-${kind}`, () => startAdd(kind))}
            disabled={raceSaving}
            style={{
              ...(addingMode === kind ? s.btn : s.btnGhost),
              opacity: raceSaving ? 0.55 : 1,
              padding: "6px 10px", fontSize: 12, flexShrink: 0,
              maxWidth: "44%",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              touchAction: "manipulation",
              WebkitTapHighlightColor: "transparent",
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

  // Shared modals (long-press actions + the edit form). Rendered in both the
  // mobile and desktop returns; ModalRoot portals them out so placement is
  // just about being in the tree.
  const modals = (
    <>
      {actionRace && (
        <ItemActionModal
          title={`${actionRace.date || ""} ${actionRace.name || ""}`.trim() || undefined}
          onEdit={() => { const r = actionRace; setActionRace(null); startEdit(r); }}
          onDelete={() => { const r = actionRace; setActionRace(null); deleteRace(r.id); }}
          onClose={() => setActionRace(null)}
        />
      )}
      {editingRaceId && (
        <ModalRoot onClose={attemptCloseEdit}>
          <div onClick={attemptCloseEdit} className="ultreia-overlay-in" style={{
            position: "fixed", inset: 0, background: "rgba(20,20,19,0.45)",
            backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
            display: "flex", alignItems: "flex-start", justifyContent: "center",
            zIndex: 9999, padding: 16, overflowY: "auto", overscrollBehavior: "contain",
          }}>
            <div onClick={e => e.stopPropagation()} className="ultreia-modal-in" style={{ width: "100%", maxWidth: 640, margin: "16px 0" }}>
              {renderRaceForm("edit")}
            </div>
          </div>
        </ModalRoot>
      )}
      {addingMode && !editingRaceId && (
        <ModalRoot onClose={attemptCloseAdd}>
          <div onClick={attemptCloseAdd} className="ultreia-overlay-in" style={{
            position: "fixed", inset: 0, background: "rgba(20,20,19,0.45)",
            backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
            display: "flex", alignItems: "flex-start", justifyContent: "center",
            zIndex: 9999, padding: 16, overflowY: "auto", overscrollBehavior: "contain",
          }}>
            <div onClick={e => e.stopPropagation()} className="ultreia-modal-in" style={{ width: "100%", maxWidth: 640, margin: "16px 0" }}>
              {renderRaceForm("add")}
            </div>
          </div>
        </ModalRoot>
      )}
    </>
  );

  // ── Mobile layout ──────────────────────────────────────────────────────
  // Top tabs: Races (left, default) | PR (right). Inside Races, full-width
  // sub-tabs Target / History; the count lives in the sub-tab label so the
  // section header above the list goes away. Filter + Add share one row.
  if (isMobile) {
    const topTabMotionClass = topTabMotionDir
      ? (topTabMotionDir > 0 ? "ultreia-tab-in-right" : "ultreia-tab-in-left")
      : undefined;
    return (
      <div
        className="ultreia-no-motion-surface"
        data-mobile-inner-swipe="true"
        data-swipe-prev={selectedMobileTopTab === "pr" ? "true" : "false"}
        data-swipe-next={selectedMobileTopTab === "races" ? "true" : "false"}
        onTouchStart={onTopSwipeStart}
        onTouchMove={onTopSwipeMove}
        onTouchEnd={onTopSwipeEnd}
        style={{ minHeight: "100%" }}
      >
        {/* Sticky header: top tab strip + (Races sub-tab strip when active).
            Side margins bleed past main's 14px gutters. Negative `top`
            (matching main's padding) lifts the sticky's pinned position up
            past main's padding edge so when scrolled there's no gap above —
            position:sticky measures `top` from the padding edge, so a
            positive top:0 leaves a visible 14px slit; negative kills it. */}
        <div style={{
          position: "sticky",
          top: "calc(-1 * max(env(safe-area-inset-top), 14px))",
          zIndex: 10,
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
            const active = selectedMobileTopTab === tab.id;
            return (
              <button key={tab.id} {...instantPress(`races-top-${tab.id}`, () => changeMobileTopTab(tab.id))}
                style={{
                  flex: 1, background: "transparent", border: "none",
                  padding: "12px 8px",
                  fontSize: 14, fontWeight: active ? 600 : 500,
                  color: active ? "var(--ink-1)" : "var(--ink-3)",
                  borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
                  marginBottom: -1,
                  borderRadius: 0,
                  transition: "none",
                  touchAction: "manipulation",
                  WebkitTapHighlightColor: "transparent",
                }}>
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Sub-tab strip — sticks below the top tab strip when Races is active.
            Stays inside the sticky wrapper so both nav rows pin together. */}
        {selectedMobileTopTab === "races" && (
          <div style={{
            display: "flex",
            marginBottom: 12,
            border: "1px solid var(--rule)",
            borderRadius: 8,
            background: "var(--panel)",
            overflow: "hidden",
          }}>
            {[
              { id: "target",  label: t("races.section_target"),  count: targetRacesAll.length },
              { id: "history", label: t("races.section_history"), count: historyRacesAll.length },
            ].map((tab, i) => {
              const active = selectedMobileSubTab === tab.id;
              return (
                <button key={tab.id} {...instantPress(`races-sub-${tab.id}`, () => changeMobileSubTab(tab.id))}
                  style={{
                    flex: 1, minHeight: 36, padding: "8px 10px",
                    background: active ? "var(--accent-soft)" : "transparent",
                    color: active ? "var(--accent-dark)" : "var(--ink-2)",
                    border: "none",
                    borderRight: i === 0 ? "1px solid var(--rule)" : "none",
                    fontFamily: "var(--font-sans)", fontSize: 13,
                    fontWeight: active ? 600 : 500,
                    textAlign: "center",
                    cursor: "pointer", borderRadius: 0,
                    transition: "none",
                    touchAction: "manipulation",
                    WebkitTapHighlightColor: "transparent",
                  }}>
                  {tab.label} ({tab.count})
                </button>
              );
            })}
          </div>
        )}
        </div> {/* /sticky header */}

        <div key={selectedMobileTopTab} className={topTabMotionClass}>
          {selectedMobileTopTab === "pr" && (
            <PersonalRecordsBar races={races} itraPI={itraPI} setItraPI={setItraPI} />
          )}

          {selectedMobileTopTab === "races" && (
            <>
              {pastRaceWarning && (
                <div style={{ ...s.cardDark, marginBottom: 14, border: "1px solid var(--warn)", background: "var(--warn-soft)" }}>
                  <div style={{ ...s.section, color: "var(--warn)" }}>{t("races.past_warn_title")}</div>
                  <div style={{ fontSize: 13, color: "var(--ink-2)", marginBottom: 10 }}>{t("races.past_warn_body")}</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      onClick={() => commitRace(false)}
                      disabled={raceSaving}
                      aria-busy={raceSaving ? "true" : undefined}
                      style={{ ...s.btn, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, opacity: raceSaving ? 0.72 : 1 }}
                    >
                      {raceSaving && <Spinner size={13} thickness={1.6} color="currentColor" />}
                      {raceSaving ? t("common.saving") : t("races.past_warn_move")}
                    </button>
                    <button
                      {...instantPress("past-race-warning-cancel-mobile", () => setPastRaceWarning(null))}
                      disabled={raceSaving}
                      style={{ ...s.btnGhost, opacity: raceSaving ? 0.55 : 1, touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
                    >
                      {t("common.cancel")}
                    </button>
                  </div>
                </div>
              )}

              <div>
                {selectedMobileSubTab === "target" && renderMobileSection({
                  kind: "target",
                  list: targetRacesList,
                  all: targetRacesAll,
                  filter: targetFilter,
                  setFilter: setTargetFilter,
                  emptyMessage: targetRacesAll.length > 0 ? t("races.filter_empty") : t("races.empty_target"),
                })}
                {selectedMobileSubTab === "history" && renderMobileSection({
                  kind: "history",
                  list: historyRacesList,
                  all: historyRacesAll,
                  filter: historyFilter,
                  setFilter: setHistoryFilter,
                  emptyMessage: historyRacesAll.length > 0 ? t("races.filter_empty") : t("races.empty_history"),
                })}
              </div>
            </>
          )}
        </div>
        {modals}
      </div>
    );
  }

  // ── Desktop layout (unchanged): PR bar, both lists stacked ─────────────
  return (
    <div>
      {modals}
      <PersonalRecordsBar races={races} itraPI={itraPI} setItraPI={setItraPI} />

      <div style={{ marginBottom: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button
          {...instantPress("races-add-target-desktop", () => startAdd("target"))}
          disabled={raceSaving}
          style={{ ...(addingMode === "target" ? s.btn : s.btnGhost), opacity: raceSaving ? 0.55 : 1, touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
        >
          {t("races.add_target")}
        </button>
        <button
          {...instantPress("races-add-history-desktop", () => startAdd("history"))}
          disabled={raceSaving}
          style={{ ...(addingMode === "history" ? s.btn : s.btnGhost), opacity: raceSaving ? 0.55 : 1, touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
        >
          {t("races.add_history")}
        </button>
        <span style={{ ...s.muted, fontSize: 11 }}>{t("races.edit_hint")}</span>
      </div>

      {pastRaceWarning && (
        <div style={{ ...s.cardDark, marginBottom: 14, border: "1px solid var(--warn)", background: "var(--warn-soft)" }}>
          <div style={{ ...s.section, color: "var(--warn)" }}>{t("races.past_warn_title")}</div>
          <div style={{ fontSize: 13, color: "var(--ink-2)", marginBottom: 10 }}>{t("races.past_warn_body")}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={() => commitRace(false)}
              disabled={raceSaving}
              aria-busy={raceSaving ? "true" : undefined}
              style={{ ...s.btn, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, opacity: raceSaving ? 0.72 : 1 }}
            >
              {raceSaving && <Spinner size={13} thickness={1.6} color="currentColor" />}
              {raceSaving ? t("common.saving") : t("races.past_warn_move")}
            </button>
            <button
              {...instantPress("past-race-warning-cancel-desktop", () => setPastRaceWarning(null))}
              disabled={raceSaving}
              style={{ ...s.btnGhost, opacity: raceSaving ? 0.55 : 1, touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}

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
    const countdown = renderCountdown(r);

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
        <div key={r.id}
          onClick={() => {
            // Long-press (edit/delete) fires first and sets this flag — swallow
            // the click that follows so a hold doesn't also toggle weather.
            if (longPressFired.current) { longPressFired.current = false; return; }
            // Tap reveals the race-day weather (no dedicated chip — kept low-key
            // like indoor races that simply show nothing).
            if (raceWeather[r.id]) toggleWeather(r.id);
          }}
          onTouchStart={() => startPress(r)} onTouchEnd={endPress} onTouchMove={endPress} onTouchCancel={endPress}
          onMouseDown={() => startPress(r)} onMouseUp={endPress} onMouseLeave={endPress}
          style={{
            ...s.card, cursor: "pointer",
            display: "flex", flexDirection: "column",
            gap: 5, padding: "10px 14px",
            overflow: "hidden",
            touchAction: "manipulation",
          }}>
          {/* Row 1: priority · category · subtype · countdown.
              Edit/Delete moved to a long-press action modal (no inline ✕). */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0, flexWrap: "wrap" }}>
            {r.isTarget && r.priority && (
              <span style={{
                fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600,
                color: r.priority === "A" ? "var(--accent-ink)" : "var(--ink-1)",
                background: r.priority === "A" ? "linear-gradient(180deg, oklch(0.58 0.060 138), var(--accent))" : r.priority === "B" ? "var(--accent-soft)" : "transparent",
                border: "1px solid " + (r.priority === "A" ? "var(--accent)" : "var(--rule)"),
                padding: "2px 7px", flexShrink: 0,
              }}>▲ {r.priority}</span>
            )}
            {renderCategoryTag(r.category)}
            {r.subtype && (
              <span style={{ ...spartanTierStyle(r.subtype), flexShrink: 0 }}>{r.category === "Hyrox" ? t(`enum.hyrox.${r.subtype}`) : r.subtype}</span>
            )}
            {countdown}
            <div style={{ flex: 1, minWidth: 0 }} />
          </div>
          {/* Row 2: date + name (truncate) + time/ascent suffix (right-aligned) */}
          <div style={{ display: "flex", gap: 10, alignItems: "baseline", minWidth: 0 }}>
            <span style={{
              fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-3)",
              fontVariantNumeric: "tabular-nums", flexShrink: 0,
            }}>{r.date || "—"}</span>
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
            <span onClick={(e) => e.stopPropagation()} style={{ display: "inline-block", maxWidth: 170 }}>
              <Dropdown
                placeholder={t("races.set_category")}
                ariaLabel={t("races.set_category")}
                options={RACE_CATEGORIES.map(c => ({ value: c, label: t(`enum.race_cat.${c}`) }))}
                value=""
                onChange={(v) => updateRaceCategory(r.id, v)}
              />
            </span>
          )}
          {r.itraScore && <span style={{ ...s.subTag, fontSize: 10, alignSelf: "flex-start" }}>ITRA {r.itraScore}</span>}
          {weatherOpen[r.id] && renderRaceWeather(r)}
          {/* Race day reached → let the user enter a finish time, which moves
              this race from Target to History. */}
          {r.isTarget && daysUntilRace(r.date, now) !== null && daysUntilRace(r.date, now) <= 0 && (
            <button onClick={(e) => startEnterResult(r, e)}
              style={{ ...s.btn, alignSelf: "flex-start", fontSize: 12, padding: "6px 14px", minHeight: 0, marginTop: 2 }}>
              {t("races.enter_result")}
            </button>
          )}
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
        {/* date + (target only) countdown stacked underneath */}
        <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
          <span style={{
            fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--ink-3)",
            fontVariantNumeric: "tabular-nums",
          }}>{r.date || "—"}</span>
          {countdown && <span style={{ alignSelf: "flex-start" }}>{countdown}</span>}
        </div>

        {/* priority (target only — empty cell for history keeps the grid aligned) */}
        <div>
          {r.isTarget && r.priority && (
            <span style={{
              fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600,
              color: r.priority === "A" ? "var(--accent-ink)" : "var(--ink-1)",
              background: r.priority === "A" ? "linear-gradient(180deg, oklch(0.58 0.060 138), var(--accent))" : r.priority === "B" ? "var(--accent-soft)" : "transparent",
              border: "1px solid " + (r.priority === "A" ? "var(--accent)" : "var(--rule)"),
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
            <span onClick={(e) => e.stopPropagation()} style={{ display: "inline-block", maxWidth: 170 }}>
              <Dropdown
                placeholder={t("races.set_category")}
                ariaLabel={t("races.set_category")}
                options={RACE_CATEGORIES.map(c => ({ value: c, label: t(`enum.race_cat.${c}`) }))}
                value=""
                onChange={(v) => updateRaceCategory(r.id, v)}
              />
            </span>
          )}
          {r.subtype && <span style={spartanTierStyle(r.subtype)}>{r.category === "Hyrox" ? t(`enum.hyrox.${r.subtype}`) : r.subtype}</span>}
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
    const hyroxSubtypeOptions = getHyroxSubtypesForGender(profile?.gender, isEdit ? newRace.subtype : "");
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
                <button key={p} {...instantPress(`race-priority-${p}`, () => setNewRace({ ...newRace, priority: p }))}
                  style={{ ...s.chip(newRace.priority === p), touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}>{p}{t("races.priority_suffix")}</button>
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
                <Dropdown
                  placeholder={t("races.category_placeholder")}
                  ariaLabel={t("races.category_label")}
                  options={RACE_CATEGORIES.map(c => ({
                    value: c,
                    label: c === "Half Marathon" ? t("enum.race_cat.Half Marathon_short") : t(`enum.race_cat.${c}`),
                  }))}
                  value={newRace.category}
                  onChange={updateDraftRaceCategory}
                />
              </div>
            </div>
          </>
        ) : (
          /* Desktop unchanged: Category (200px) + Name (flex) on one row. */
          <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 10, marginBottom: 10 }}>
            <div>
              <div style={{ ...s.label, marginBottom: 6 }}>{t("races.category_label")}</div>
              <Dropdown
                placeholder={t("races.category_placeholder")}
                ariaLabel={t("races.category_label")}
                options={RACE_CATEGORIES.map(c => ({ value: c, label: t(`enum.race_cat.${c}`) }))}
                value={newRace.category}
                onChange={updateDraftRaceCategory}
              />
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
            place of distance/ascent for this category. Each tier chip wears
            its official Spartan brand color when selected so the form
            visually matches the event's bib / signage palette. */}
        {isSpartan && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ ...s.label, marginBottom: 6 }}>{t("races.spartan_tier")}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {SPARTAN_SUBTYPES.map(st => {
                const active = newRace.subtype === st;
                const tierColor = SPARTAN_TIER_COLOR[st];
                return (
                  <button key={st} type="button"
                    {...instantPress(`race-spartan-${st}`, () => setNewRace({ ...newRace, subtype: st }))}
                    style={{
                      ...s.chip(active),
                      touchAction: "manipulation",
                      WebkitTapHighlightColor: "transparent",
                      ...(active && tierColor ? {
                        background: `${tierColor}26`,
                        borderColor: tierColor,
                        color: "var(--ink-1)",
                        boxShadow: `0 0 18px ${tierColor}22`,
                      } : tierColor ? {
                        // Even when not picked, show a small color hint on the
                        // left so the user can map tier ↔ color at a glance.
                        boxShadow: `inset 4px 0 0 ${tierColor}`,
                        paddingLeft: 14,
                      } : {}),
                    }}>{t(`enum.spartan.${st}`)}</button>
                );
              })}
            </div>
          </div>
        )}

        {isHyrox && (
          <div style={{ marginBottom: 10, maxWidth: 260 }}>
            <div style={{ ...s.label, marginBottom: 6 }}>{t("races.hyrox_division")}</div>
            <Dropdown
              ariaLabel={t("races.hyrox_division")}
              placeholder="—"
              options={hyroxSubtypeOptions.map(st => ({ value: st, label: t(`enum.hyrox.${st}`) }))}
              value={newRace.subtype || ""}
              onChange={(v) => setNewRace({ ...newRace, subtype: v })}
            />
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

        {/* Race location — drives race-day weather. Outdoor races only;
            Hyrox is indoor so weather is irrelevant there. */}
        {newRace.category !== "Hyrox" && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ ...s.label, marginBottom: 6 }}>{t("races.location_label")}</div>
            <RaceLocationField
              name={newRace.locationName}
              lat={newRace.locationLat}
              lng={newRace.locationLng}
              onPick={(hit) => setNewRace(prev => ({ ...prev, locationName: hit.label, locationLat: hit.lat, locationLng: hit.lng }))}
              onText={(text) => setNewRace(prev => ({ ...prev, locationName: text, locationLat: null, locationLng: null }))}
              onClear={() => setNewRace(prev => ({ ...prev, locationName: "", locationLat: null, locationLng: null }))}
            />
          </div>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={tryAddRace}
            disabled={raceSaving}
            aria-busy={raceSaving ? "true" : undefined}
            style={{ ...s.btn, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, opacity: raceSaving ? 0.72 : 1 }}
          >
            {raceSaving && <Spinner size={13} thickness={1.6} color="currentColor" />}
            {raceSaving ? t("common.saving") : (isEdit ? t("common.save_changes") : t("common.save"))}
          </button>
          <button disabled={raceSaving} onClick={() => {
            if (isEdit) cancelEdit();
            else { cancelAdd(); }
          }} style={{ ...s.btnGhost, opacity: raceSaving ? 0.55 : 1 }}>{t("common.cancel")}</button>
        </div>
      </div>
    );
  }
}

// Free-text race location with forward geocoding. The user types a place name;
// after a short debounce we query Open-Meteo's geocoder and show matches. Picking
// one stores name + coords (coords are what weather needs). Editing the text
// after a pick clears the coords (they'd be stale) — re-pick to set them again.
function RaceLocationField({ name, lat, lng, onPick, onText, onClear }) {
  const t = useT();
  const { lang } = useLanguage();
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);

  // Debounced forward-geocode keyed off the parent's `name` (no duplicate local
  // text state — the input is controlled by the prop). Skips when coords are
  // already set so we don't re-search the picked label. All state writes happen
  // inside the timeout callback (not synchronously in the effect body).
  useEffect(() => {
    const q = (name || "").trim();
    const skip = !q || hasCoords;
    let cancelled = false;
    const id = setTimeout(async () => {
      if (skip) { if (!cancelled) { setResults([]); setOpen(false); } return; }
      setSearching(true);
      const hits = await forwardGeocode(q, lang);
      if (!cancelled) { setResults(hits); setOpen(hits.length > 0); setSearching(false); }
    }, skip ? 0 : 450);
    return () => { cancelled = true; clearTimeout(id); };
  }, [name, hasCoords, lang]);

  return (
    <div style={{ position: "relative" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          value={name || ""}
          placeholder={t("races.location_placeholder")}
          onChange={e => onText(e.target.value)}
          style={{ ...s.input, flex: 1 }}
        />
        {hasCoords && (
          <button type="button" onClick={() => { onClear(); setResults([]); setOpen(false); }}
            style={{ ...s.btnGhost, fontSize: 12, padding: "6px 10px", flexShrink: 0 }}>
            {t("races.location_clear")}
          </button>
        )}
      </div>
      <div style={{ ...s.muted, fontSize: 11, marginTop: 4 }}>
        {hasCoords ? `✓ ${t("races.location_set")}` : (searching ? "…" : t("races.location_hint"))}
      </div>
      {open && results.length > 0 && (
        <div style={{
          position: "absolute", top: 38, left: 0, right: 0, zIndex: 30,
          background: "var(--bg-elevated)", border: "1px solid var(--rule)",
          borderRadius: 4, marginTop: 2, maxHeight: 200, overflowY: "auto",
          boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
        }}>
          {results.map((r, i) => (
            <button key={i} type="button"
              onClick={() => { onPick(r); setResults([]); setOpen(false); }}
              style={{
                display: "block", width: "100%", textAlign: "left",
                background: "transparent", border: "none",
                borderBottom: i < results.length - 1 ? "1px solid var(--rule-soft)" : "none",
                padding: "9px 12px", fontSize: 13, color: "var(--ink-1)", cursor: "pointer",
              }}>
              {r.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
