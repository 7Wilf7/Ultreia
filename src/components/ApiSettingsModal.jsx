import { useState, useEffect } from "react";
import { s } from "../styles";
import { API_PROVIDERS, estimateMessageCost, TYPICAL_INPUT_TOKENS, TYPICAL_OUTPUT_TOKENS } from "../constants";
import { useT } from "../i18n/LanguageContext";
import { useIsMobile } from "../hooks/useMediaQuery";
import { ModalRoot } from "./ModalRoot";
import { TutorialModal } from "./TutorialModal";
import { TUTORIALS } from "../data/tutorials";

const LEGACY_FREE_DEEPSEEK_LIMIT = 10;

function maskedKey(k) {
  if (!k) return "";
  if (k.length <= 12) return "•".repeat(k.length);
  return k.slice(0, 7) + "…" + k.slice(-4);
}

// "$0.028 / msg" formatting — keep 3 sig figs so DeepSeek's small numbers
// stay meaningful.
function fmtCost(usd) {
  if (usd == null) return "—";
  if (usd >= 0.01)  return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(4)}`;
}

/**
 * Legacy API settings. Normal AI Coach calls now go through the wallet-backed
 * DeepSeek Edge Function, so this component is no longer mounted by App.jsx.
 */
export function ApiSettingsModal({
  apiProvider,
  apiKey, setApiKey,
  apiModel,
  freeDeepseekLeft,
  onClose,
}) {
  const t = useT();
  const isMobile = useIsMobile();
  const [keyDraft, setKeyDraft] = useState("");
  const [tutId, setTutId] = useState(null);
  // The info block (provider blurb + pricing + model note) auto-expands ONLY the
  // first time this account opens API settings; after that it stays collapsed
  // into the "!" button unless the user taps it. `firstTime` also drives a
  // one-shot "tap to collapse" hint by the "!".
  const [firstTime] = useState(() => {
    try { return !localStorage.getItem("ultreia.apiInfoSeen"); } catch { return false; }
  });
  const [pricingOpen, setPricingOpen] = useState(firstTime);
  // The "tap to collapse" tooltip is a brief one-shot — it would otherwise sit
  // over the content. Show it only on the first-ever open, and auto-hide after a
  // few seconds (or the moment the user taps "!").
  const [showHint, setShowHint] = useState(firstTime);
  useEffect(() => {
    try { localStorage.setItem("ultreia.apiInfoSeen", "1"); } catch { /* private mode */ }
  }, []);
  useEffect(() => {
    if (!showHint) return;
    const id = setTimeout(() => setShowHint(false), 4500);
    return () => clearTimeout(id);
  }, [showHint]);

  const providerId = API_PROVIDERS[apiProvider] ? apiProvider : "deepseek";
  const provider = API_PROVIDERS[providerId];
  const activeKey = apiKey;
  const setActiveKey = setApiKey;

  function saveKey() {
    if (!keyDraft.trim()) return;
    setActiveKey(keyDraft.trim());
    setKeyDraft("");
  }

  const sectionH = { fontSize: 16, fontWeight: 600, color: "var(--ink-1)", margin: "0 0 4px" };

  return (
    <ModalRoot onClose={onClose}>
    <div onClick={onClose} style={s.modalOverlay(isMobile, { float: true })}>
      <div onClick={e => e.stopPropagation()}
        style={s.modalCard(isMobile, { maxWidth: 600, float: true })}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, position: "relative" }}>
            <h2 style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>{t("api.title")}</h2>
            <button
              onClick={() => { setShowHint(false); setPricingOpen(o => !o); }}
              title={t("api.pricing_title")} aria-label={t("api.pricing_title")}
              style={{
                width: 20, height: 20, minHeight: 0, minWidth: 0,
                borderRadius: "50%", boxSizing: "border-box",
                border: `1px solid ${pricingOpen ? "var(--accent)" : "var(--ink-3)"}`,
                background: pricingOpen ? "var(--accent)" : "transparent",
                color: pricingOpen ? "var(--bg-deep)" : "var(--ink-3)",
                fontSize: 12, fontWeight: 700, fontFamily: "var(--font-mono)",
                cursor: "pointer", lineHeight: 1, padding: 0, flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "background 160ms, color 160ms, border-color 160ms",
              }}>!</button>
            {/* One-shot hint on the very first open: tell the user the "!" both
                collapses this info and reopens it later. Auto-hides after a few
                seconds so it never sits over the content. */}
            {showHint && (
              <div onClick={() => setShowHint(false)} style={{
                position: "absolute", top: "calc(100% + 6px)", left: 0,
                background: "var(--panel)", color: "var(--ink-1)",
                border: "1px solid var(--rule)",
                fontSize: 11, lineHeight: 1.4, padding: "6px 9px", borderRadius: 6,
                maxWidth: 200, zIndex: 5, boxShadow: "0 4px 14px rgba(0,0,0,0.2)",
              }}>
                {t("api.collapse_hint")}
              </div>
            )}
          </div>
          <button onClick={onClose} style={s.modalCloseBtn} aria-label="Close">×</button>
        </div>

        {/* Info block (provider blurb + pricing + model note) — collapses into
            the "!" button. Auto-open only on first-ever open (see firstTime). */}
        <div style={{
          overflow: "hidden",
          maxHeight: pricingOpen ? 700 : 0,
          opacity: pricingOpen ? 1 : 0,
          transform: pricingOpen ? "scale(1)" : "scale(0.92)",
          transformOrigin: "top left",
          transition: "max-height 300ms ease, opacity 220ms ease, transform 300ms ease",
          marginBottom: pricingOpen ? 22 : 4,
        }}>
        <div style={{
          border: "1px solid var(--rule)", borderRadius: 6,
          padding: "12px 14px",
          background: "var(--bg-elevated)",
          position: "relative",
        }}>
          <button onClick={() => setPricingOpen(false)} aria-label="Close"
            style={{
              position: "absolute", top: 6, right: 8,
              background: "none", border: "none", color: "var(--ink-3)",
              fontSize: 18, lineHeight: 1, cursor: "pointer", padding: 2,
            }}>×</button>
          <p style={{ ...s.muted, margin: "0 0 12px", lineHeight: 1.6, paddingRight: 18 }}>{t("api.desc_pick_provider")}</p>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{t("api.pricing_title")}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {Object.values(API_PROVIDERS).map(p => {
              const cost = estimateMessageCost(p.id);
              return (
                <div key={p.id} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    {p.label} <span style={{ ...s.muted, fontFamily: "var(--font-mono)", fontWeight: 400 }}>· {p.defaultModel}</span>
                  </div>
                  <div style={{ ...s.muted, fontSize: 12, lineHeight: 1.55 }}>
                    {t("api.pricing_line", {
                      input:  p.pricing.inputPerM.toString(),
                      output: p.pricing.outputPerM.toString(),
                    })}
                  </div>
                  {cost && (
                    <div style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--ink-1)" }}>
                      ≈ {fmtCost(cost.total)} / msg
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ ...s.muted, fontSize: 11, marginTop: 10, lineHeight: 1.55 }}>
            {t("api.pricing_example_note", {
              input: String(TYPICAL_INPUT_TOKENS),
              output: String(TYPICAL_OUTPUT_TOKENS),
            })}
          </div>
          <div style={{ ...s.muted, fontSize: 11, marginTop: 10, lineHeight: 1.55, borderTop: "1px solid var(--rule)", paddingTop: 10 }}>
            {t("api.model_locked_hint")}
          </div>
        </div>
        </div>

        <h3 style={{ ...sectionH, marginBottom: 10 }}>{provider.label}</h3>

        {/* Free-tier allowance — only for DeepSeek when the user has no own key
            yet (served from the app owner's shared key via coach-proxy). */}
        {providerId === "deepseek" && !activeKey && (
          <div style={{
            border: "1px solid var(--rule)", borderRadius: 6,
            padding: "9px 12px", marginBottom: 14,
            background: freeDeepseekLeft > 0 ? "var(--moss-bg)" : "var(--bg-sunken)",
            fontSize: 12.5, lineHeight: 1.55,
            color: freeDeepseekLeft > 0 ? "var(--moss-deep)" : "var(--ink-2)",
          }}>
            {freeDeepseekLeft > 0
              ? t("quota.ai_left", { n: String(freeDeepseekLeft), total: String(LEGACY_FREE_DEEPSEEK_LIMIT) })
              : t("quota.ai_used")}
          </div>
        )}

        {TUTORIALS[providerId] && (
          <button type="button" onClick={() => setTutId(providerId)} style={{ ...s.btnGhost, marginBottom: 18 }}>
            {t("tutorial.view")}
          </button>
        )}

        {/* Legacy personal API key editor, hidden from the current app shell. */}
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

        {/* Active model — informational only, locked per provider. (The
            "why locked" note now lives in the "!" info block.) */}
        <div style={{ ...s.label, marginBottom: 6, marginTop: 4 }}>{t("api.model_label")}</div>
        <div style={{
          fontFamily: "var(--font-mono)", fontSize: 13,
          padding: "8px 12px",
          background: "var(--bg-sunken)",
          border: "1px solid var(--rule)",
          borderRadius: 4,
          color: "var(--ink-1)",
        }}>
          {apiModel || provider.defaultModel}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 24 }}>
          <button onClick={onClose} style={s.btn}>{t("common.done")}</button>
        </div>
      </div>
    </div>
    {tutId && <TutorialModal tutorial={TUTORIALS[tutId]} onClose={() => setTutId(null)} />}
    </ModalRoot>
  );
}
