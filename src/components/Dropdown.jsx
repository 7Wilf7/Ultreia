import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { s } from "../styles";
import { useInstantPress } from "../hooks/useInstantPress";

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
  triggerStyle, // optional style overrides merged into the trigger (e.g. height)
  align = "left", // "right" anchors the menu to the trigger's right edge so an
                  // inline dropdown near the screen edge doesn't overflow off-screen
}) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState(null);
  const wrapRef = useRef(null);
  const menuRef = useRef(null);
  const instantPress = useInstantPress();

  useEffect(() => {
    if (!open) return;
    function placeMenu() {
      const el = wrapRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const minWidth = Math.max(120, rect.width);
      const menuWidth = variant === "field" ? minWidth : Math.max(minWidth, 160);
      const left = align === "right"
        ? Math.max(8, Math.min(window.innerWidth - menuWidth - 8, rect.right - menuWidth))
        : Math.max(8, Math.min(window.innerWidth - menuWidth - 8, rect.left));
      const availableBelow = window.innerHeight - rect.bottom - 10;
      const availableAbove = rect.top - 10;
      const opensUp = availableBelow < 160 && availableAbove > availableBelow;
      const maxHeight = Math.max(120, Math.min(320, opensUp ? availableAbove : availableBelow));
      setMenuStyle({
        position: "fixed",
        left,
        top: opensUp ? "auto" : rect.bottom + 2,
        bottom: opensUp ? window.innerHeight - rect.top + 2 : "auto",
        minWidth,
        width: variant === "field" ? minWidth : "max-content",
        maxWidth: `calc(100vw - 16px)`,
        maxHeight,
      });
    }
    placeMenu();
    function onDocClick(e) {
      if (wrapRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    function onKey(e) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("touchstart", onDocClick);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", placeMenu);
    window.addEventListener("scroll", placeMenu, true);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("touchstart", onDocClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", placeMenu);
      window.removeEventListener("scroll", placeMenu, true);
    };
  }, [open, align, variant]);

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

  function toggleOpen() {
    setOpen(o => !o);
  }

  const triggerStyleBase = variant === "inline"
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
        {...instantPress("trigger", toggleOpen)}
        style={{ ...triggerStyleBase, touchAction: "manipulation", WebkitTapHighlightColor: "transparent", ...triggerStyle }}>
        <span style={{
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          color: isEmpty ? "var(--ink-3)" : "var(--ink-1)",
        }}>{triggerText || placeholder}</span>
        <span style={{ fontSize: 10, color: "var(--ink-3)", flexShrink: 0 }}>▼</span>
      </button>
      {open && menuStyle && createPortal((
        <div ref={menuRef} style={{
          ...menuStyle,
          overflowY: "auto",
          background: "var(--bg-elevated)",
          border: "1px solid var(--rule)", borderRadius: 4,
          padding: "4px 0",
          boxShadow: "0 8px 24px rgba(20,20,19,0.12)",
          zIndex: 10040, boxSizing: "border-box",
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
      ), document.body)}
    </div>
  );
}
