import { useT } from "../i18n/LanguageContext";
import { ModalRoot } from "./ModalRoot";
import { useInstantPress } from "../hooks/useInstantPress";

// Context actions for a training/race record: a small centered card over a
// blurred backdrop (matches the change-password modal). Edit + Delete.
// `title` is an optional one-line label of the item being acted on.
export function ItemActionModal({ title, onEdit, onDelete, onClose }) {
  const t = useT();
  const instantPress = useInstantPress();
  return (
    <ModalRoot onClose={onClose}>
      <div onClick={onClose} style={{
        position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
        background: "rgba(20,20,19,0.45)",
        backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 9999, padding: 16, overscrollBehavior: "contain",
      }}>
        <div onClick={e => e.stopPropagation()} style={{
          background: "var(--bg-elevated)", border: "1px solid var(--rule)",
          borderRadius: 10, boxShadow: "0 18px 50px rgba(0,0,0,0.25)",
          width: "100%", maxWidth: 320, overflow: "hidden",
          fontFamily: "var(--font-sans)",
        }}>
          {title && (
            <div style={{
              padding: "13px 16px", borderBottom: "1px solid var(--rule-soft)",
              fontSize: 13, color: "var(--ink-2)", lineHeight: 1.4, textAlign: "center",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{title}</div>
          )}
          {onEdit && (
            <button
              {...instantPress("item-action-edit", onEdit)}
              style={{ ...ACTION_BTN, touchAction: "manipulation" }}
            >
              {t("common.edit")}
            </button>
          )}
          <button onClick={onDelete} style={{ ...ACTION_BTN, color: "var(--danger)", borderTop: onEdit ? "1px solid var(--rule-soft)" : "none" }}>
            {t("common.delete")}
          </button>
          <button {...instantPress("item-action-cancel", onClose)} style={{ ...ACTION_BTN, color: "var(--ink-3)", borderTop: "1px solid var(--rule-soft)", touchAction: "manipulation" }}>
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </ModalRoot>
  );
}

const ACTION_BTN = {
  display: "block", width: "100%", textAlign: "center",
  background: "transparent", border: "none", borderRadius: 0,
  padding: "15px 16px", fontSize: 15, color: "var(--ink-1)",
  cursor: "pointer", fontFamily: "var(--font-sans)",
  WebkitTapHighlightColor: "transparent",
};
