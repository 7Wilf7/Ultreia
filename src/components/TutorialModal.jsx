import { s } from "../styles";
import { useT, useLanguage } from "../i18n/LanguageContext";
import { ModalRoot } from "./ModalRoot";

// Reusable step-by-step setup tutorial. Same centered + blurred-backdrop chrome
// as WeatherApiSettingsModal, but at a higher z-index (10000) so it layers on
// top of the settings modal that opened it. Content comes from
// src/data/tutorials.js (bilingual { zh, en }); we pick by current UI language.
export function TutorialModal({ tutorial, onClose }) {
  const t = useT();
  const { lang } = useLanguage();
  const pick = (s) => (s ? (lang === "en" ? s.en : s.zh) : "");

  if (!tutorial) return null;

  return (
    <ModalRoot onClose={onClose}>
      <div onClick={onClose} className="ultreia-overlay-in" style={{
        position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
        background: "rgba(20,20,19,0.45)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 10000, padding: 16,
        overscrollBehavior: "contain",
      }}>
        <div onClick={e => e.stopPropagation()} className="ultreia-modal-in" style={{
          background: "var(--bg-elevated)",
          border: "1px solid var(--rule)",
          borderRadius: 4,
          boxShadow: "0 18px 50px rgba(0,0,0,0.25)",
          width: "100%", maxWidth: 480,
          maxHeight: "calc(100dvh - 32px)",
          overflowY: "auto",
          padding: "22px 24px 20px",
          boxSizing: "border-box",
          fontFamily: "var(--font-sans)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
            <h2 style={{ fontSize: 19, fontWeight: 500, margin: 0 }}>{pick(tutorial.title)}</h2>
            <button onClick={onClose} style={s.modalCloseBtn} aria-label="Close">×</button>
          </div>

          {tutorial.warn && (
            <div style={{
              border: "1px solid var(--warn)",
              background: "rgba(176,122,62,0.08)",
              color: "var(--ink-1)",
              padding: "9px 12px",
              fontSize: 12.5,
              borderRadius: 3,
              marginBottom: 16,
              lineHeight: 1.55,
            }}>
              ⚠ {pick(tutorial.warn)}
            </div>
          )}

          <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 14 }}>
            {tutorial.steps.map((step, i) => (
              <li key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <span style={{
                  flexShrink: 0,
                  width: 22, height: 22,
                  borderRadius: "50%",
                  background: "var(--accent)",
                  color: "var(--accent-ink)",
                  fontSize: 12, fontWeight: 600,
                  fontFamily: "var(--font-mono)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  marginTop: 1,
                }}>{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--ink-1)" }}>
                    {pick(step)}
                  </div>
                  {step.link && (
                    <a href={step.link} target="_blank" rel="noreferrer" style={{
                      display: "inline-block",
                      marginTop: 4,
                      fontFamily: "var(--font-mono)",
                      fontSize: 12,
                      color: "var(--moss-deep)",
                      textDecoration: "underline",
                      wordBreak: "break-all",
                    }}>
                      {step.link} ↗
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ol>

          {tutorial.footnote && (
            <p style={{ ...s.muted, fontSize: 11.5, lineHeight: 1.6, marginTop: 18, marginBottom: 0 }}>
              {pick(tutorial.footnote)}
            </p>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
            <button onClick={onClose} style={s.btn}>{t("common.done")}</button>
          </div>
        </div>
      </div>
    </ModalRoot>
  );
}
