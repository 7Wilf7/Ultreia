import { s } from "../styles";
import { useT } from "../i18n/LanguageContext";
import { ModalRoot } from "./ModalRoot";

export function ConfirmDeleteModal({ confirmDelete, setConfirmDelete, onConfirm }) {
  const t = useT();
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
    <div onClick={() => setConfirmDelete(null)} className="ts-overlay-in"
      style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.4)", backdropFilter: "blur(5px)", WebkitBackdropFilter: "blur(5px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} className="ts-modal-in"
        style={{ background: "#fff", borderRadius: 12, padding: "20px 22px", maxWidth: 360, width: "100%", boxShadow: "0 10px 40px rgba(0,0,0,0.2)" }}>
        <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 10 }}>{title}</div>
        <div style={{ fontSize: 13, color: "#666", marginBottom: 16, lineHeight: 1.5 }}>{body}</div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={() => setConfirmDelete(null)}
            style={{ ...s.btnGhost, minHeight: 44, padding: "10px 18px" }}>
            {t("common.cancel")}
          </button>
          <button onClick={onConfirm}
            style={{ ...s.btn, background: "#c0392b", borderColor: "#c0392b", minHeight: 44, padding: "10px 18px" }}>
            {t("common.delete")}
          </button>
        </div>
      </div>
    </div>
    </ModalRoot>
  );
}
