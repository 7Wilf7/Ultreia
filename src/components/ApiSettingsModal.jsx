import { useState } from "react";
import { s } from "../styles";
import { API_PROVIDERS } from "../constants";
import { useT } from "../i18n/LanguageContext";
import { useIsMobile } from "../hooks/useMediaQuery";
import { ModalRoot } from "./ModalRoot";

function maskedKey(k) {
  if (!k) return "";
  if (k.length <= 12) return "•".repeat(k.length);
  return k.slice(0, 7) + "…" + k.slice(-4);
}

/**
 * API settings — one Provider active at a time. Only the active provider's
 * inputs render so the user isn't confused by a second provider's fields
 * sitting open. Both providers' keys + model picks persist independently, so
 * flipping the provider switch doesn't lose anything.
 *
 * Claude here is a THIRD-PARTY relay (claudeapi.com), not Anthropic. That's
 * called out inline so the user doesn't paste an official Anthropic key by
 * mistake. The relay offers region-routed mirrors — the user picks which
 * one (stored per-device in localStorage; passed in / out by the parent).
 *
 * Models for both providers are RECOMMENDED-only: chip taps fill the field,
 * but the input below lets the user type any model ID. This way new model
 * releases don't require a code change.
 */
export function ApiSettingsModal({
  apiProvider, setApiProvider,
  apiKey, setApiKey,
  claudeApiKey, setClaudeApiKey,
  claudeEndpointId, setClaudeEndpointId,
  apiModel, setApiModel,
  onClose,
}) {
  const t = useT();
  const isMobile = useIsMobile();
  const [keyDraft, setKeyDraft] = useState("");
  const [modelDraft, setModelDraft] = useState("");

  const provider = API_PROVIDERS[apiProvider] || API_PROVIDERS.deepseek;
  const activeKey = apiProvider === "claude" ? claudeApiKey : apiKey;
  const setActiveKey = apiProvider === "claude" ? setClaudeApiKey : setApiKey;

  function saveKey() {
    if (!keyDraft.trim()) return;
    setActiveKey(keyDraft.trim());
    setKeyDraft("");
  }

  // Provider switch resets the model preset to that provider's default —
  // otherwise the picker would show a stale model name from the other side.
  function switchProvider(next) {
    if (next === apiProvider) return;
    setApiProvider(next);
    setApiModel(API_PROVIDERS[next].defaultModel);
    setKeyDraft("");
    setModelDraft("");
  }

  function applyCustomModel() {
    if (!modelDraft.trim()) return;
    setApiModel(modelDraft.trim());
    setModelDraft("");
  }

  const sectionH = { fontSize: 16, fontWeight: 600, color: "var(--ink-1)", margin: "0 0 4px" };

  return (
    <ModalRoot>
    <div onClick={onClose} style={s.modalOverlay(isMobile)}>
      <div onClick={e => e.stopPropagation()}
        style={s.modalCard(isMobile, { maxWidth: 600 })}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
          <h2 style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>{t("api.title")}</h2>
          <button onClick={onClose} style={s.modalCloseBtn} aria-label="Close">×</button>
        </div>
        <p style={{ ...s.muted, marginBottom: 18, lineHeight: 1.6 }}>{t("api.desc_pick_provider")}</p>

        {/* Provider switch */}
        <div style={{ ...s.label, marginBottom: 6 }}>{t("api.provider_label")}</div>
        <div style={{ display: "flex", gap: 6, marginBottom: 22, flexWrap: "wrap" }}>
          {Object.values(API_PROVIDERS).map(p => (
            <button key={p.id} onClick={() => switchProvider(p.id)}
              style={s.chip(apiProvider === p.id)}>
              {p.label}
            </button>
          ))}
        </div>

        {/* Active-provider section header. For the third-party relay we surface
            its console URL inline so the user knows where the relay actually
            lives (not on api.anthropic.com). */}
        <h3 style={sectionH}>{provider.label}</h3>
        {provider.isThirdParty ? (
          <p style={{ ...s.muted, marginBottom: 14, lineHeight: 1.6 }}>
            {t("api.third_party_notice")}{" "}
            <a href={provider.consoleUrl} target="_blank" rel="noreferrer"
              style={{ color: "var(--moss-deep)", textDecoration: "underline" }}>
              {provider.consoleUrl}
            </a>
          </p>
        ) : (
          <p style={{ ...s.muted, marginBottom: 14, lineHeight: 1.6 }}>
            <a href={provider.signupUrl} target="_blank" rel="noreferrer"
              style={{ color: "var(--moss-deep)", textDecoration: "underline" }}>
              {provider.signupUrl}
            </a>
          </p>
        )}

        {/* API key for the active provider only — the other provider's key
            persists silently in state, untouched. */}
        <div style={{ ...s.label, marginBottom: 6 }}>{t("api.key_label")}</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <input
            type="password"
            placeholder={activeKey ? t("api.key_placeholder_set") : t("api.key_placeholder_empty")}
            value={keyDraft}
            onChange={e => setKeyDraft(e.target.value)}
            style={{ ...s.input, flex: 1, fontFamily: "var(--font-mono)", fontSize: 13 }}
          />
          <button onClick={saveKey} disabled={!keyDraft.trim()}
            style={{ ...s.btn, opacity: keyDraft.trim() ? 1 : 0.5 }}>{t("api.save_key")}</button>
        </div>
        {activeKey && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 20 }}>
            <span style={{ ...s.muted, fontFamily: "var(--font-mono)" }}>{t("api.current", { key: maskedKey(activeKey) })}</span>
            <button onClick={() => setActiveKey("")}
              style={{ ...s.btnGhost, fontSize: 12, padding: "5px 10px", color: "var(--danger)", borderColor: "var(--danger)" }}>
              {t("api.clear_key")}
            </button>
          </div>
        )}

        {/* Endpoint picker — only when the provider offers more than one (e.g.
            the Claude relay's region-routed mirrors). Stored per-device, not
            per-account. */}
        {provider.endpoints.length > 1 && (
          <>
            <div style={{ ...s.label, marginBottom: 6, marginTop: 12 }}>{t("api.endpoint_pick_label")}</div>
            <div style={{ ...s.muted, marginBottom: 8, lineHeight: 1.5 }}>{t("api.endpoint_pick_hint")}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 20 }}>
              {provider.endpoints.map(e => {
                const active = (claudeEndpointId || "default") === e.id;
                return (
                  <button key={e.id} onClick={() => setClaudeEndpointId(e.id)}
                    style={{
                      ...s.chip(active),
                      padding: "8px 12px",
                      textAlign: "left",
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                      alignItems: "baseline",
                    }}>
                    <span style={{ fontWeight: 500 }}>{e.label}</span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: active ? "var(--ink-inv)" : "var(--ink-3)" }}>
                      {e.url}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* Model: chip presets fill the input, but the free-text save lets the
            user paste any model name the provider supports without waiting on
            a code change. Active model echoed below in mono so it's obvious
            what's actually live. */}
        <div style={{ ...s.label, marginBottom: 6, marginTop: 4 }}>{t("api.model_label")}</div>
        <div style={{ ...s.muted, marginBottom: 8, lineHeight: 1.5 }}>{t("api.model_hint_editable")}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          {provider.models.map(m => (
            <button key={m}
              onClick={() => { setApiModel(m); setModelDraft(""); }}
              style={{ ...s.chip(apiModel === m), fontFamily: "var(--font-mono)" }}>
              {m}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <input
            type="text"
            placeholder={t("api.model_custom_placeholder")}
            value={modelDraft}
            onChange={e => setModelDraft(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") applyCustomModel(); }}
            style={{ ...s.input, flex: 1, fontFamily: "var(--font-mono)", fontSize: 13 }}
          />
          <button onClick={applyCustomModel} disabled={!modelDraft.trim()}
            style={{ ...s.btn, opacity: modelDraft.trim() ? 1 : 0.5 }}>{t("api.save_model")}</button>
        </div>
        <div style={{ ...s.muted, fontFamily: "var(--font-mono)", fontSize: 12, marginBottom: 4 }}>
          {t("api.active", { model: apiModel || "—" })}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 24 }}>
          <button onClick={onClose} style={s.btn}>{t("common.done")}</button>
        </div>
      </div>
    </div>
    </ModalRoot>
  );
}
