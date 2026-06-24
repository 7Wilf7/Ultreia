import { useState } from "react";
import { s } from "../styles";
import {
  GENDERS, OCCUPATIONS, RUN_EXPERIENCE, RACE_TYPES_DONE,
  INJURY_HISTORY, EQUIPMENT_AVAILABLE, DEFAULT_PROFILE, HR_ZONE_METHODS,
} from "../constants";
import { calculateAge, isProfileComplete, computeHRZones } from "../utils/profile";
import { useT, useLanguage } from "../i18n/LanguageContext";
import { useIsMobile } from "../hooks/useMediaQuery";
import { getCurrentLocation, reverseGeocode } from "../lib/weather";
import { ModalRoot } from "./ModalRoot";
import { Dropdown } from "./Dropdown";
import { useAppDialog } from "./AppDialogContext";

// `defaultLocation` / `setDefaultLocation` are the weather coordinates (stored
// in user_settings). Location now lives ONLY here in the profile: the address
// text is profile.city (feeds the AI prompt) and the coords feed weather. The
// old standalone Settings → Default location entry was removed.
export function ProfileEditor({ profile, setProfile, onClose, mode = "edit", defaultLocation, setDefaultLocation }) {
  const t = useT();
  const appDialog = useAppDialog();
  const { lang } = useLanguage();
  const isMobile = useIsMobile();
  // Backfill any missing fields with defaults so the form is robust against older saved data
  const [draft, setDraft] = useState({ ...DEFAULT_PROFILE, ...(profile || {}) });
  // Local coordinate draft (weather fallback). Saved alongside the profile.
  const [locDraft, setLocDraft] = useState({
    lng: defaultLocation?.lng != null ? String(defaultLocation.lng) : "",
    lat: defaultLocation?.lat != null ? String(defaultLocation.lat) : "",
  });
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState("");
  const age = calculateAge(draft.birthDate);
  const complete = isProfileComplete(draft);

  // Snapshot the initial form state once (lazy init — never updated) so we can
  // detect unsaved edits when the user tries to leave.
  const [initialSnapshot] = useState(() => JSON.stringify({
    draft: { ...DEFAULT_PROFILE, ...(profile || {}) },
    loc: {
      lng: defaultLocation?.lng != null ? String(defaultLocation.lng) : "",
      lat: defaultLocation?.lat != null ? String(defaultLocation.lat) : "",
    },
  }));
  const isDirty = () => JSON.stringify({ draft, loc: locDraft }) !== initialSnapshot;

  // Guard close attempts (overlay click / X / Android back). Save() bypasses
  // this and calls onClose directly. Setup mode can't be dismissed at all.
  async function attemptClose() {
    if (!isDirty() || await appDialog.confirm(t("form.discard_confirm"))) onClose();
  }

  // GPS → coords → reverse-geocode → fill the address text. One tap, no typing.
  async function detectLocation() {
    setLocating(true);
    setLocError("");
    try {
      const loc = await getCurrentLocation({ forceDevice: true }); // explicit GPS opt-in
      setLocDraft({ lng: String(loc.lng), lat: String(loc.lat) });
      const addr = await reverseGeocode({ lng: loc.lng, lat: loc.lat, lang });
      if (addr) setDraft(d => ({ ...d, city: addr }));
    } catch {
      setLocError(t("profile.loc_error"));
    }
    setLocating(false);
  }

  function save() {
    setProfile(draft);
    // Persist the weather coordinates too (best-effort; profile is the source
    // of truth for the address label). Empty coords clear the fallback.
    if (setDefaultLocation) {
      const lng = locDraft.lng === "" ? null : Number(locDraft.lng);
      const lat = locDraft.lat === "" ? null : Number(locDraft.lat);
      setDefaultLocation({
        lng: Number.isFinite(lng) ? lng : null,
        lat: Number.isFinite(lat) ? lat : null,
        name: (draft.city || "").trim(),
      });
    }
    onClose();
  }

  return (
    <ModalRoot onClose={mode === "setup" ? undefined : attemptClose}>
    <div onClick={mode === "setup" ? undefined : attemptClose}
      style={s.modalOverlay(isMobile, { float: true })}>
      <div onClick={e => e.stopPropagation()}
        style={s.modalCard(isMobile, { maxWidth: 680, float: true })}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
          <h2 style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>
            {mode === "setup" ? t("profile.title_setup") : t("profile.title_edit")}
          </h2>
          {mode === "edit" && (
            <button onClick={attemptClose} style={s.modalCloseBtn} aria-label="Close">×</button>
          )}
        </div>
        <p style={{ ...s.muted, marginBottom: 18, lineHeight: 1.5 }}>
          {mode === "setup" ? t("profile.desc_setup") : t("profile.desc_edit")}
        </p>

        {/* Display name — shown first, required */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ ...s.label, marginBottom: 4 }}>
            {t("profile.display_name")} <span style={{ color: "var(--danger)" }}>*</span>
            <span style={{ ...s.muted, marginLeft: 6 }}>{t("profile.display_name_hint")}</span>
          </div>
          <input type="text" value={draft.displayName}
            placeholder={t("profile.display_name_placeholder")}
            onChange={e => setDraft({ ...draft, displayName: e.target.value })}
            style={{ ...s.input, maxWidth: 320 }} />
        </div>

        {/* Birth date */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ ...s.label, marginBottom: 4 }}>
            {t("profile.birth_date")} <span style={{ color: "var(--danger)" }}>*</span>
            {age != null && <span style={{ color: "var(--ink-3)", marginLeft: 8 }}>{t("profile.age_suffix", { age })}</span>}
          </div>
          <input type="date" value={draft.birthDate}
            onChange={e => setDraft({ ...draft, birthDate: e.target.value })}
            style={{ ...s.input, maxWidth: 200 }} />
        </div>

        {/* Gender */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ ...s.label, marginBottom: 6 }}>
            {t("profile.gender")} <span style={{ color: "var(--danger)" }}>*</span>
          </div>
          <div style={{ maxWidth: 200 }}>
            <Dropdown
              ariaLabel={t("profile.gender")}
              options={[{ value: "", label: "—" }, ...GENDERS.map(g => ({ value: g.id, label: t(`enum.gender.${g.id}`) }))]}
              value={draft.gender || ""}
              onChange={v => setDraft({ ...draft, gender: v })}
            />
          </div>
        </div>

        {/* Location — address text (feeds the AI prompt) + GPS auto-fill +
            optional manual coordinates (weather fallback). The single source
            of location truth; the old Settings → Default location is gone. */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ ...s.label, marginBottom: 4 }}>
            {t("profile.city")} <span style={{ color: "var(--danger)" }}>*</span>
            <span style={{ ...s.muted, marginLeft: 6 }}>{t("profile.city_hint")}</span>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input type="text" value={draft.city} placeholder={t("profile.city_placeholder")}
              onChange={e => setDraft({ ...draft, city: e.target.value })}
              style={{ ...s.input, maxWidth: 280, flex: "1 1 200px" }} />
            <button type="button" onClick={detectLocation} disabled={locating}
              style={{ ...s.btnGhost, fontSize: 12, padding: "8px 12px", whiteSpace: "nowrap", opacity: locating ? 0.5 : 1 }}>
              {locating ? t("profile.loc_detecting") : t("profile.loc_detect")}
            </button>
          </div>
          <div style={{ ...s.muted, fontSize: 11, marginTop: 6, lineHeight: 1.5 }}>{t("profile.loc_detect_hint")}</div>
          {locError && (
            <div style={{ color: "var(--danger)", fontSize: 11, marginTop: 6, lineHeight: 1.5 }}>{locError}</div>
          )}

          {/* Manual coordinates — fallback for when GPS is denied/unavailable
              (e.g. a desktop). Optional; the address text above is what the
              coach sees. */}
          <div style={{ ...s.muted, fontSize: 11, marginTop: 12, marginBottom: 6 }}>{t("profile.loc_manual")}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, maxWidth: 280 }}>
            <input type="number" step="0.0001" value={locDraft.lng}
              onChange={e => setLocDraft({ ...locDraft, lng: e.target.value })}
              placeholder={t("profile.loc_lng")} style={s.input} />
            <input type="number" step="0.0001" value={locDraft.lat}
              onChange={e => setLocDraft({ ...locDraft, lat: e.target.value })}
              placeholder={t("profile.loc_lat")} style={s.input} />
          </div>
        </div>

        {/* Occupation (with Other free-text) */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ ...s.label, marginBottom: 6 }}>{t("profile.day_job")}</div>
          <div style={{ maxWidth: 260 }}>
            <Dropdown
              ariaLabel={t("profile.day_job")}
              options={[{ value: "", label: "—" }, ...OCCUPATIONS.map(o => ({ value: o.id, label: t(`enum.occ.${o.id}`) }))]}
              value={draft.occupation || ""}
              onChange={v => setDraft({ ...draft, occupation: v })}
            />
          </div>
          {draft.occupation === "other" && (
            <input type="text"
              placeholder={t("profile.occupation_other_placeholder")}
              value={draft.occupationOther}
              onChange={e => setDraft({ ...draft, occupationOther: e.target.value })}
              style={{ ...s.input, marginTop: 8, maxWidth: 360 }} />
          )}
        </div>

        {/* Years of training */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ ...s.label, marginBottom: 6 }}>
            {t("profile.years_training")} <span style={{ color: "var(--danger)" }}>*</span>
            <span style={{ ...s.muted, marginLeft: 6 }}>{t("profile.years_training_hint")}</span>
          </div>
          <div style={{ maxWidth: 260 }}>
            <Dropdown
              ariaLabel={t("profile.years_training")}
              options={[{ value: "", label: "—" }, ...RUN_EXPERIENCE.map(o => ({ value: o.id, label: t(`enum.exp.${o.id}`) }))]}
              value={draft.experience || ""}
              onChange={v => setDraft({ ...draft, experience: v })}
            />
          </div>
        </div>

        {/* Race types done */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ ...s.label, marginBottom: 6 }}>{t("profile.race_types_done")}</div>
          <Dropdown
            multi
            ariaLabel={t("profile.race_types_done")}
            options={RACE_TYPES_DONE.map(o => ({ value: o.id, label: t(`enum.race_done.${o.id}`) }))}
            value={draft.raceTypes || []}
            onChange={arr => setDraft({ ...draft, raceTypes: arr })}
          />
        </div>

        {/* Recent injuries */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ ...s.label, marginBottom: 6 }}>
            {t("profile.recent_injuries")}
            <span style={{ ...s.muted, marginLeft: 6 }}>{t("profile.recent_injuries_note")}</span>
          </div>
          <Dropdown
            multi
            ariaLabel={t("profile.recent_injuries")}
            options={INJURY_HISTORY.map(o => ({ value: o.id, label: t(`enum.injury.${o.id}`) }))}
            value={draft.recentInjuries || []}
            onChange={arr => setDraft({ ...draft, recentInjuries: arr })}
          />
        </div>
        <div style={{ marginBottom: 14 }}>
          <div style={{ ...s.muted, marginBottom: 4 }}>{t("profile.injury_older_label")}</div>
          <textarea rows={2}
            placeholder={t("profile.injury_older_placeholder")}
            value={draft.injuriesNote}
            onChange={e => setDraft({ ...draft, injuriesNote: e.target.value })}
            style={{
              ...s.input,
              resize: "vertical",
              fontSize: 12,
              lineHeight: 1.35,
              "--mobile-input-fs": "13px",
            }} />
        </div>

        {/* Equipment */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ ...s.label, marginBottom: 6 }}>{t("profile.equipment")}</div>
          <Dropdown
            multi
            ariaLabel={t("profile.equipment")}
            options={EQUIPMENT_AVAILABLE.map(o => ({ value: o.id, label: t(`enum.equip.${o.id}`) }))}
            value={draft.equipment || []}
            onChange={arr => setDraft({ ...draft, equipment: arr })}
          />
          <input type="text"
            placeholder={t("profile.equipment_other_placeholder")}
            value={draft.equipmentOther}
            onChange={e => setDraft({ ...draft, equipmentOther: e.target.value })}
            style={{ ...s.input, marginTop: 8 }} />
        </div>

        {/* Heart Rate (optional, but unlocks Karvonen-based zone advice from AI Coach) */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ ...s.label, marginBottom: 6 }}>{t("profile.heart_rate")}</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 8 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, color: "var(--ink-2)" }}>{t("profile.resting_hr")} <span style={{ color: "var(--ink-3)" }}>(bpm)</span></span>
              <input type="number" placeholder="55" value={draft.restingHR}
                onChange={e => setDraft({ ...draft, restingHR: e.target.value })}
                style={{ ...s.input, width: 100 }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, color: "var(--ink-2)" }}>{t("profile.max_hr")} <span style={{ color: "var(--ink-3)" }}>(bpm)</span></span>
              <input type="number" placeholder="190" value={draft.maxHR}
                onChange={e => setDraft({ ...draft, maxHR: e.target.value })}
                style={{ ...s.input, width: 100 }} />
            </label>
          </div>
          <div style={{ ...s.label, marginBottom: 6, fontSize: 12 }}>{t("profile.hr_zone_method")}</div>
          <div style={{ maxWidth: 260, marginBottom: 8 }}>
            <Dropdown
              ariaLabel={t("profile.hr_zone_method")}
              options={HR_ZONE_METHODS.map(m => ({ value: m.id, label: m.label }))}
              value={draft.hrZoneMethod || HR_ZONE_METHODS[0].id}
              onChange={v => setDraft({ ...draft, hrZoneMethod: v })}
            />
          </div>
          {(() => {
            const zones = computeHRZones(draft.restingHR, draft.maxHR, draft.hrZoneMethod);
            if (!zones) {
              return (draft.restingHR || draft.maxHR)
                ? <div style={{ ...s.muted, fontSize: 11 }}>{t("profile.hr_zone_need_both")}</div>
                : null;
            }
            return (
              <div style={{ background: "var(--panel-2)", border: "1px solid var(--rule)", borderRadius: 8, padding: "8px 12px", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-2)", lineHeight: 1.8 }}>
                <div style={{ marginBottom: 4, fontFamily: "var(--font-sans)", color: "var(--ink-1)" }}>{t("profile.hr_zone_preview")}</div>
                {zones.map(z => (
                  <div key={z.id}>{z.id}: {z.low}–{z.high} bpm</div>
                ))}
              </div>
            );
          })()}
        </div>

        {/* Notes */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ ...s.label, marginBottom: 4 }}>{t("profile.notes")}</div>
          <textarea rows={3} value={draft.notes}
            placeholder={t("profile.notes_placeholder")}
            onChange={e => setDraft({ ...draft, notes: e.target.value })}
            style={{ ...s.input, resize: "vertical" }} />
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
          {!complete && (
            <span style={{ ...s.muted, color: "var(--danger)", marginRight: "auto", fontSize: 12 }}>
              {t("common.required")}
            </span>
          )}
          {mode === "edit" && (
            <button onClick={attemptClose} style={s.btnGhost}>{t("common.cancel")}</button>
          )}
          <button onClick={save} disabled={!complete}
            style={{ ...s.btn, opacity: complete ? 1 : 0.5 }}>
            {mode === "setup" ? t("profile.get_started") : t("common.save")}
          </button>
        </div>
      </div>
    </div>
    </ModalRoot>
  );
}

// Read-only profile preview — opens FIRST when the user taps their profile.
// Shows only the fields they've actually filled (no empty/optional clutter),
// with a close button (top-right) and an edit button (top-left) that hands off
// to the full ProfileEditor. Keeps the common "just check my info" path from
// dropping the user straight into a long form.
export function ProfilePreview({ profile, defaultLocation, onClose, onEdit }) {
  const t = useT();
  const isMobile = useIsMobile();
  const p = profile || {};
  const age = calculateAge(p.birthDate);

  const rows = [];
  const add = (label, val) => {
    if (val == null) return;
    if (Array.isArray(val)) { if (val.length) rows.push([label, val.join(" · ")]); return; }
    const s2 = String(val).trim();
    if (s2) rows.push([label, s2]);
  };
  add(t("profile.display_name"), p.displayName);
  if (age != null) add(t("profile.age_label"), String(age));
  if (p.gender) add(t("profile.gender"), t(`enum.gender.${p.gender}`));
  add(t("profile.city"), p.city);
  if (p.occupation) {
    add(t("profile.day_job"), p.occupation === "other" ? (p.occupationOther || t("enum.occ.other")) : t(`enum.occ.${p.occupation}`));
  }
  if (p.experience) add(t("profile.years_training"), t(`enum.exp.${p.experience}`));
  if (p.raceTypes?.length) add(t("profile.race_types_done"), p.raceTypes.map(id => t(`enum.race_done.${id}`)));
  {
    const inj = [];
    if (p.recentInjuries?.length) inj.push(p.recentInjuries.map(id => t(`enum.injury.${id}`)).join(" · "));
    if (p.injuriesNote?.trim()) inj.push(p.injuriesNote.trim());
    if (inj.length) add(t("profile.recent_injuries"), inj.join(" · "));
  }
  {
    const eq = [];
    if (p.equipment?.length) eq.push(p.equipment.map(id => t(`enum.equip.${id}`)).join(" · "));
    if (p.equipmentOther?.trim()) eq.push(p.equipmentOther.trim());
    if (eq.length) add(t("profile.equipment"), eq.join(" · "));
  }
  if (p.restingHR || p.maxHR) {
    const hr = [];
    if (p.restingHR) hr.push(`${t("profile.resting_hr")} ${p.restingHR}`);
    if (p.maxHR) hr.push(`${t("profile.max_hr")} ${p.maxHR}`);
    add(t("profile.heart_rate"), hr.join(" · "));
  }
  if (defaultLocation?.lat != null && defaultLocation?.lng != null && !p.city) {
    add(t("profile.loc_manual"), `${defaultLocation.lat}, ${defaultLocation.lng}`);
  }
  if (p.notes?.trim()) add(t("profile.notes"), p.notes.trim());

  return (
    <ModalRoot onClose={onClose}>
      <div onClick={onClose} style={s.modalOverlay(isMobile, { float: true })}>
        <div onClick={e => e.stopPropagation()}
          style={s.modalCard(isMobile, { maxWidth: 480, float: true })}>
          {/* Header: edit (left) · title · close (right) */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <button onClick={onEdit} style={{ ...s.btnGhost, fontSize: 13, padding: "6px 12px" }}>
              {t("profile.edit")}
            </button>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, color: "var(--ink-1)" }}>
              {t("settings.profile")}
            </h2>
            <button onClick={onClose} style={s.modalCloseBtn} aria-label="Close">×</button>
          </div>

          {rows.length === 0 ? (
            <div style={{ ...s.muted, lineHeight: 1.6, padding: "8px 0 16px" }}>
              {t("profile.preview_empty")}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {rows.map(([label, val], i) => (
                <div key={i} style={{
                  display: "flex", gap: 12, padding: "10px 0",
                  borderBottom: i < rows.length - 1 ? "1px solid var(--rule-soft)" : "none",
                }}>
                  <div style={{ ...s.label, margin: 0, flex: "0 0 38%", minWidth: 0 }}>{label}</div>
                  <div style={{ fontSize: 14, color: "var(--ink-1)", flex: 1, minWidth: 0, lineHeight: 1.5, wordBreak: "break-word" }}>{val}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </ModalRoot>
  );
}
