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
  { key: "injury_health", en: "[Injuries / Health]", zh: "[伤病 / 健康]" },
  { key: "goals_races", en: "[Goals / Races]", zh: "[目标 / 比赛]" },
  { key: "training_preferences", en: "[Training Preferences]", zh: "[训练偏好]" },
  { key: "coaching_style", en: "[Coaching Style]", zh: "[教练风格]" },
  { key: "recurring_patterns", en: "[Recurring Patterns]", zh: "[长期模式]" },
];

export function isMemorySectionHeading(line = "") {
  const normalized = String(line || "").trim();
  return MEMORY_SECTIONS.some(s => s.en === normalized || s.zh === normalized);
}

function normalizeMemoryFactLine(line = "") {
  return String(line || "").replace(/^[-*]\s*/, "").trim();
}

function isEmptyMemoryFact(line = "") {
  const normalized = normalizeMemoryFactLine(line).toLowerCase();
  return !normalized || normalized === "none" || normalized === "无";
}

export function extractMemoryFacts(memory = {}, opts = {}) {
  const enLines = String(memory.en || "").split("\n").map(line => line.trim()).filter(Boolean);
  const zhLines = String(memory.zh || "").split("\n").map(line => line.trim()).filter(Boolean);
  const aligned = enLines.length === zhLines.length && enLines.length > 0;
  const primaryLines = enLines.length ? enLines : zhLines;
  const primaryLang = enLines.length ? "en" : "zh";
  const facts = [];
  let currentSection = "other";

  primaryLines.forEach((line, index) => {
    const zhLine = aligned ? zhLines[index] : (primaryLang === "zh" ? line : "");
    const section = MEMORY_SECTIONS.find(s => s.en === line || s.zh === line || s.zh === zhLine);
    if (section) {
      currentSection = section.key;
      return;
    }
    if (isMemorySectionHeading(line) || isMemorySectionHeading(zhLine)) return;

    const contentEn = normalizeMemoryFactLine(line);
    const contentZh = normalizeMemoryFactLine(zhLine);
    if (isEmptyMemoryFact(contentEn) && isEmptyMemoryFact(contentZh)) return;
    facts.push({
      clientId: `${opts.clientPrefix || "memory-fact"}-${currentSection}-${index}`,
      category: currentSection,
      contentEn: primaryLang === "zh" && !aligned ? "" : contentEn,
      contentZh: contentZh || contentEn,
      source: opts.source || "ai_coach_memory",
      sourceRefType: opts.sourceRefType || null,
      sourceRefId: opts.sourceRefId || null,
      sourceSummary: opts.sourceSummary || "",
      confidence: opts.confidence || "user_confirmed",
      status: opts.status || "active",
      metadata: {
        sourceMessageCount: Number(opts.sourceMessageCount || 0),
        memoryActionId: opts.memoryActionId || null,
      },
    });
  });

  return facts;
}

export function fillEmptyMemorySections(text = "", lang = "en") {
  const sections = MEMORY_SECTIONS.map(s => lang === "zh" ? s.zh : s.en);
  const emptyFact = lang === "zh" ? "- 无" : "- None";
  const lines = String(text || "").split("\n").map(l => l.replace(/\s+$/, ""));
  const out = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    out.push(line);
    if (!sections.includes(line.trim())) continue;

    let hasFact = false;
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = lines[j].trim();
      if (sections.includes(next)) break;
      if (next) hasFact = true;
    }
    if (!hasFact) out.push(emptyFact);
  }

  return out.join("\n").trim();
}

function formatExistingMemoryFacts(memoryFacts = []) {
  const active = Array.isArray(memoryFacts)
    ? memoryFacts.filter(f => f?.status === "active")
    : [];
  if (!active.length) return "(empty)";
  return active
    .map(f => {
      const category = f.category || "other";
      const en = String(f.contentEn || f.contentZh || "").trim();
      const zh = String(f.contentZh || f.contentEn || "").trim();
      return `- [${category}] EN: ${en || "(empty)"} | ZH: ${zh || "(empty)"}`;
    })
    .join("\n");
}

export function buildMemoryUpdatePrompt({ memoryFacts = [], chatTranscript = "" } = {}) {
  const enSections = MEMORY_SECTIONS.map(s => s.en).join("\n");
  const zhSections = MEMORY_SECTIONS.map(s => s.zh).join("\n");

  return `You are updating reviewed long-term Memory fact cards about a runner. The facts capture DURABLE, repeatedly-useful information about the user — training patterns, preferences, injuries, recurring concerns, coaching style preferences.

Existing active Memory facts:
${formatExistingMemoryFacts(memoryFacts)}

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
- If nothing meaningful should change, return the existing facts, but normalize them into the section structure when useful.

Output the updated Memory facts in BOTH English and Simplified Chinese — the SAME facts, SAME order, line-by-line correspondence — using EXACTLY this format and nothing else:
===EN===
${enSections}
<english facts under the relevant headings, one "- ..." fact per line>
===ZH===
${zhSections}
<中文事实放在对应标题下，每行一条 "- ..."，与英文逐行一一对应>`;
}
