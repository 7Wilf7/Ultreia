export function normalizeAnnotationText(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

export function buildAnnotatedDiscussionMessage({
  intro = "",
  sourceTitle = "",
  sourceText = "",
  extraText = "",
  annotations = [],
} = {}) {
  const parts = [];
  const cleanIntro = normalizeAnnotationText(intro);
  const cleanSourceTitle = normalizeAnnotationText(sourceTitle);
  const cleanSourceText = normalizeAnnotationText(sourceText);
  const cleanExtra = normalizeAnnotationText(extraText);
  const cleanAnnotations = (Array.isArray(annotations) ? annotations : [])
    .map((a, idx) => ({
      quote: normalizeAnnotationText(a?.quote),
      note: normalizeAnnotationText(a?.note),
      sourceLabel: normalizeAnnotationText(a?.sourceLabel),
      index: idx + 1,
    }))
    .filter(a => a.quote || a.note);

  if (cleanIntro) parts.push(cleanIntro);
  if (cleanExtra) parts.push(["【我的补充】", cleanExtra].join("\n"));
  if (cleanAnnotations.length) {
    parts.push([
      "【我标注的片段】",
      cleanAnnotations.map(a => {
        const lines = [`${a.index}. ${a.sourceLabel || "引用片段"}`];
        if (a.quote) lines.push(`引用：\n> ${a.quote.replace(/\n/g, "\n> ")}`);
        if (a.note) lines.push(`我的注解：${a.note}`);
        return lines.join("\n");
      }).join("\n\n"),
    ].join("\n"));
  }
  if (cleanSourceTitle || cleanSourceText) {
    parts.push([
      cleanSourceTitle ? `【${cleanSourceTitle}】` : "【原文】",
      cleanSourceText,
    ].filter(Boolean).join("\n"));
  }
  return parts.filter(Boolean).join("\n\n");
}
