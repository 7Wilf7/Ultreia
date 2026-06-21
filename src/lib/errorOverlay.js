// On-screen error reporter — surfaces uncaught JS errors / promise rejections
// (and any explicitly-reported boot problems) as a red overlay, so a crash or
// hang can be SCREENSHOTTED on a device where the dev console isn't reachable
// (Android WebView in the APK). Plain DOM — no React — so it still shows even
// when React fails to mount or unmounts on a render crash. No-op until the
// first error: invisible in normal use.

let box = null;
const entries = [];

function ensureBox() {
  if (box && document.body.contains(box)) return box;
  box = document.createElement("div");
  box.setAttribute("data-error-overlay", "");
  Object.assign(box.style, {
    position: "fixed", left: "0", right: "0", top: "0", zIndex: "2147483647",
    maxHeight: "70vh", overflow: "auto",
    background: "#7a1414", color: "#fff",
    font: "12px/1.5 ui-monospace, Menlo, Consolas, monospace",
    padding: "calc(env(safe-area-inset-top, 0px) + 12px) 14px 12px",
    boxShadow: "0 4px 16px rgba(0,0,0,0.45)",
    boxSizing: "border-box",
  });

  const bar = document.createElement("div");
  Object.assign(bar.style, { display: "flex", gap: "8px", alignItems: "flex-start", marginBottom: "8px" });
  const title = document.createElement("strong");
  title.textContent = "⚠ App error — screenshot this";
  Object.assign(title.style, { flex: "1", minWidth: "0", lineHeight: "1.35" });
  const copyBtn = document.createElement("button");
  copyBtn.textContent = "Copy";
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "Close";
  for (const b of [copyBtn, closeBtn]) {
    Object.assign(b.style, {
      background: "#fff", color: "#7a1414", border: "none", borderRadius: "3px",
      padding: "8px 14px", fontSize: "12px", cursor: "pointer", minHeight: "0",
      touchAction: "manipulation", flexShrink: "0",
    });
  }
  copyBtn.onclick = () => { try { navigator.clipboard.writeText(entries.join("\n\n———\n\n")); } catch { /* clipboard blocked */ } };
  closeBtn.onclick = () => { if (box) box.remove(); box = null; };
  bar.append(title, copyBtn, closeBtn);

  const body = document.createElement("div");
  body.setAttribute("data-error-body", "");
  Object.assign(body.style, { whiteSpace: "pre-wrap", wordBreak: "break-word" });

  box.append(bar, body);
  (document.body || document.documentElement).appendChild(box);
  return box;
}

// Push a message onto the overlay (creating it if needed). Safe to call before
// the body exists — it falls back to documentElement.
export function reportError(msg) {
  try {
    entries.push(String(msg));
    const b = ensureBox();
    b.querySelector("[data-error-body]").textContent = entries.join("\n\n———\n\n");
  } catch { /* never let the reporter itself throw */ }
}

// Wire the global listeners once.
export function installErrorOverlay() {
  if (typeof window === "undefined" || window.__errOverlayInstalled) return;
  window.__errOverlayInstalled = true;

  window.addEventListener("error", (ev) => {
    const e = ev.error;
    const where = ev.filename ? `${ev.filename}:${ev.lineno}:${ev.colno}` : "";
    reportError(`${e?.name || "Error"}: ${e?.message || ev.message}\n${e?.stack || where}`);
  });
  window.addEventListener("unhandledrejection", (ev) => {
    const r = ev.reason;
    reportError(`UnhandledRejection: ${r?.message || String(r)}\n${r?.stack || ""}`);
  });
}
