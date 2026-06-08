import { useState } from "react";
import { s } from "../styles";
import { ModalRoot } from "./ModalRoot";
import { getPromptCatalog } from "../data/promptCatalog";

// Admin-only viewer for every prompt the product uses. Entry is gated by
// isAdmin (same as the invite-code modal); content comes from promptCatalog.js.
// Read-only — copy buttons let the owner lift a prompt out to tweak it.
export function PromptCatalogModal({ onClose }) {
  const entries = getPromptCatalog();
  const [copied, setCopied] = useState("");

  async function copy(id, text) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(c => (c === id ? "" : c)), 1500);
    } catch { /* clipboard blocked — long-press to select */ }
  }

  return (
    <ModalRoot onClose={onClose}>
      <div onClick={onClose} className="ts-overlay-in" style={{
        position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
        background: "rgba(20,20,19,0.45)",
        backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 9999, padding: 16, overscrollBehavior: "contain",
      }}>
        <div onClick={e => e.stopPropagation()} className="ts-modal-in" style={{
          background: "var(--bg-elevated)",
          border: "1px solid var(--rule)",
          borderRadius: 4,
          boxShadow: "0 18px 50px rgba(0,0,0,0.25)",
          width: "100%", maxWidth: 640,
          maxHeight: "calc(100dvh - 32px)",
          overflowY: "auto",
          padding: "22px 24px 20px",
          boxSizing: "border-box",
          fontFamily: "var(--font-sans)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4, position: "sticky", top: -22, background: "var(--bg-elevated)", paddingTop: 2, zIndex: 1 }}>
            <h2 style={{ fontSize: 19, fontWeight: 500, margin: 0 }}>提示词总览</h2>
            <button onClick={onClose} style={s.modalCloseBtn} aria-label="Close">×</button>
          </div>
          <p style={{ ...s.muted, marginBottom: 16, lineHeight: 1.6, fontSize: 12 }}>
            产品里所有喂给大模型 / 预填给用户的提示词。仅管理员可见。改了源码里的提示词，记得同步 <code style={{ fontFamily: "var(--font-mono)" }}>src/data/promptCatalog.js</code>。
          </p>

          {entries.map(entry => (
            <section key={entry.id} style={{
              border: "1px solid var(--rule)", borderRadius: 6,
              padding: "14px 16px", marginBottom: 14, background: "var(--bg)",
            }}>
              <h3 style={{ fontSize: 15, fontWeight: 600, margin: "0 0 6px" }}>{entry.title}</h3>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                <span style={pill}>触发：{entry.when}</span>
                <span style={{ ...pill, color: "var(--ink-3)" }}>{entry.source}</span>
              </div>
              {entry.blocks.map((b, i) => {
                const copyId = `${entry.id}-${i}`;
                return (
                  <div key={i} style={{ marginBottom: i < entry.blocks.length - 1 ? 12 : 0 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ ...s.label, fontSize: 11 }}>{b.label}</span>
                      <button onClick={() => copy(copyId, b.text)}
                        style={{ ...s.btnGhost, fontSize: 11, padding: "3px 9px", minHeight: 0 }}>
                        {copied === copyId ? "已复制" : "复制"}
                      </button>
                    </div>
                    <pre className="selectable" style={{
                      margin: 0, background: "var(--ink-1)", color: "var(--ink-inv)",
                      padding: "12px 14px", borderRadius: 6, overflowX: "auto",
                      fontFamily: "var(--font-mono)", fontSize: 11.5, lineHeight: 1.55,
                      whiteSpace: "pre-wrap", wordBreak: "break-word",
                    }}>{b.text}</pre>
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      </div>
    </ModalRoot>
  );
}

const pill = {
  fontFamily: "var(--font-mono)", fontSize: 10.5,
  padding: "3px 8px", borderRadius: 4,
  border: "1px solid var(--rule)", background: "var(--bg-elevated)",
  color: "var(--ink-2)",
};
