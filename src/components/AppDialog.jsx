import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "../i18n/LanguageContext";
import { s } from "../styles";
import { ModalRoot } from "./ModalRoot";
import { AppDialogContext } from "./AppDialogContext";

export function AppDialogProvider({ children }) {
  const t = useT();
  const [dialog, setDialog] = useState(null);
  const resolverRef = useRef(null);

  const close = useCallback((result) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setDialog(null);
    resolve?.(result);
  }, []);

  const alert = useCallback((message, options = {}) => {
    if (resolverRef.current) close(false);
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setDialog({
        type: "alert",
        title: options.title || t("dialog.notice"),
        message: String(message || ""),
        confirmLabel: options.confirmLabel || t("common.ok"),
      });
    });
  }, [close, t]);

  const confirm = useCallback((message, options = {}) => {
    if (resolverRef.current) close(false);
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setDialog({
        type: "confirm",
        title: options.title || t("dialog.confirm"),
        message: String(message || ""),
        confirmLabel: options.confirmLabel || t("common.done"),
        cancelLabel: options.cancelLabel || t("common.cancel"),
        danger: options.danger === true,
      });
    });
  }, [close, t]);

  useEffect(() => {
    const nativeAlert = window.alert;
    const nativeConfirm = window.confirm;
    window.alert = (message) => { void alert(message); };
    window.confirm = (message) => {
      void confirm(message);
      return false;
    };
    return () => {
      window.alert = nativeAlert;
      window.confirm = nativeConfirm;
    };
  }, [alert, confirm]);

  const value = { alert, confirm };

  return (
    <AppDialogContext.Provider value={value}>
      {children}
      {dialog && (
        <ModalRoot onClose={() => close(false)}>
          <div
            className="ultreia-overlay-in"
            onClick={() => close(false)}
            style={s.modalOverlay(true, { float: true })}
          >
            <div
              className="ultreia-modal-in"
              onClick={(e) => e.stopPropagation()}
              style={s.modalCard(true, { maxWidth: 360, float: true })}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h2 style={{ fontSize: 17, fontWeight: 650, margin: "0 0 8px" }}>{dialog.title}</h2>
                  <div style={{ ...s.muted, lineHeight: 1.55, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                    {dialog.message}
                  </div>
                </div>
                <button onClick={() => close(false)} style={s.modalCloseBtn} aria-label="Close">×</button>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                {dialog.type === "confirm" && (
                  <button type="button" onClick={() => close(false)} style={s.btnGhost}>
                    {dialog.cancelLabel}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => close(true)}
                  style={{
                    ...s.btn,
                    ...(dialog.danger ? {
                      background: "var(--danger)",
                      borderColor: "var(--danger)",
                      color: "var(--ink-inv)",
                    } : {}),
                  }}
                >
                  {dialog.confirmLabel}
                </button>
              </div>
            </div>
          </div>
        </ModalRoot>
      )}
    </AppDialogContext.Provider>
  );
}
