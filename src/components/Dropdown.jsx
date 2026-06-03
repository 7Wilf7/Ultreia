import { useEffect, useRef, useState } from "react";
import { s } from "../styles";

// Reusable in-app dropdown — replaces native <select> for a consistent look
// across the app + multi-select support. Modeled on the GlobalFilter ("All
// Types") panel the rest of the app already uses.
//
//   Single-select:  <Dropdown options value={v} onChange={setV} />
//   Multi-select:   <Dropdown multi options value={arr} onChange={setArr} />
//
// options: [{ value, label }]. Closes on outside-click / Escape; single-select
// closes on pick, multi stays open so several can be toggled. `variant`:
//   "field"  — boxed, full-width (drop-in for a form <select>)   [default]
//   "inline" — borderless text + ▼ (like the All Types trigger)
export function Dropdown({
  options = [],
  value,
  onChange,
  multi = false,
  placeholder = "—",
  variant = "field",
  fontSize,
  disabled = false,
  ariaLabel,
  align = "left", // "right" anchors the menu to the trigger's right edge so an
                  // inline dropdown near the screen edge doesn't overflow off-screen
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("touchstart", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("touchstart", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selected = multi ? (Array.isArray(value) ? value : []) : value;
  const labelOf = (v) => options.find(o => o.value === v)?.label ?? v;
  const isEmpty = multi ? selected.length === 0 : (value == null || value === "");
  const triggerText = multi
    ? (selected.length ? selected.map(labelOf).join(", ") : placeholder)
    : (isEmpty ? placeholder : labelOf(value));

  function pick(v) {
    if (multi) {
      onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]);
    } else {
      onChange(v);
      setOpen(false);
    }
  }

  const triggerStyle = variant === "inline"
    ? {
        background: "transparent", border: "none",
        cursor: disabled ? "default" : "pointer",
        padding: "6px 8px 6px 0",
        fontFamily: "var(--font-sans)", fontSize: fontSize || 15, fontWeight: 500,
        color: "var(--ink-1)", letterSpacing: "-0.01em",
        display: "inline-flex", alignItems: "center", gap: 8, whiteSpace: "nowrap",
        opacity: disabled ? 0.5 : 1,
      }
    : {
        ...s.input,
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
        cursor: disabled ? "default" : "pointer", textAlign: "left",
        opacity: disabled ? 0.5 : 1,
      };

  return (
    <div ref={wrapRef} style={{
      position: "relative",
      width: variant === "field" ? "100%" : undefined,
      display: variant === "field" ? "block" : "inline-block",
    }}>
      <button type="button" disabled={disabled} aria-label={ariaLabel}
        onClick={() => setOpen(o => !o)} style={triggerStyle}>
        <span style={{
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          color: isEmpty ? "var(--ink-3)" : "var(--ink-1)",
        }}>{triggerText || placeholder}</span>
        <span style={{ fontSize: 10, color: "var(--ink-3)", flexShrink: 0 }}>▼</span>
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "100%",
          left: align === "right" ? "auto" : 0,
          right: align === "right" ? 0 : "auto",
          marginTop: 2,
          // Match the trigger width (so the menu lines up under the control box),
          // growing only if an option is wider than the trigger.
          minWidth: "100%",
          width: variant === "field" ? "100%" : "max-content",
          maxHeight: 280, overflowY: "auto",
          background: "var(--bg-elevated)",
          border: "1px solid var(--rule)", borderRadius: 4,
          padding: "4px 0",
          boxShadow: "0 8px 24px rgba(20,20,19,0.12)",
          zIndex: 60, boxSizing: "border-box",
        }}>
          {options.map(o => {
            const isSel = multi ? selected.includes(o.value) : value === o.value;
            return (
              <button key={String(o.value)} type="button" onClick={() => pick(o.value)}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  width: "100%", textAlign: "left",
                  background: isSel ? "var(--bg-sunken)" : "transparent",
                  border: "none", padding: "9px 14px",
                  fontFamily: "var(--font-sans)", fontSize: 14,
                  color: "var(--ink-1)", cursor: "pointer",
                  fontWeight: isSel ? 600 : 400, borderRadius: 0,
                }}>
                {multi && (
                  <span style={{ width: 14, flexShrink: 0, color: "var(--moss)" }}>{isSel ? "✓" : ""}</span>
                )}
                <span style={{ flex: 1, minWidth: 0 }}>{o.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
