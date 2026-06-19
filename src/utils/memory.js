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

export const MEMORY_SECTIONS = [
  { en: "[Injuries / Health]", zh: "[伤病 / 健康]" },
  { en: "[Goals / Races]", zh: "[目标 / 比赛]" },
  { en: "[Training Preferences]", zh: "[训练偏好]" },
  { en: "[Coaching Style]", zh: "[教练风格]" },
  { en: "[Recurring Patterns]", zh: "[长期模式]" },
];

export function buildMemoryUpdatePrompt({ coachMemory = "", chatTranscript = "" } = {}) {
  const enSections = MEMORY_SECTIONS.map(s => s.en).join("\n");
  const zhSections = MEMORY_SECTIONS.map(s => s.zh).join("\n");

  return `You are updating a long-term memory file about a runner. The memory captures DURABLE, repeatedly-useful facts about the user — training patterns, preferences, injuries, recurring concerns, coaching style preferences.

Current memory (English):
${coachMemory || "(empty)"}

Recent conversation:
${chatTranscript || "(empty)"}

Guidelines:
- Keep the memory grouped under these exact English section headings:
${enSections}
- Under each heading, write one short fact per line as "- ...".
- Keep durable facts only: injuries/health constraints, goals/races, training preferences, coaching style preferences, recurring patterns.
- DROP session-specific things: today's specific question, one-off advice, temporary feelings that do not look durable.
- Don't repeat what's already in the user's profile: age, location, basic stats.
- Maximum ~500 words total. Trim older or less useful entries if needed.
- Leave a section empty if there is no durable fact for it.
- If nothing meaningful should change, return the existing memory, but normalize it into the section structure when useful.

Output the updated memory in BOTH English and Simplified Chinese — the SAME facts, SAME order, line-by-line correspondence — using EXACTLY this format and nothing else:
===EN===
${enSections}
<english facts under the relevant headings, one "- ..." fact per line>
===ZH===
${zhSections}
<中文事实放在对应标题下，每行一条 "- ..."，与英文逐行一一对应>`;
}
