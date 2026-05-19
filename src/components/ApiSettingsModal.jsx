import { useState } from "react";
import { s } from "../styles";
import { DEFAULT_API_ENDPOINT, MODEL_PRESETS, API_PRESETS } from "../constants";
import { useT } from "../i18n/LanguageContext";

function maskedKey(k) {
  if (!k) return "";
  if (k.length <= 12) return "•".repeat(k.length);
  return k.slice(0, 7) + "…" + k.slice(-4);
}

export function ApiSettingsModal({
  apiKey, setApiKey,
  apiEndpoint, setApiEndpoint,
  apiModel, setApiModel,
  onClose,
}) {
  const t = useT();
  const [keyDraft, setKeyDraft] = useState("");
  const [endpointDraft, setEndpointDraft] = useState(apiEndpoint);
  const [modelDraft, setModelDraft] = useState(apiModel);

  const isCustomEndpoint = apiEndpoint && apiEndpoint !== DEFAULT_API_ENDPOINT;

  function saveKey() {
    if (!keyDraft.trim()) return;
    setApiKey(keyDraft.trim());
    setKeyDraft("");
  }
  function clearKey() {
    setApiKey("");
  }
  function saveEndpoint() {
    const v = endpointDraft.trim();
    setApiEndpoint(v || DEFAULT_API_ENDPOINT);
  }
  function resetEndpoint() {
    setApiEndpoint(DEFAULT_API_ENDPOINT);
    setEndpointDraft(DEFAULT_API_ENDPOINT);
  }
  function saveModel() {
    const v = modelDraft.trim();
    if (v) setApiModel(v);
  }
  function pickModelPreset(m) {
    setModelDraft(m);
    setApiModel(m);
  }

  function applyApiPreset(preset) {
    setApiEndpoint(preset.endpoint);
    setEndpointDraft(preset.endpoint);
    setApiModel(preset.model);
    setModelDraft(preset.model);
  }

  function isActivePreset(preset) {
    return apiEndpoint === preset.endpoint && apiModel === preset.model;
  }

  // Section heading style
  const sectionH = { fontSize: 16, fontWeight: 600, color: "#111", margin: "0 0 4px", letterSpacing: "0.01em" };

  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 1000, padding: 20, overflowY: "auto" }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: "#fff", borderRadius: 12, padding: 24, maxWidth: 680, width: "100%", boxShadow: "0 10px 40px rgba(0,0,0,0.2)", margin: "20px auto" }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
          <h2 style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>{t("api.title")}</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, color: "#888", cursor: "pointer" }}>×</button>
        </div>
        <p style={{ ...s.muted, marginBottom: 18, lineHeight: 1.5 }}>{t("api.desc")}</p>

        {/* ===== AI Coach API ===== */}
        <h3 style={sectionH}>{t("api.section_coach")}</h3>
        <p style={{ ...s.muted, marginBottom: 14, lineHeight: 1.5 }}>{t("api.section_coach_desc")}</p>

        {/* Quick presets */}
        <div style={{ ...s.cardDark, marginBottom: 20, padding: "12px 14px" }}>
          <div style={{ ...s.label, marginBottom: 8 }}>{t("api.preset_label")}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {API_PRESETS.map(p => (
              <button key={p.id} onClick={() => applyApiPreset(p)}
                style={{ ...s.chip(isActivePreset(p)), padding: "6px 12px" }}
                title={p.note}>
                {p.label}
              </button>
            ))}
          </div>
          <div style={{ ...s.muted, marginTop: 8, fontSize: 11, lineHeight: 1.5 }}>{t("api.preset_note")}</div>
        </div>

        {/* API Key */}
        <div style={{ ...s.label, marginBottom: 6 }}>{t("api.key_label")}</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <input
            type="password"
            placeholder={apiKey ? t("api.key_placeholder_set") : t("api.key_placeholder_empty")}
            value={keyDraft}
            onChange={e => setKeyDraft(e.target.value)}
            style={{ ...s.input, flex: 1, fontFamily: "var(--font-mono)", fontSize: 12 }}
          />
          <button onClick={saveKey} disabled={!keyDraft.trim()}
            style={{ ...s.btn, opacity: keyDraft.trim() ? 1 : 0.5 }}>{t("api.save_key")}</button>
        </div>
        {apiKey && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 18 }}>
            <span style={{ ...s.muted, fontFamily: "var(--font-mono)" }}>{t("api.current", { key: maskedKey(apiKey) })}</span>
            <button onClick={clearKey} style={{ ...s.btnGhost, fontSize: 12, padding: "5px 10px", color: "#c0392b", borderColor: "#e8a89f" }}>
              {t("api.clear_key")}
            </button>
          </div>
        )}

        {/* Endpoint URL */}
        <div style={{ ...s.label, marginBottom: 6 }}>{t("api.endpoint_label")}</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
          <input
            type="text"
            placeholder={DEFAULT_API_ENDPOINT}
            value={endpointDraft}
            onChange={e => setEndpointDraft(e.target.value)}
            style={{ ...s.input, flex: 1, fontFamily: "var(--font-mono)", fontSize: 12 }}
          />
          <button onClick={saveEndpoint}
            disabled={endpointDraft.trim() === apiEndpoint}
            style={{ ...s.btn, opacity: endpointDraft.trim() === apiEndpoint ? 0.5 : 1 }}>{t("api.save_url")}</button>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 11, color: "#666", marginBottom: 18 }}>
          <span style={{ fontFamily: "var(--font-mono)" }}>
            {isCustomEndpoint ? t("api.endpoint_custom") : t("api.endpoint_official")}{apiEndpoint}
          </span>
          {isCustomEndpoint && (
            <button onClick={resetEndpoint} style={{ ...s.btnGhost, fontSize: 11, padding: "3px 8px" }}>
              {t("api.reset_endpoint")}
            </button>
          )}
        </div>

        {/* Model */}
        <div style={{ ...s.label, marginBottom: 6 }}>
          {t("api.model_label")}
          <span style={{ ...s.muted, marginLeft: 6, fontWeight: 400 }}>
            {t("api.model_hint_prefix")}
            <code style={{ background: "#eee", padding: "1px 4px", borderRadius: 3, fontFamily: "var(--font-mono)" }}>claude-opus-4-7</code>
            {t("api.model_hint_suffix")}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
          <input
            type="text"
            placeholder={t("api.model_placeholder")}
            value={modelDraft}
            onChange={e => setModelDraft(e.target.value)}
            style={{ ...s.input, flex: 1, fontFamily: "var(--font-mono)", fontSize: 12 }}
          />
          <button onClick={saveModel}
            disabled={!modelDraft.trim() || modelDraft.trim() === apiModel}
            style={{ ...s.btn, opacity: (!modelDraft.trim() || modelDraft.trim() === apiModel) ? 0.5 : 1 }}>
            {t("api.save_model")}
          </button>
        </div>
        <div style={{ marginBottom: 6, fontSize: 11, color: "#666", fontFamily: "var(--font-mono)" }}>
          {t("api.active", { model: apiModel })}
        </div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {MODEL_PRESETS.map(m => (
            <button key={m} onClick={() => pickModelPreset(m)}
              style={{ ...s.chip(apiModel === m), fontSize: 10, fontFamily: "var(--font-mono)", padding: "3px 8px" }}>
              {m}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 24 }}>
          <button onClick={onClose} style={s.btn}>{t("common.done")}</button>
        </div>
      </div>
    </div>
  );
}
