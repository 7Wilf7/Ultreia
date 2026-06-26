import { useState } from "react";
import { s } from "../styles";
import { useT, useLanguage } from "../i18n/LanguageContext";
import { useIsMobile } from "../hooks/useMediaQuery";
import { getCurrentLocation, reverseGeocode, forwardGeocode, hasValidCoords } from "../lib/weather";
import { ModalRoot } from "./ModalRoot";
import { Spinner } from "./Spinner";
import { PinIcon } from "./Icons";

function cleanCoord(value, min, max) {
  if (value === "" || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : NaN;
}

function shortCandidateLabel(item) {
  return [item?.name, item?.admin2, item?.admin1, item?.country]
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(", ");
}

function fmtCoord(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(4) : "";
}

function LocationPreview({ hasCoords, name, lat, lng, t }) {
  if (!hasCoords) {
    return (
      <div style={{
        minHeight: 148,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--ink-3)",
        fontSize: 12,
        textAlign: "center",
        padding: 18,
        lineHeight: 1.5,
      }}>
        {t("location.map_empty")}
      </div>
    );
  }
  const title = (name || "").trim() || t("location.unnamed");
  return (
    <div
      role="img"
      aria-label={t("location.current_summary", { name: title, lng: fmtCoord(lng), lat: fmtCoord(lat) })}
      style={{
        minHeight: 168,
        position: "relative",
        overflow: "hidden",
        background: "linear-gradient(145deg, rgba(20,34,28,0.92), rgba(10,13,12,0.98))",
      }}
    >
      <div style={{
        position: "absolute",
        inset: 0,
        opacity: 0.26,
        backgroundImage: `
          linear-gradient(rgba(166, 183, 150, 0.22) 1px, transparent 1px),
          linear-gradient(90deg, rgba(166, 183, 150, 0.18) 1px, transparent 1px)
        `,
        backgroundSize: "26px 26px",
      }} />
      <div style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        width: 88,
        height: 88,
        transform: "translate(-50%, -50%)",
        borderRadius: "50%",
        border: "1px solid rgba(166,183,150,0.28)",
        boxShadow: "0 0 0 28px rgba(166,183,150,0.05)",
      }} />
      <div style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -58%)",
        width: 34,
        height: 34,
        borderRadius: 17,
        background: "var(--moss)",
        color: "var(--accent-ink)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 10px 28px rgba(58,91,67,0.45)",
      }}>
        <PinIcon size={17} />
      </div>
      <div style={{
        position: "absolute",
        left: 12,
        right: 12,
        bottom: 12,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: 12,
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{
            color: "var(--ink-1)",
            fontSize: 13,
            fontWeight: 650,
            lineHeight: 1.25,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {title}
          </div>
          <div style={{
            color: "var(--ink-3)",
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            marginTop: 4,
          }}>
            {fmtCoord(lat)}, {fmtCoord(lng)}
          </div>
        </div>
        <div style={{
          color: "var(--ink-3)",
          fontSize: 10.5,
          fontFamily: "var(--font-mono)",
          textTransform: "uppercase",
          letterSpacing: "0.02em",
          flexShrink: 0,
        }}>
          WGS84
        </div>
      </div>
    </div>
  );
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
            <div style={{
              position: "relative",
              border: "1px solid var(--rule)",
              borderRadius: 8,
              overflow: "hidden",
              background: "var(--bg)",
              minHeight: 148,
            }}>
              <LocationPreview hasCoords={hasCoords} name={name} lat={lat} lng={lng} t={t} />
              <button type="button" onClick={detect} disabled={detecting} title={t("location.detect_button")}
                aria-label={t("location.detect_button")}
                style={{
                  position: "absolute",
                  right: 10,
                  top: 10,
                  minWidth: 36,
                  minHeight: 36,
                  borderRadius: 8,
                  border: "1px solid var(--rule)",
                  background: "rgba(10, 15, 12, 0.82)",
                  color: "var(--ink-1)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  opacity: detecting ? 0.65 : 1,
                  backdropFilter: "blur(8px)",
                  WebkitBackdropFilter: "blur(8px)",
                }}>
                {detecting ? <Spinner size={13} thickness={1.5} /> : <PinIcon size={15} />}
              </button>
            </div>

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
                    <span style={{ display: "block", color: "var(--ink-1)", fontWeight: 600 }}>
                      {item.name || t("location.unnamed")}
                    </span>
                    <span style={{ display: "block", color: "var(--ink-3)", fontSize: 11, marginTop: 2 }}>
                      {item.regionLabel || shortCandidateLabel(item) || "—"} · {fmtCoord(item.lat)}, {fmtCoord(item.lng)}
                    </span>
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
                {t("location.current_summary", { name: name.trim() || t("location.unnamed"), lng: fmtCoord(lng), lat: fmtCoord(lat) })}
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
