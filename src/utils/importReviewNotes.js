const DEFAULT_MAX_SELF_REVIEW_CHARS = 56;
const SELF_REVIEW_STORAGE_PREFIX = "selfreview:";

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
  void coachReply;
  const summary = shorten(compactRawSelfReview(cleaned, lang), limit);
  return summary ? `${SELF_REVIEW_STORAGE_PREFIX} ${summary}` : "";
}

export function buildImportFeelingNote(raw, lang = "zh", maxChars = DEFAULT_MAX_SELF_REVIEW_CHARS) {
  return buildImportSelfReviewNote(raw, "", lang, maxChars);
}

export function parseImportSelfReviewBody(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed) return "";
  const match = trimmed.match(/^自评\s*[:：]\s*(.+)$/)
    || trimmed.match(/^(?:self\s*review|selfreview)\s*[:：]\s*(.+)$/i);
  return match ? cleanFeelingText(match[1]) : "";
}

export function formatImportSelfReviewNoteLine(line, lang = "zh") {
  const trimmed = String(line || "").trim();
  if (!trimmed) return "";
  const body = parseImportSelfReviewBody(trimmed);
  if (!body) return trimmed;
  return lang === "zh" ? `自评：${body}` : `Self review: ${body}`;
}

export function formatWorkoutNoteForDisplay(note, lang = "zh") {
  return String(note || "")
    .split(/\r?\n/)
    .map(line => formatImportSelfReviewNoteLine(line, lang))
    .filter(Boolean)
    .join("\n")
    .trim();
}

export function mergeImportFeelingNote(existing, feelingNote) {
  const current = String(existing || "").trim();
  const note = String(feelingNote || "").trim();
  if (!note) return current || null;
  if (!current) return note;
  const noteBody = parseImportSelfReviewBody(note);
  if (noteBody && current.split(/\r?\n/).some(line => parseImportSelfReviewBody(line) === noteBody)) {
    return current;
  }
  if (current.includes(note)) return current;
  return `${current}\n${note}`;
}
