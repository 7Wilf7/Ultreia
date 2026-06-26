import { useState } from "react";
import { s } from "../styles";
import { useT, useLanguage } from "../i18n/LanguageContext";
import { useIsMobile } from "../hooks/useMediaQuery";
import { getCurrentLocation, reverseGeocode, forwardGeocode, hasValidCoords } from "../lib/weather";
import { ModalRoot } from "./ModalRoot";
import { Spinner } from "./Spinner";

function cleanCoord(value, min, max) {
  if (value === "" || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : NaN;
}

function shortCandidateLabel(item) {
  return [item?.name, item?.admin1, item?.country]
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(", ");
}

export function LocationSettingsModal({ defaultLocation, setDefaultLocation, onClose }) {
  const t = useT();
  const { lang } = useLanguage();
  const isMobile = useIsMobile();
  const [name, setName] = useState(defaultLocation?.name || "");
  const [lng, setLng] = useState(defaultLocation?.lng != null ? String(defaultLocation.lng) : "");
  const [lat, setLat] = useState(defaultLocation?.lat != null ? String(defaultLocation.lat) : "");
  const [detecting, setDetecting] = useState(false);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [candidates, setCandidates] = useState([]);
  const hasCoords = hasValidCoords({ lng, lat });

  function applyCandidate(item) {
    if (!item) return;
    setName(shortCandidateLabel(item) || item.name || name);
    setLng(String(item.lng));
    setLat(String(item.lat));
    setCandidates([]);
    setError("");
  }

  async function detect() {
    setDetecting(true);
    setError("");
    setCandidates([]);
    try {
      const loc = await getCurrentLocation({ forceDevice: true, highAccuracy: true });
      setLng(String(loc.lng));
      setLat(String(loc.lat));
      const label = await reverseGeocode({ lng: loc.lng, lat: loc.lat, lang });
      if (label) setName(label);
    } catch {
      setError(t("location.error_no_permission"));
    } finally {
      setDetecting(false);
    }
  }

  async function searchPlace() {
    const q = name.trim();
    if (!q) return;
    setSearching(true);
    setError("");
    try {
      const hits = await forwardGeocode(q, lang);
      setCandidates(hits);
      if (!hits.length) setError(t("location.error_no_results"));
      else if (hits.length === 1) applyCandidate(hits[0]);
    } catch (err) {
      setError(t("location.error_generic", { msg: err?.message || String(err) }));
    } finally {
      setSearching(false);
    }
  }

  async function clearLocation() {
    setSaving(true);
    setError("");
    try {
      await setDefaultLocation?.({ name: "", lng: null, lat: null });
      onClose();
    } catch (err) {
      setError(t("location.error_save", { msg: err?.message || String(err) }));
    } finally {
      setSaving(false);
    }
  }

  async function save() {
    const nextLng = cleanCoord(lng, -180, 180);
    const nextLat = cleanCoord(lat, -90, 90);
    if (Number.isNaN(nextLng)) { setError(t("location.error_bad_lng")); return; }
    if (Number.isNaN(nextLat)) { setError(t("location.error_bad_lat")); return; }
    if (nextLng == null || nextLat == null) { setError(t("location.error_missing_coords")); return; }
    setSaving(true);
    setError("");
    try {
      await setDefaultLocation?.({
        name: name.trim(),
        lng: nextLng,
        lat: nextLat,
      });
      onClose();
    } catch (err) {
      setError(t("location.error_save", { msg: err?.message || String(err) }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalRoot onClose={onClose}>
      <div onClick={onClose} style={s.modalOverlay(isMobile, { float: true })}>
        <div onClick={e => e.stopPropagation()} style={s.modalCard(isMobile, { maxWidth: 520, float: true })}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 12 }}>
            <h2 style={{ fontSize: 19, fontWeight: 500, margin: 0 }}>{t("location.title")}</h2>
            <button onClick={onClose} style={s.modalCloseBtn} aria-label="Close">×</button>
          </div>
          <p style={{ ...s.muted, margin: "0 0 16px", lineHeight: 1.55, fontSize: 12 }}>
            {t("location.hint")}
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={s.label}>{t("location.name")}</span>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={name}
                  onChange={e => { setName(e.target.value); setCandidates([]); }}
                  placeholder={t("location.name_placeholder")}
                  style={{ ...s.input, flex: 1, minWidth: 0 }}
                />
                <button type="button" onClick={searchPlace} disabled={searching || !name.trim()} style={{
                  ...s.btnGhost,
                  flex: "0 0 auto",
                  minWidth: 72,
                  opacity: searching || !name.trim() ? 0.5 : 1,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                }}>
                  {searching && <Spinner size={11} thickness={1.4} />}
                  {t("location.search")}
                </button>
              </div>
            </label>

            {candidates.length > 1 && (
              <div style={{ border: "1px solid var(--rule)", borderRadius: 8, overflow: "hidden" }}>
                {candidates.map((item, idx) => (
                  <button
                    key={`${item.lat}:${item.lng}:${idx}`}
                    type="button"
                    onClick={() => applyCandidate(item)}
                    style={{
                      width: "100%",
                      border: "none",
                      borderBottom: idx < candidates.length - 1 ? "1px solid var(--rule-soft)" : "none",
                      background: "var(--bg-elevated)",
                      color: "var(--ink-1)",
                      textAlign: "left",
                      padding: "9px 11px",
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    {shortCandidateLabel(item) || item.name}
                  </button>
                ))}
              </div>
            )}

            <button type="button" onClick={detect} disabled={detecting} style={{
              ...s.btn,
              minHeight: 40,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 7,
              opacity: detecting ? 0.65 : 1,
            }}>
              {detecting && <Spinner size={12} thickness={1.5} />}
              {detecting ? t("location.detecting") : t("location.detect_button")}
            </button>

            <details style={{ border: "1px solid var(--rule)", borderRadius: 8, padding: "9px 11px", background: "var(--bg)" }}>
              <summary style={{ cursor: "pointer", color: "var(--ink-2)", fontSize: 12, fontWeight: 600 }}>
                {t("location.advanced")}
              </summary>
              <div style={{ ...s.muted, fontSize: 11, lineHeight: 1.5, margin: "9px 0" }}>
                {t("location.coords_hint")}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <input type="number" step="0.0001" value={lng} onChange={e => setLng(e.target.value)}
                  placeholder={t("location.lng")} style={s.input} />
                <input type="number" step="0.0001" value={lat} onChange={e => setLat(e.target.value)}
                  placeholder={t("location.lat")} style={s.input} />
              </div>
            </details>

            {hasCoords && (
              <div style={{ ...s.muted, fontSize: 11, lineHeight: 1.5 }}>
                {t("location.current_summary", { name: name.trim() || t("location.unnamed"), lng, lat })}
              </div>
            )}
            {error && (
              <div style={{ color: "var(--danger)", fontSize: 12, lineHeight: 1.5 }}>{error}</div>
            )}
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18, flexWrap: "wrap" }}>
            {hasCoords && (
              <button type="button" onClick={clearLocation} disabled={saving} style={{ ...s.btnGhost, marginRight: "auto", opacity: saving ? 0.6 : 1 }}>
                {t("location.clear")}
              </button>
            )}
            <button type="button" onClick={onClose} style={s.btnGhost}>{t("common.cancel")}</button>
            <button type="button" onClick={save} disabled={saving || !hasCoords} style={{ ...s.btn, opacity: saving || !hasCoords ? 0.5 : 1 }}>
              {saving ? t("common.saving") : t("common.save")}
            </button>
          </div>
        </div>
      </div>
    </ModalRoot>
  );
}
