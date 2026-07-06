import { useEffect, useRef, useState } from "react";
import { s } from "../styles";
import { useT } from "../i18n/LanguageContext";
import { ModalRoot } from "./ModalRoot";
import { useInstantPress } from "../hooks/useInstantPress";

const ITEM_H = 38;     // px height of one row
const VISIBLE = 5;     // rows shown (center one is "selected")
const PAD = Math.floor(VISIBLE / 2); // spacer rows above/below so ends can center

// One scroll-snap wheel column. Scrolling settles on the centered item and
// reports it via onChange. Controlled by `value`; the initial scroll position
// is set on mount and whenever `value` changes from outside.
function WheelColumn({ items, value, onChange, ariaLabel, mono = true }) {
  const ref = useRef(null);
  const settleTimer = useRef(null);
  const idx = Math.max(0, items.indexOf(value));

  // Position to the selected row on mount + when value changes externally.
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = idx * ITEM_H;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, items.length]);

  function onScroll() {
    clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const i = Math.min(items.length - 1, Math.max(0, Math.round(el.scrollTop / ITEM_H)));
      if (items[i] !== value) onChange(items[i]);
    }, 90);
  }

  return (
    <div style={{ position: "relative", height: ITEM_H * VISIBLE, flex: 1, minWidth: 0 }}>
      <div ref={ref} className="ultreia-wheel" onScroll={onScroll}
        role="listbox" aria-label={ariaLabel}
        style={{
          height: "100%", overflowY: "auto",
          scrollSnapType: "y mandatory", overscrollBehavior: "contain",
        }}>
        <div style={{ height: ITEM_H * PAD }} />
        {items.map((it) => {
          const selected = it === value;
          return (
            <div key={it} style={{
              height: ITEM_H, scrollSnapAlign: "center",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
              fontVariantNumeric: mono ? "tabular-nums" : "normal",
              fontSize: selected ? 26 : 20,
              fontWeight: selected ? 600 : 400,
              color: selected ? "var(--ink-1)" : "var(--ink-3)",
              transition: "color 120ms, font-size 120ms",
            }}>{it}</div>
          );
        })}
        <div style={{ height: ITEM_H * PAD }} />
      </div>
      {/* Center selection band */}
      <div style={{
        position: "absolute", left: 0, right: 0, top: ITEM_H * PAD, height: ITEM_H,
        borderTop: "1px solid var(--rule)", borderBottom: "1px solid var(--rule)",
        pointerEvents: "none",
      }} />
    </div>
  );
}

// Time wheel picker — hour (00–23) + minute (00 / 30, matching the half-hour
// push slots the server fires on). Opens as a small centered modal (like the
// iOS "New alarm" sheet). `value` is "HH:MM"; Done calls onConfirm("HH:MM").
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = ["00", "30"];

export function SingleWheelModal({ value, options, onConfirm, onClose, title, ariaLabel }) {
  const t = useT();
  const normalized = (options || []).map(opt => (
    typeof opt === "object" && opt !== null
      ? { value: opt.value, label: String(opt.label) }
      : { value: opt, label: String(opt) }
  ));
  const fallback = normalized[0] || { value: "", label: "" };
  const initial = normalized.find(opt => opt.value === value) || fallback;
  const labels = normalized.map(opt => opt.label);
  const [selectedLabel, setSelectedLabel] = useState(initial.label);

  function done() {
    const picked = normalized.find(opt => opt.label === selectedLabel) || fallback;
    onConfirm(picked.value);
  }

  return (
    <ModalRoot onClose={onClose}>
      <div onClick={onClose} className="ultreia-overlay-in" style={{
        position: "fixed", inset: 0, background: "rgba(20,20,19,0.45)",
        backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 10000, padding: 16, overscrollBehavior: "contain",
      }}>
        <div onClick={e => e.stopPropagation()} className="ultreia-modal-in" style={{
          background: "var(--bg-elevated)", border: "1px solid var(--rule)",
          borderRadius: 14, boxShadow: "0 18px 50px rgba(0,0,0,0.25)",
          width: "100%", maxWidth: 320, padding: "16px 18px 18px",
          boxSizing: "border-box", fontFamily: "var(--font-sans)",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <button onClick={onClose} style={{ ...s.btnGhost, border: "none", padding: "4px 6px", color: "var(--ink-3)" }}>
              {t("common.cancel")}
            </button>
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-1)" }}>{title}</span>
            <button onClick={done} style={{ ...s.btnGhost, border: "none", padding: "4px 6px", color: "var(--moss-deep)", fontWeight: 600 }}>
              {t("common.done")}
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 34px 0" }}>
            <WheelColumn
              items={labels}
              value={selectedLabel}
              onChange={setSelectedLabel}
              ariaLabel={ariaLabel || title}
              mono={false}
            />
          </div>
        </div>
      </div>
    </ModalRoot>
  );
}

export function TimeWheelModal({ value = "08:00", onConfirm, onClose, title }) {
  const t = useT();
  const instantPress = useInstantPress();
  const [h0, m0] = String(value).split(":");
  const [hh, setHh] = useState(HOURS.includes(h0) ? h0 : "08");
  const [mm, setMm] = useState(MINUTES.includes(m0) ? m0 : "00");
  function done() { onConfirm(`${hh}:${mm}`); }

  return (
    <ModalRoot onClose={onClose}>
      <div onClick={onClose} className="ultreia-overlay-in" style={{
        position: "fixed", inset: 0, background: "rgba(20,20,19,0.45)",
        backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 10000, padding: 16, overscrollBehavior: "contain",
      }}>
        <div onClick={e => e.stopPropagation()} className="ultreia-modal-in" style={{
          background: "var(--bg-elevated)", border: "1px solid var(--rule)",
          borderRadius: 14, boxShadow: "0 18px 50px rgba(0,0,0,0.25)",
          width: "100%", maxWidth: 320, padding: "16px 18px 18px",
          boxSizing: "border-box", fontFamily: "var(--font-sans)",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <button
              {...instantPress("close", onClose)}
              style={{ ...s.btnGhost, border: "none", padding: "4px 6px", color: "var(--ink-3)" }}>
              {t("common.cancel")}
            </button>
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-1)" }}>{title || t("push.pick_time")}</span>
            <button
              {...instantPress("done", done)}
              style={{ ...s.btnGhost, border: "none", padding: "4px 6px", color: "var(--moss-deep)", fontWeight: 600 }}>
              {t("common.done")}
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 18px 0" }}>
            <WheelColumn items={HOURS} value={hh} onChange={setHh} ariaLabel="hour" />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 24, color: "var(--ink-2)", fontWeight: 600 }}>:</span>
            <WheelColumn items={MINUTES} value={mm} onChange={setMm} ariaLabel="minute" />
          </div>
        </div>
      </div>
    </ModalRoot>
  );
}
