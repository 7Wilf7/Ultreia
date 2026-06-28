const DEFAULT_MAX_SELF_REVIEW_CHARS = 56;

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

export function buildImportSelfReviewNote(raw, coachReply = "", lang = "zh", maxChars = DEFAULT_MAX_SELF_REVIEW_CHARS) {
  const cleaned = cleanFeelingText(raw);
  if (!cleaned) return "";
  const limit = Math.max(20, Number(maxChars) || DEFAULT_MAX_SELF_REVIEW_CHARS);
  const prefix = lang === "zh" ? "自评：" : "Self review: ";
  const bodyLimit = Math.max(20, limit - prefix.length);
  void coachReply;
  const summary = shorten(compactRawSelfReview(cleaned, lang), bodyLimit);
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
