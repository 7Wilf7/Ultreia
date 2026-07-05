function commonSuffixLength(a, b, prefixLength) {
  let len = 0;
  const max = Math.min(a.length, b.length) - prefixLength;
  while (
    len < max
    && a[a.length - 1 - len] === b[b.length - 1 - len]
  ) {
    len += 1;
  }
  return len;
}

function repeatedHalf(value) {
  if (value.length < 6 || value.length % 2 !== 0) return "";
  const half = value.length / 2;
  const first = value.slice(0, half);
  if (first.trim().length < 3) return "";
  return first === value.slice(half) ? first : "";
}

function isInsertInput(inputType = "") {
  return String(inputType || "").startsWith("insert");
}

export function normalizeComposerTextChange(previousValue, rawNextValue, options = {}) {
  const previous = String(previousValue ?? "");
  const rawNext = String(rawNextValue ?? "");
  const inputType = String(options.inputType || "");
  const selectionStart = Number.isFinite(options.selectionStart)
    ? options.selectionStart
    : null;

  if (!isInsertInput(inputType) || inputType === "insertFromPaste" || rawNext.length <= previous.length) {
    return { value: rawNext, selectionStart, changed: false };
  }

  let prefixLength = 0;
  while (
    prefixLength < previous.length
    && prefixLength < rawNext.length
    && previous[prefixLength] === rawNext[prefixLength]
  ) {
    prefixLength += 1;
  }

  const suffixLength = commonSuffixLength(previous, rawNext, prefixLength);
  const insertedEnd = rawNext.length - suffixLength;
  const inserted = rawNext.slice(prefixLength, insertedEnd);
  if (inserted.trim().length < 3) {
    return { value: rawNext, selectionStart, changed: false };
  }

  const halfReplacement = repeatedHalf(inserted);
  const previousChunk = previous.slice(Math.max(0, prefixLength - inserted.length), prefixLength);
  const replacement = halfReplacement || (previousChunk === inserted ? "" : null);
  if (replacement == null) return { value: rawNext, selectionStart, changed: false };

  const nextValue = rawNext.slice(0, prefixLength) + replacement + rawNext.slice(insertedEnd);
  const removedLength = rawNext.length - nextValue.length;
  const nextSelectionStart = selectionStart == null
    ? null
    : Math.max(prefixLength + replacement.length, selectionStart - removedLength);

  return {
    value: nextValue,
    selectionStart: nextSelectionStart,
    changed: true,
  };
}
