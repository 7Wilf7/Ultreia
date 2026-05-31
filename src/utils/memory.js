// Split an LLM memory reply into aligned English + Chinese halves using the
// ===EN=== / ===ZH=== markers. Falls back to using the whole text for both
// languages if the model didn't emit the markers. Lives in its own module
// (not in AICoachTab) so both the tab and the app-level memory-update flow can
// import it without tripping react-refresh's "components-only export" rule.
export function parseBilingualMemory(text) {
  const parts = (text || "").split(/===\s*ZH\s*===/i);
  if (parts.length >= 2) {
    const en = parts[0].replace(/===\s*EN\s*===/i, "").trim();
    const zh = parts.slice(1).join("").replace(/===\s*EN\s*===/i, "").trim();
    if (en || zh) return { en: en || zh, zh: zh || en };
  }
  const plain = (text || "").replace(/===\s*(EN|ZH)\s*===/ig, "").trim();
  return { en: plain, zh: plain };
}
