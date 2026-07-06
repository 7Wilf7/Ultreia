import { s } from "../styles";
import { useT } from "../i18n/LanguageContext";
import { ModalRoot } from "./ModalRoot";
import { useInstantPress, useInstantTap } from "../hooks/useInstantPress";

export function ConfirmDeleteModal({ confirmDelete, setConfirmDelete, onConfirm }) {
  const t = useT();
  const instantPress = useInstantPress();
  const instantTap = useInstantTap();
  if (!confirmDelete) return null;

  let title = "";
  if (confirmDelete.type === "log")  title = t("confirm.title.log");
  if (confirmDelete.type === "logs") title = t("confirm.title.logs", { n: confirmDelete.ids.length });
  if (confirmDelete.type === "race") title = t("confirm.title.race");
  if (confirmDelete.type === "chat") title = t("confirm.title.chat");

  // Clearing chat is the one case where there's a recovery step the user
  // should take first: distill anything worth keeping into Memory. Other
  // deletes just get the generic "can't be undone" warning.
  const body = confirmDelete.type === "chat" ? t("confirm.body.chat") : t("common.undo_warning");

  return (
    <ModalRoot onClose={() => setConfirmDelete(null)}>
    <div onClick={() => setConfirmDelete(null)} className="ultreia-overlay-in"
      style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "oklch(0.04 0.006 274 / 0.72)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} className="ultreia-modal-in"
        style={{ background: "var(--panel)", border: "1px solid var(--rule)", color: "var(--ink-1)", borderRadius: 12, padding: "20px 22px", maxWidth: 360, width: "100%", boxShadow: "var(--shadow)" }}>
        <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 10 }}>{title}</div>
        <div style={{ fontSize: 13, color: "var(--ink-2)", marginBottom: 16, lineHeight: 1.5 }}>{body}</div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            {...instantPress("confirm-delete-cancel", () => setConfirmDelete(null))}
            style={{ ...s.btnGhost, minHeight: 44, padding: "10px 18px", touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}>
            {t("common.cancel")}
          </button>
          <button
            {...instantTap("confirm-delete-confirm", onConfirm)}
            style={{ ...s.btn, background: "var(--danger)", borderColor: "var(--danger)", color: "var(--ink-inv)", minHeight: 44, padding: "10px 18px", touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}>
            {t("common.delete")}
          </button>
        </div>
      </div>
    </div>
    </ModalRoot>
  );
}
