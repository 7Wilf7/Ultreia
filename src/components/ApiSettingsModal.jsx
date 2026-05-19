import { useState } from "react";
import { s } from "../styles";
import { MODEL_PRESETS, DEEPSEEK_SIGNUP_URL } from "../constants";
import { useT } from "../i18n/LanguageContext";

function maskedKey(k) {
  if (!k) return "";
  if (k.length <= 12) return "•".repeat(k.length);
  return k.slice(0, 7) + "…" + k.slice(-4);
}

/**
 * API settings — locked to DeepSeek's Anthropic-compatible endpoint.
 * The URL is hardcoded in constants and not exposed in the UI; users only
 * need to paste their DeepSeek API key and (optionally) pick a model.
 */
export function ApiSettingsModal({
  apiKey, setApiKey,
  apiModel, setApiModel,
  onClose,
}) {
  const t = useT();
  const [keyDraft, setKeyDraft] = useState("");

  function saveKey() {
    if (!keyDraft.trim()) return;
    setApiKey(keyDraft.trim());
    setKeyDraft("");
  }
  function clearKey() {
    setApiKey("");
  }
  function pickModelPreset(m) {
    setApiModel(m);
  }

  const sectionH = { fontSize: 16, fontWeight: 600, color: "var(--ink-1)", margin: "0 0 4px" };

  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 1000, padding: 20, overflowY: "auto" }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: "var(--bg-elevated)", borderRadius: 4, padding: 24, maxWidth: 600, width: "100%", boxShadow: "0 10px 40px rgba(0,0,0,0.2)", margin: "20px auto", border: "1px solid var(--rule)" }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
          <h2 style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>{t("api.title")}</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, color: "var(--ink-3)", cursor: "pointer" }}>×</button>
        </div>
        <p style={{ ...s.muted, marginBottom: 22, lineHeight: 1.6 }}>{t("api.desc_ds")}</p>

        <h3 style={sectionH}>{t("api.section_coach")}</h3>
        <p style={{ ...s.muted, marginBottom: 14, lineHeight: 1.6 }}>
          {t("api.section_coach_desc")}{" "}
          <a href={DEEPSEEK_SIGNUP_URL} target="_blank" rel="noreferrer"
            style={{ color: "var(--moss-deep)", textDecoration: "underline" }}>
            {t("api.signup_link")}
          </a>
        </p>

        {/* API Key */}
        <div style={{ ...s.label, marginBottom: 6 }}>{t("api.key_label")}</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <input
            type="password"
            placeholder={apiKey ? t("api.key_placeholder_set") : t("api.ds_key_placeholder")}
            value={keyDraft}
            onChange={e => setKeyDraft(e.target.value)}
            style={{ ...s.input, flex: 1, fontFamily: "var(--font-mono)", fontSize: 13 }}
          />
          <button onClick={saveKey} disabled={!keyDraft.trim()}
            style={{ ...s.btn, opacity: keyDraft.trim() ? 1 : 0.5 }}>{t("api.save_key")}</button>
        </div>
        {apiKey && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 20 }}>
            <span style={{ ...s.muted, fontFamily: "var(--font-mono)" }}>{t("api.current", { key: maskedKey(apiKey) })}</span>
            <button onClick={clearKey} style={{ ...s.btnGhost, fontSize: 12, padding: "5px 10px", color: "var(--danger)", borderColor: "var(--danger)" }}>
              {t("api.clear_key")}
            </button>
          </div>
        )}

        {/* Model picker — two presets only (DeepSeek Pro / Flash) */}
        <div style={{ ...s.label, marginBottom: 6, marginTop: 8 }}>{t("api.model_label")}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
          {MODEL_PRESETS.map(m => (
            <button key={m} onClick={() => pickModelPreset(m)}
              style={{ ...s.chip(apiModel === m), fontFamily: "var(--font-mono)" }}>
              {m}
            </button>
          ))}
        </div>
        <div style={{ ...s.muted, fontSize: 11, marginBottom: 8 }}>{t("api.model_hint_ds")}</div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 24 }}>
          <button onClick={onClose} style={s.btn}>{t("common.done")}</button>
        </div>
      </div>
    </div>
  );
}
