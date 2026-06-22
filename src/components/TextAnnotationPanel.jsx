import { useState } from "react";
import { s } from "../styles";
import { useT } from "../i18n/LanguageContext";
import { normalizeAnnotationText } from "../utils/annotations";

function selectedText() {
  if (typeof window === "undefined" || !window.getSelection) return "";
  return normalizeAnnotationText(window.getSelection().toString());
}

export function TextAnnotationPanel({
  title,
  hint,
  sourceLabel,
  annotations,
  setAnnotations,
  extraText,
  setExtraText,
  extraPlaceholder,
  sendLabel,
  onSend,
}) {
  const t = useT();
  const [error, setError] = useState("");
  const list = Array.isArray(annotations) ? annotations : [];
  const canSend = list.length > 0 || normalizeAnnotationText(extraText);

  function addSelection() {
    const quote = selectedText();
    if (!quote) {
      setError(t("annotations.no_selection"));
      return;
    }
    setAnnotations([
      ...list,
      {
        id: `${Date.now()}-${list.length}`,
        sourceLabel: sourceLabel || t("annotations.default_source"),
        quote,
        note: "",
      },
    ]);
    setError("");
    if (typeof window !== "undefined" && window.getSelection) window.getSelection().removeAllRanges();
  }

  function updateNote(id, note) {
    setAnnotations(list.map(a => a.id === id ? { ...a, note } : a));
  }

  function remove(id) {
    setAnnotations(list.filter(a => a.id !== id));
  }

  return (
    <div style={{ borderTop: "1px solid var(--rule)", marginTop: 18, paddingTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 650, color: "var(--ink-1)" }}>{title || t("annotations.title")}</div>
          {hint && <div style={{ ...s.muted, fontSize: 11, lineHeight: 1.45, marginTop: 2 }}>{hint}</div>}
        </div>
        <button type="button" onClick={addSelection} style={{ ...s.btnGhost, fontSize: 12, padding: "6px 10px", minHeight: 0, flexShrink: 0 }}>
          {t("annotations.add_selection")}
        </button>
      </div>

      {error && <div style={{ color: "var(--warn)", fontSize: 11, lineHeight: 1.45, marginBottom: 8 }}>{error}</div>}

      {list.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
          {list.map((a, idx) => (
            <div key={a.id} style={{ border: "1px solid var(--rule)", background: "var(--bg-elevated)", padding: 10, borderRadius: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                <div style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--font-mono)" }}>
                  #{idx + 1} {a.sourceLabel || sourceLabel || ""}
                </div>
                <button type="button" onClick={() => remove(a.id)} aria-label={t("common.delete")}
                  style={{ border: "none", background: "transparent", color: "var(--ink-3)", cursor: "pointer", padding: 0, minHeight: 0, fontSize: 16, lineHeight: 1 }}>
                  ×
                </button>
              </div>
              <blockquote style={{
                margin: "0 0 8px",
                padding: "6px 8px",
                borderLeft: "3px solid var(--moss)",
                background: "var(--bg)",
                color: "var(--ink-2)",
                fontSize: 12,
                lineHeight: 1.55,
                whiteSpace: "pre-wrap",
              }}>{a.quote}</blockquote>
              <textarea
                value={a.note || ""}
                onChange={e => updateNote(a.id, e.target.value)}
                rows={2}
                placeholder={t("annotations.note_placeholder")}
                style={{ ...s.input, width: "100%", resize: "vertical", minHeight: 54, lineHeight: 1.45, fontSize: 12 }}
              />
            </div>
          ))}
        </div>
      )}

      {setExtraText && (
        <textarea
          value={extraText || ""}
          onChange={e => setExtraText(e.target.value)}
          rows={3}
          placeholder={extraPlaceholder || t("annotations.extra_placeholder")}
          style={{ ...s.input, width: "100%", resize: "vertical", minHeight: 78, lineHeight: 1.5, marginBottom: 8 }}
        />
      )}

      <button type="button" onClick={onSend} disabled={!canSend} style={{ ...s.btn, width: "100%", opacity: canSend ? 1 : 0.45 }}>
        {sendLabel || t("annotations.send")}
      </button>
    </div>
  );
}
