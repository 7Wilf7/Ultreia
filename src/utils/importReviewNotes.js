const DEFAULT_MAX_SELF_REVIEW_CHARS = 120;

const SELF_REVIEW_KEYWORDS = {
  zh: ["自评", "感觉", "状态", "恢复", "疲劳", "腿", "心率", "rpe", "配速", "强度", "保留", "降量", "取消", "调整", "下次", "建议"],
  en: ["selfreview", "self-review", "feel", "felt", "state", "recovery", "fatigue", "legs", "heart", "rpe", "pace", "intensity", "keep", "reduce", "cancel", "adjust", "next", "suggest"],
};

function cleanFeelingText(raw) {
  return String(raw || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[*_`>#-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shorten(text, maxChars) {
  const limit = Math.max(20, Number(maxChars) || DEFAULT_MAX_SELF_REVIEW_CHARS);
  const cleaned = cleanFeelingText(text);
  return cleaned.length > limit ? `${cleaned.slice(0, limit - 3).trim()}...` : cleaned;
}

function firstSentence(text, lang) {
  const cleaned = cleanFeelingText(text);
  if (!cleaned) return "";
  const parts = cleaned
    .split(lang === "zh" ? /[。！？!?；;]+/ : /[.!?;]+/)
    .map(part => part.trim())
    .filter(Boolean);
  return parts[0] || cleaned;
}

function compactRawSelfReview(text, lang) {
  const sentence = firstSentence(text, lang);
  if (!sentence) return "";
  const parts = sentence
    .split(lang === "zh" ? /[，,、]+/ : /[,]+/)
    .map(part => part.trim())
    .filter(Boolean);
  if (parts.length <= 2) return sentence;
  return parts.slice(0, 2).join(lang === "zh" ? "，" : ", ");
}

function pickCoachSelfReviewLine(coachReply, lang) {
  const cleaned = cleanFeelingText(coachReply);
  if (!cleaned) return "";
  const keywords = SELF_REVIEW_KEYWORDS[lang] || SELF_REVIEW_KEYWORDS.en;
  const parts = cleaned
    .split(lang === "zh" ? /[。！？!?；;]+/ : /[.!?;]+/)
    .map(part => part.trim())
    .filter(Boolean);
  return parts.find(part => {
    const lower = part.toLowerCase();
    return keywords.some(keyword => lower.includes(keyword));
  }) || "";
}

export function buildImportSelfReviewNote(raw, coachReply = "", lang = "zh", maxChars = DEFAULT_MAX_SELF_REVIEW_CHARS) {
  const cleaned = cleanFeelingText(raw);
  if (!cleaned) return "";
  const limit = Math.max(20, Number(maxChars) || DEFAULT_MAX_SELF_REVIEW_CHARS);
  const rawLimit = Math.min(56, Math.max(24, Math.floor(limit * 0.46)));
  const rawSummary = shorten(compactRawSelfReview(cleaned, lang), rawLimit);
  const coachLine = pickCoachSelfReviewLine(coachReply, lang);
  const separator = lang === "zh" ? "；" : "; ";
  const remaining = Math.max(20, limit - rawSummary.length - separator.length);
  const summary = coachLine
    ? shorten(`${rawSummary}${separator}${shorten(coachLine, remaining)}`, limit)
    : shorten(rawSummary, limit);
  const prefix = lang === "zh" ? "自评：" : "selfreview: ";
  return `${prefix}${summary}`;
}

export function buildImportFeelingNote(raw, lang = "zh", maxChars = DEFAULT_MAX_SELF_REVIEW_CHARS) {
  return buildImportSelfReviewNote(raw, "", lang, maxChars);
}

export function mergeImportFeelingNote(existing, feelingNote) {
  const current = String(existing || "").trim();
  const note = String(feelingNote || "").trim();
  if (!note) return current || null;
  if (!current) return note;
  if (current.includes(note)) return current;
  return `${current}\n${note}`;
}
