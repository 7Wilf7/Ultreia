import { useState } from "react";
import { s } from "../styles";
import { useT } from "../i18n/LanguageContext";
import { hasValidCoords } from "../lib/weather";
import { ModalRoot } from "./ModalRoot";
import { Spinner } from "./Spinner";
import { CheckSquareIcon, PinIcon, PlusIcon } from "./Icons";
import { LocationMapPreview, MapPickerModal } from "./MapPickerModal";
import { useAppDialog } from "./AppDialogContext";
import { useInstantPress } from "../hooks/useInstantPress";

function fmtCoord(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(5) : "";
}

function placeTitle(place, t) {
  return String(place?.name || place?.address || "").trim() || t("location.unnamed");
}

function sortLocations(locations = []) {
  return [...locations].sort((a, b) => {
    if (!!a.isDefaultWeather !== !!b.isDefaultWeather) return a.isDefaultWeather ? -1 : 1;
    const sortA = Number(a.sortOrder || 0);
    const sortB = Number(b.sortOrder || 0);
    if (sortA !== sortB) return sortA - sortB;
    return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
  });
}

export function LocationSettingsModal({
  defaultLocation,
  locations = [],
  onCreateLocation,
  onSetDefaultLocation,
  onDeleteLocation,
  onClose,
}) {
  const t = useT();
  const appDialog = useAppDialog();
  const instantPress = useInstantPress();
  const sortedLocations = sortLocations(locations);
  const defaultSaved = sortedLocations.find(l => l.isDefaultWeather) || null;
  const previewLocation = defaultSaved || (hasValidCoords(defaultLocation) ? defaultLocation : null) || sortedLocations[0] || null;
  const [mapOpen, setMapOpen] = useState(false);
  const [draft, setDraft] = useState(null);
  const [draftName, setDraftName] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  function onMapConfirm(point) {
    setMapOpen(false);
    setDraft(point);
    setDraftName("");
    setError("");
  }

  async function saveDraft() {
    if (!draft || !hasValidCoords(draft)) return;
    const name = draftName.trim();
    if (!name) {
      setError(t("location.error_missing_name"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onCreateLocation?.({
        name,
        address: draft.address || "",
        lat: Number(draft.lat),
        lng: Number(draft.lng),
        source: "map_pick",
        isDefaultWeather: sortedLocations.length === 0,
      });
      setDraft(null);
      setDraftName("");
    } catch (err) {
      setError(t("location.error_save", { msg: err?.message || String(err) }));
    } finally {
      setSaving(false);
    }
  }

  async function setDefault(place) {
    if (!place?.id || place.isDefaultWeather) return;
    setBusyId(place.id);
    setError("");
    try {
      await onSetDefaultLocation?.(place.id);
    } catch (err) {
      setError(t("location.error_save", { msg: err?.message || String(err) }));
    } finally {
      setBusyId("");
    }
  }

  async function deletePlace(place) {
    if (!place?.id) return;
    const ok = await appDialog.confirm(t("location.delete_confirm", { name: placeTitle(place, t) }), {
      danger: true,
      confirmLabel: t("common.delete"),
    });
    if (!ok) return;
    setBusyId(place.id);
    setError("");
    try {
      await onDeleteLocation?.(place.id);
    } catch (err) {
      setError(t("location.error_save", { msg: err?.message || String(err) }));
    } finally {
      setBusyId("");
    }
  }

  return (
    <ModalRoot onClose={onClose}>
      <div style={{
        position: "fixed",
        inset: 0,
        zIndex: 10010,
        background: "var(--bg)",
        color: "var(--ink-1)",
        overflowY: "auto",
        WebkitOverflowScrolling: "touch",
        overscrollBehavior: "contain",
        fontFamily: "var(--font-sans)",
      }}>
        <div style={{
          padding: "calc(env(safe-area-inset-top) + 12px) 14px 10px",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          borderBottom: "1px solid var(--rule)",
          background: "var(--bg)",
        }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: 19, fontWeight: 650, margin: 0 }}>{t("location.title")}</h2>
            <p style={{ ...s.muted, margin: "4px 0 0", lineHeight: 1.45, fontSize: 12 }}>
              {t("location.hint")}
            </p>
          </div>
          <button onClick={onClose} style={s.modalCloseBtn} aria-label="Close">×</button>
        </div>

        <div style={{
          padding: "14px 14px calc(env(safe-area-inset-bottom) + 18px)",
        }}>
          <div style={{
            width: "100%",
            maxWidth: 720,
            margin: "0 auto",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}>
            <LocationMapPreview
              location={previewLocation}
              onOpen={() => setMapOpen(true)}
            />

            <button type="button" {...instantPress("location-open-map", () => setMapOpen(true))} style={{
              ...s.btn,
              minHeight: 40,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 7,
              touchAction: "manipulation",
              WebkitTapHighlightColor: "transparent",
            }}>
              <PlusIcon size={14} />
              {t("location.add_from_map")}
            </button>

            {draft && (
              <div style={{
                border: "1px solid var(--rule)",
                borderRadius: 8,
                background: "var(--bg-elevated)",
                padding: 12,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <span style={{ color: "var(--moss)" }}><PinIcon size={15} /></span>
                  <div style={{ fontSize: 13, fontWeight: 650 }}>{t("location.draft_title")}</div>
                </div>
                <div style={{
                  color: "var(--ink-2)",
                  fontSize: 12,
                  lineHeight: 1.45,
                  marginBottom: 10,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}>
                  {draft.address || t("location.map_address_unknown")}
                </div>
                <div style={{
                  color: "var(--ink-3)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  marginBottom: 10,
                  fontVariantNumeric: "tabular-nums",
                }}>
                  {fmtCoord(draft.lat)}, {fmtCoord(draft.lng)}
                </div>
                <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <span style={s.label}>{t("location.name")}</span>
                  <input
                    value={draftName}
                    onChange={e => setDraftName(e.target.value)}
                    placeholder={t("location.name_placeholder")}
                    style={s.input}
                    autoFocus
                  />
                </label>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
                  <button type="button" onClick={() => { setDraft(null); setDraftName(""); }} disabled={saving} style={s.btnGhost}>
                    {t("common.cancel")}
                  </button>
                  <button type="button" onClick={saveDraft} disabled={saving} style={{
                    ...s.btn,
                    minHeight: 36,
                    minWidth: 82,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 7,
                    opacity: saving ? 0.65 : 1,
                  }}>
                    {saving && <Spinner size={12} thickness={1.5} />}
                    {saving ? t("common.saving") : t("location.save_place")}
                  </button>
                </div>
              </div>
            )}

            <div>
              <div style={{ ...s.label, marginBottom: 8 }}>{t("location.list_title")}</div>
              {sortedLocations.length === 0 ? (
                <div style={{
                  border: "1px solid var(--rule)",
                  borderRadius: 8,
                  background: "var(--bg)",
                  color: "var(--ink-3)",
                  fontSize: 12,
                  lineHeight: 1.5,
                  padding: 12,
                }}>
                  {t("location.list_empty")}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {sortedLocations.map(place => {
                    const isBusy = busyId === place.id;
                    return (
                      <div key={place.id} style={{
                        border: `1px solid ${place.isDefaultWeather ? "var(--moss)" : "var(--rule)"}`,
                        borderRadius: 8,
                        background: place.isDefaultWeather ? "var(--moss-bg)" : "var(--bg)",
                        padding: 11,
                      }}>
                        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                              <div style={{
                                fontSize: 13,
                                fontWeight: 650,
                                color: "var(--ink-1)",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                maxWidth: 260,
                              }}>
                                {placeTitle(place, t)}
                              </div>
                              {place.isDefaultWeather && (
                                <span style={{
                                  border: "1px solid var(--moss)",
                                  color: "var(--moss-deep)",
                                  background: "rgba(91, 132, 93, 0.14)",
                                  borderRadius: 999,
                                  padding: "2px 7px",
                                  fontSize: 10.5,
                                  fontWeight: 650,
                                }}>
                                  {t("location.default_badge")}
                                </span>
                              )}
                            </div>
                            {place.address && (
                              <div style={{
                                color: "var(--ink-3)",
                                fontSize: 11.5,
                                lineHeight: 1.45,
                                marginTop: 5,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}>
                                {place.address}
                              </div>
                            )}
                            <div style={{
                              color: "var(--ink-3)",
                              fontFamily: "var(--font-mono)",
                              fontSize: 10.5,
                              marginTop: 5,
                              fontVariantNumeric: "tabular-nums",
                            }}>
                              {fmtCoord(place.lat)}, {fmtCoord(place.lng)}
                            </div>
                          </div>
                          {isBusy && <Spinner size={14} thickness={1.5} />}
                        </div>
                        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                          <button
                            type="button"
                            onClick={() => setDefault(place)}
                            disabled={place.isDefaultWeather || isBusy}
                            style={{
                              ...s.btnGhost,
                              minHeight: 0,
                              padding: "6px 10px",
                              fontSize: 12,
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              opacity: place.isDefaultWeather || isBusy ? 0.55 : 1,
                            }}
                          >
                            <CheckSquareIcon size={13} />
                            {place.isDefaultWeather ? t("location.default_selected") : t("location.set_default")}
                          </button>
                          <button
                            type="button"
                            onClick={() => deletePlace(place)}
                            disabled={isBusy}
                            style={{
                              ...s.btnGhost,
                              minHeight: 0,
                              padding: "6px 10px",
                              fontSize: 12,
                              opacity: isBusy ? 0.55 : 1,
                            }}
                          >
                            {t("location.delete")}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {error && (
              <div style={{ color: "var(--danger)", fontSize: 12, lineHeight: 1.5 }}>{error}</div>
            )}
          </div>
        </div>

        {mapOpen && (
          <MapPickerModal
            initialLocation={previewLocation}
            onConfirm={onMapConfirm}
            onClose={() => setMapOpen(false)}
          />
        )}
      </div>
    </ModalRoot>
  );
}
