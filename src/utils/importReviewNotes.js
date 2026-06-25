const DEFAULT_MAX_FEELING_CHARS = 120;

function cleanFeelingText(raw) {
  return String(raw || "")
    .replace(/[*_`>#-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildImportFeelingNote(raw, lang = "zh", maxChars = DEFAULT_MAX_FEELING_CHARS) {
  const cleaned = cleanFeelingText(raw);
  if (!cleaned) return "";
  const limit = Math.max(20, Number(maxChars) || DEFAULT_MAX_FEELING_CHARS);
  const summary = cleaned.length > limit ? `${cleaned.slice(0, limit - 3).trim()}...` : cleaned;
  const prefix = lang === "zh" ? "导入自评：" : "Import self-review: ";
  return `${prefix}${summary}`;
}

export function mergeImportFeelingNote(existing, feelingNote) {
  const current = String(existing || "").trim();
  const note = String(feelingNote || "").trim();
  if (!note) return current || null;
  if (!current) return note;
  if (current.includes(note)) return current;
  return `${current}\n${note}`;
}
