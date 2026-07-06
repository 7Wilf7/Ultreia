import { useState } from "react";
import { s } from "../styles";
import { useT } from "../i18n/LanguageContext";
import { useIsMobile } from "../hooks/useMediaQuery";
import { ModalRoot } from "./ModalRoot";
import { useInstantPress } from "../hooks/useInstantPress";

const FIELDS = [
  ["sleep", "calendar.readiness_sleep"],
  ["legs", "calendar.readiness_legs"],
  ["energy", "calendar.readiness_energy"],
];

export function ReadinessPromptModal({ initial, onSave, onSkip }) {
  const t = useT();
  const isMobile = useIsMobile();
  const instantPress = useInstantPress();
  const [vals, setVals] = useState({
    sleep: initial?.sleep ?? null,
    legs: initial?.legs ?? null,
    energy: initial?.energy ?? null,
  });
  const hasAny = vals.sleep || vals.legs || vals.energy;

  function setField(field, val) {
    setVals(cur => ({ ...cur, [field]: cur[field] === val ? null : val }));
  }

  return (
    <ModalRoot onClose={onSkip}>
      <div style={s.modalOverlay(isMobile, { float: true })} onClick={onSkip}>
        <div
          className="ultreia-overlay-in"
          style={s.modalCard(isMobile, { maxWidth: 420, float: true })}
          onClick={e => e.stopPropagation()}
        >
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>{t("readiness.prompt_title")}</h2>
              <p style={{ ...s.muted, margin: "6px 0 0", fontSize: 12.5, lineHeight: 1.55 }}>{t("readiness.prompt_body")}</p>
            </div>
            <button {...instantPress("readiness-prompt-close", onSkip)} style={s.modalCloseBtn} aria-label="Close">×</button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 9, marginBottom: 16 }}>
            {FIELDS.map(([field, key]) => (
              <div key={field} style={{ display: "grid", gridTemplateColumns: "64px 1fr", gap: 8, alignItems: "center" }}>
                <span style={{ ...s.muted, fontSize: 12, fontWeight: 600 }}>{t(key)}</span>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                  {[1, 2, 3].map(v => (
                    <button
                      key={v}
                      {...instantPress(`readiness-prompt-${field}-${v}`, () => setField(field, v))}
                      style={{
                        ...s.chip(vals[field] === v),
                        minHeight: 34,
                        padding: "7px 4px",
                        fontSize: 12,
                        whiteSpace: "nowrap",
                        touchAction: "manipulation",
                        WebkitTapHighlightColor: "transparent",
                      }}
                    >
                      {t(`calendar.readiness_lvl_${v}`)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button {...instantPress("readiness-prompt-skip", onSkip)} style={s.btnGhost}>{t("readiness.prompt_skip")}</button>
            <button
              onClick={() => onSave(vals)}
              disabled={!hasAny}
              style={{ ...s.btn, opacity: hasAny ? 1 : 0.45 }}
            >
              {t("readiness.prompt_save")}
            </button>
          </div>
        </div>
      </div>
    </ModalRoot>
  );
}
