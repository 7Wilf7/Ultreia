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

export function inferMemoryFactCategory(fact = {}, fallbackCategory = "other") {
  const fallback = MEMORY_SECTIONS.some(section => section.key === fallbackCategory) ? fallbackCategory : "other";
  const text = `${fact.contentZh || ""} ${fact.contentEn || ""}`.toLowerCase();
  if (!text.trim()) return fallback;

  if (
    fallback === "coaching_style" &&
    /(偏好|喜欢|希望|需要|认可|适应|不要|不喜欢).*(教练|coach|建议|指令|语气|解释|判断|回复)|决策树|若.+则/.test(text)
  ) {
    return "coaching_style";
  }
  if (/(教练风格|coaching style|语气|回复风格|指令格式|决策树|若.+则|不要夸|少废话|解释方式)/.test(text)) {
    return "coaching_style";
  }

  const raceLike = /(比赛|赛事|目标|hyrox|半马|全马|越野赛|road race|race|goal|马拉松|utmb|ccc|莫干山|深圳)/.test(text);
  const pastRaceLike = /(已完成|完成过|过去|历史|成绩|result|finished|completed)/.test(text);
  if (raceLike && !pastRaceLike) return "goals_races";

  if (/(周模板|宏观计划|训练结构|高峰周|训练量|容量|减量|器械|skierg|rowerg|雪橇|墙球|哑铃|自重|地形|白云山|火炉山|力量|有氧主课|错过的力量|不追量|easy|z1|z2|tempo|间歇|爬升|跑步稳定性|站点切换|训练偏好|training preference)/.test(text)) {
    return "training_preferences";
  }

  if (/(伤|疼|痛|不适|恢复|疲劳恢复|24.?48|晨脉|静息心率|hrv|body battery|健康|受伤|膝|踝|髋|跟腱|筋膜|风险|睡眠|营养|按摩|心率漂移|高温高湿|下坡离心|无已知伤病|ready|readiness|recovery)/.test(text)) {
    return "injury_health";
  }

  if (/(经常|总是|反复|长期|模式|遇到|会主动|不会强行|不会硬撑|已内化|倾向|生活冲突|缺课|天气|调整计划|tends to|often|recurring|pattern|when|if)/.test(text)) {
    return "recurring_patterns";
  }

  if (/(计划|training preference)/.test(text)) {
    return "training_preferences";
  }

  return fallback;
}

function normalizeMemoryFactText(text = "") {
  return String(text || "")
    .toLowerCase()
    .replace(/[，。；：、,.!?！？;:()[\]（）【】"'“”‘’`~\-—_/\\\s\u3000]/g, "")
    .replace(/(本人|用户|wilf|theuser|user)/g, "")
    .trim();
}

function memoryFactText(fact = {}) {
  return `${fact.contentZh || ""}\n${fact.contentEn || ""}`.trim();
}

function charBigrams(text = "") {
  const normalized = normalizeMemoryFactText(text);
  if (normalized.length < 2) return normalized ? [normalized] : [];
  const grams = [];
  for (let i = 0; i < normalized.length - 1; i += 1) grams.push(normalized.slice(i, i + 2));
  return grams;
}

function jaccardSimilarity(a = "", b = "") {
  const aSet = new Set(charBigrams(a));
  const bSet = new Set(charBigrams(b));
  if (!aSet.size || !bSet.size) return 0;
  let intersection = 0;
  for (const item of aSet) {
    if (bSet.has(item)) intersection += 1;
  }
  return intersection / (aSet.size + bSet.size - intersection);
}

function memoryFactSimilarity(a = {}, b = {}) {
  const aText = memoryFactText(a);
  const bText = memoryFactText(b);
  const aNorm = normalizeMemoryFactText(aText);
  const bNorm = normalizeMemoryFactText(bText);
  if (!aNorm || !bNorm) return 0;
  if (aNorm === bNorm) return 1;
  const shorter = aNorm.length <= bNorm.length ? aNorm : bNorm;
  const longer = aNorm.length > bNorm.length ? aNorm : bNorm;
  if (shorter.length >= 12 && longer.includes(shorter) && shorter.length / longer.length >= 0.58) return 0.88;
  return jaccardSimilarity(aText, bText);
}

function memoryFactKey(fact = {}) {
  return fact.rowId || fact.clientId || fact.id || "";
}

function findMemoryFactMatch(fact, candidates, usedKeys) {
  let best = null;
  let bestScore = 0;
  for (const candidate of candidates) {
    const key = memoryFactKey(candidate);
    if (!key || usedKeys.has(key)) continue;
    const score = memoryFactSimilarity(fact, candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return bestScore >= 0.72 ? best : null;
}

export function prepareMemoryFactSnapshot(incomingFacts = [], existingFacts = []) {
  const activeExisting = (Array.isArray(existingFacts) ? existingFacts : []).filter(f => f?.status === "active");
  const usedExistingKeys = new Set();
  const facts = (Array.isArray(incomingFacts) ? incomingFacts : []).map(fact => {
    const category = inferMemoryFactCategory(fact, fact.category || "other");
    const match = findMemoryFactMatch(fact, activeExisting, usedExistingKeys);
    if (!match) return { ...fact, category };
    const matchKey = memoryFactKey(match);
    if (matchKey) usedExistingKeys.add(matchKey);
    return {
      ...fact,
      id: match.id || fact.id,
      rowId: match.rowId || fact.rowId,
      clientId: match.clientId || match.id || fact.clientId || fact.id,
      category,
      acceptedAt: match.acceptedAt || fact.acceptedAt,
      proposedAt: match.proposedAt || fact.proposedAt,
      createdAt: match.createdAt || fact.createdAt,
      lastUsedAt: match.lastUsedAt || fact.lastUsedAt,
    };
  });
  const archivedFacts = activeExisting.filter(fact => {
    const key = memoryFactKey(fact);
    return key && !usedExistingKeys.has(key);
  });
  return { facts, archivedFacts };
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
    const category = inferMemoryFactCategory({ contentEn, contentZh }, currentSection);
    facts.push({
      clientId: `${opts.clientPrefix || "memory-fact"}-${currentSection}-${index}`,
      category,
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
- Return a COMPLETE, deduplicated active snapshot. Do not output only additions. If an old fact is outdated, replaced, or no longer useful, omit it.
- Use the categories strictly:
  - Injuries / Health: injuries, recovery needs, fatigue readiness, health risks, HRV/resting-HR/heart-rate risk signals.
  - Goals / Races: current target races and current race priorities only. Drop completed race results and stale targets.
  - Training Preferences: plan structure, equipment constraints, terrain, schedule preferences, training methods.
  - Coaching Style: how the user wants the coach to communicate, decide, or frame judgment.
  - Recurring Patterns: repeated behavior patterns that affect planning.
- Keep durable facts only.
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
