import { useEffect, useState } from "react";
import { s } from "../styles";
import { useT } from "../i18n/LanguageContext";
import { normalizeAnnotationText } from "../utils/annotations";

function selectedText(root) {
  if (typeof window === "undefined" || !window.getSelection) return "";
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return "";
  if (root) {
    const anchor = sel.anchorNode;
    const focus = sel.focusNode;
    if ((anchor && !root.contains(anchor)) || (focus && !root.contains(focus))) return "";
  }
  return normalizeAnnotationText(sel.toString());
}

function selectionRect(root) {
  if (typeof window === "undefined" || !window.getSelection) return null;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !normalizeAnnotationText(sel.toString())) return null;
  if (root) {
    const anchor = sel.anchorNode;
    const focus = sel.focusNode;
    if ((anchor && !root.contains(anchor)) || (focus && !root.contains(focus))) return null;
  }
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  if (!rect || (!rect.width && !rect.height)) return null;
  return rect;
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
  selectionRootRef,
  floating = false,
  compact = false,
}) {
  const t = useT();
  const [error, setError] = useState("");
  const [floatingPos, setFloatingPos] = useState(null);
  const list = Array.isArray(annotations) ? annotations : [];
  const canSend = list.length > 0 || normalizeAnnotationText(extraText);

  useEffect(() => {
    if (!floating) return undefined;
    const update = () => {
      const rect = selectionRect(selectionRootRef?.current || null);
      if (!rect) {
        setFloatingPos(null);
        return;
      }
      const left = Math.min(Math.max(rect.left + rect.width / 2, 74), window.innerWidth - 74);
      const top = Math.max(rect.top - 44, 8);
      setFloatingPos({ left, top });
    };
    document.addEventListener("selectionchange", update);
    document.addEventListener("mouseup", update);
    document.addEventListener("touchend", update);
    window.addEventListener("scroll", update, true);
    return () => {
      document.removeEventListener("selectionchange", update);
      document.removeEventListener("mouseup", update);
      document.removeEventListener("touchend", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [floating, selectionRootRef]);

  function addSelection() {
    const quote = selectedText(selectionRootRef?.current || null);
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
    setFloatingPos(null);
    if (typeof window !== "undefined" && window.getSelection) window.getSelection().removeAllRanges();
  }

  function updateNote(id, note) {
    setAnnotations(list.map(a => a.id === id ? { ...a, note } : a));
  }

  function remove(id) {
    setAnnotations(list.filter(a => a.id !== id));
  }

  return (
    <div style={{
      borderTop: "1px solid var(--rule)",
      marginTop: compact ? 0 : 18,
      padding: compact ? "10px 12px calc(10px + env(safe-area-inset-bottom))" : "12px 0 0",
      background: compact ? "var(--bg)" : "transparent",
      flexShrink: 0,
    }}>
      {floating && floatingPos && (
        <button type="button" onClick={addSelection} style={{
          position: "fixed",
          left: floatingPos.left,
          top: floatingPos.top,
          transform: "translateX(-50%)",
          zIndex: 10000,
          ...s.btn,
          minHeight: 0,
          padding: "7px 10px",
          fontSize: 12,
          boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
          whiteSpace: "nowrap",
        }}>
          {t("annotations.add_selection_short")}
        </button>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: compact ? 6 : 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: compact ? 12 : 13, fontWeight: 650, color: "var(--ink-1)" }}>
            {title || t("annotations.title")}
            {list.length > 0 && <span style={{ color: "var(--ink-3)", fontWeight: 400 }}> · {t("annotations.count", { n: String(list.length) })}</span>}
          </div>
          {hint && !compact && <div style={{ ...s.muted, fontSize: 11, lineHeight: 1.45, marginTop: 2 }}>{hint}</div>}
        </div>
        <button type="button" onClick={addSelection} style={{ ...s.btnGhost, fontSize: 12, padding: "6px 10px", minHeight: 0, flexShrink: 0 }}>
          {t("annotations.add_selection")}
        </button>
      </div>

      {error && <div style={{ color: "var(--warn)", fontSize: 11, lineHeight: 1.45, marginBottom: 8 }}>{error}</div>}

      {list.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10, maxHeight: compact ? 150 : "none", overflowY: compact ? "auto" : "visible" }}>
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

      <div style={{ display: "flex", alignItems: "stretch", gap: 8 }}>
        {setExtraText && (
          <textarea
            value={extraText || ""}
            onChange={e => setExtraText(e.target.value)}
            rows={1}
            placeholder={extraPlaceholder || t("annotations.extra_placeholder")}
            style={{
              ...s.input,
              flex: 1,
              width: "100%",
              resize: compact ? "none" : "vertical",
              minHeight: compact ? 40 : 78,
              height: compact ? 40 : undefined,
              lineHeight: compact ? "20px" : 1.5,
              padding: compact ? "9px 10px" : undefined,
              marginBottom: 0,
            }}
          />
        )}

        <button type="button" onClick={onSend} disabled={!canSend} style={{
          ...s.btn,
          width: compact ? 42 : "100%",
          minWidth: compact ? 42 : undefined,
          minHeight: compact ? 40 : undefined,
          padding: compact ? 0 : undefined,
          opacity: canSend ? 1 : 0.45,
          flexShrink: 0,
        }}>
          {compact ? "↵" : (sendLabel || t("annotations.send"))}
        </button>
      </div>
    </div>
  );
}
