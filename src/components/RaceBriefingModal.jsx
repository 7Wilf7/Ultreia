import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ModalRoot } from "./ModalRoot";
import { s } from "../styles";

export function RaceBriefingModal({ action, t, isMobile, mdComponents, onClose }) {
  const race = action?.payload?.raceBriefing || {};
  const markdown = String(action?.payload?.briefingMarkdown || "").trim();
  return (
    <ModalRoot onClose={onClose}>
      <div style={s.modalOverlay(isMobile, { float: true })} onClick={onClose}>
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            ...s.modalCard(isMobile, { maxWidth: 680, bg: "oklch(0.132 0.009 145)", float: true }),
            background: "linear-gradient(180deg, oklch(0.18 0.011 145), oklch(0.132 0.009 145))",
            maxHeight: isMobile ? "min(82dvh, 680px)" : "min(82vh, 720px)",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ ...s.label, marginBottom: 5 }}>{t("coach.race_briefing_modal_eyebrow")}</div>
              <h2 style={{ fontSize: 18, fontWeight: 650, lineHeight: 1.25, margin: 0, color: "var(--ink-1)" }}>
                {race.name || t("coach.race_briefing_target")}
              </h2>
              <div style={{ marginTop: 6, fontSize: 12, color: "var(--ink-3)", lineHeight: 1.45 }}>
                {[race.date, t("coach.race_briefing_days", { days: race.daysToRace ?? "-" }), [race.category, race.subtype].filter(Boolean).join(" / ")].filter(Boolean).join(" · ")}
              </div>
            </div>
            <button onClick={onClose} style={s.modalCloseBtn} aria-label="Close">×</button>
          </div>
          <div style={{
            borderTop: "1px solid var(--rule)",
            paddingTop: 12,
            color: "var(--ink-1)",
            fontSize: 13,
            lineHeight: 1.65,
          }}>
            {markdown ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                {markdown}
              </ReactMarkdown>
            ) : (
              <div style={raceBriefingEmptyStyle}>{t("coach.agent_action_empty_detail")}</div>
            )}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
            <button type="button" onClick={onClose} style={{ ...s.btn, fontSize: 12, padding: "7px 12px" }}>
              {t("common.close")}
            </button>
          </div>
        </div>
      </div>
    </ModalRoot>
  );
}

const raceBriefingEmptyStyle = {
  fontSize: 13,
  color: "var(--ink-3)",
  lineHeight: 1.5,
};
