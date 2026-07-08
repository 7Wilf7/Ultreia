const DEFAULT_MAX_SELF_REVIEW_CHARS = 28;
const DEFAULT_MAX_COACH_REVIEW_CHARS = 28;
const SELF_REVIEW_STORAGE_PREFIX = "selfreview:";
const COACH_REVIEW_STORAGE_PREFIX = "coachreview:";

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

export function buildImportCoachReviewNote(raw, lang = "zh", maxChars = DEFAULT_MAX_COACH_REVIEW_CHARS) {
  const cleaned = cleanFeelingText(raw);
  if (!cleaned) return "";
  const limit = Math.max(20, Number(maxChars) || DEFAULT_MAX_COACH_REVIEW_CHARS);
  const summary = shorten(firstSentence(cleaned, lang), limit);
  return summary ? `${COACH_REVIEW_STORAGE_PREFIX} ${summary}` : "";
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

export function parseImportCoachReviewBody(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed) return "";
  const match = trimmed.match(/^教练点评\s*[:：]\s*(.+)$/)
    || trimmed.match(/^(?:coach\s*review|coachreview)\s*[:：]\s*(.+)$/i);
  return match ? cleanFeelingText(match[1]) : "";
}

export function formatImportSelfReviewNoteLine(line, lang = "zh") {
  const trimmed = String(line || "").trim();
  if (!trimmed) return "";
  const body = parseImportSelfReviewBody(trimmed);
  if (!body) return trimmed;
  return lang === "zh" ? `自评：${body}` : `Self review: ${body}`;
}

export function formatImportCoachReviewNoteLine(line, lang = "zh") {
  const trimmed = String(line || "").trim();
  if (!trimmed) return "";
  const body = parseImportCoachReviewBody(trimmed);
  if (!body) return trimmed;
  return lang === "zh" ? `教练点评：${body}` : `Coach review: ${body}`;
}

export function formatWorkoutReviewNoteParts(note, lang = "zh") {
  const parts = {
    other: "",
    selfReview: "",
    coachReview: "",
  };
  const otherLines = [];
  for (const line of String(note || "").split(/\r?\n/)) {
    const trimmed = String(line || "").trim();
    if (!trimmed) continue;
    const selfReview = parseImportSelfReviewBody(trimmed);
    if (selfReview) {
      if (!parts.selfReview) parts.selfReview = shorten(selfReview, DEFAULT_MAX_SELF_REVIEW_CHARS);
      continue;
    }
    const coachReview = parseImportCoachReviewBody(trimmed);
    if (coachReview) {
      if (!parts.coachReview) parts.coachReview = shorten(coachReview, DEFAULT_MAX_COACH_REVIEW_CHARS);
      continue;
    }
    otherLines.push(trimmed);
  }
  parts.other = otherLines.join("\n").trim();
  void lang;
  return parts;
}

export function formatWorkoutNoteForDisplay(note, lang = "zh") {
  const parts = formatWorkoutReviewNoteParts(note, lang);
  return [
    parts.other,
    parts.selfReview ? formatImportSelfReviewNoteLine(`${SELF_REVIEW_STORAGE_PREFIX} ${parts.selfReview}`, lang) : "",
    parts.coachReview ? formatImportCoachReviewNoteLine(`${COACH_REVIEW_STORAGE_PREFIX} ${parts.coachReview}`, lang) : "",
  ].filter(Boolean).join("\n").trim();
}

function mergePrefixedReviewNote(existing, nextNote, parseBody) {
  const current = String(existing || "").trim();
  const note = String(nextNote || "").trim();
  if (!note) return current || null;
  if (!current) return note;
  const noteBody = parseBody(note);
  const currentLines = current.split(/\r?\n/);
  if (noteBody && currentLines.some(line => parseBody(line) === noteBody)) {
    return current;
  }
  if (current.includes(note)) return current;
  if (!noteBody) return `${current}\n${note}`;
  let replaced = false;
  const merged = [];
  for (const line of currentLines) {
    if (parseBody(line)) {
      if (!replaced) {
        merged.push(note);
        replaced = true;
      }
      continue;
    }
    merged.push(line);
  }
  if (!replaced) merged.push(note);
  return merged.filter(line => String(line || "").trim()).join("\n") || null;
}

export function mergeImportFeelingNote(existing, feelingNote) {
  return mergePrefixedReviewNote(existing, feelingNote, parseImportSelfReviewBody);
}

export function mergeImportCoachReviewNote(existing, coachReviewNote) {
  return mergePrefixedReviewNote(existing, coachReviewNote, parseImportCoachReviewBody);
}
