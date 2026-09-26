export interface AlignedParagraph {
  raw?: string;
  translated?: string;
}

export function splitParagraphs(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  // Preferred: blank-line separated paragraphs.
  const blankSplit = trimmed
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (blankSplit.length > 1) return blankSplit;
  // Fallback: single newlines (common in ZH source text).
  const lineSplit = trimmed
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  return lineSplit.length > 0 ? lineSplit : [trimmed];
}

export function alignParagraphArrays(
  raw: readonly string[],
  translated: readonly string[],
): AlignedParagraph[] {
  const len = Math.max(raw.length, translated.length);
  const out: AlignedParagraph[] = [];
  for (let i = 0; i < len; i++) {
    out.push({ raw: raw[i], translated: translated[i] });
  }
  return out;
}

// Align by index; when counts mismatch the shorter side leaves gaps at the tail.
export function alignParagraphs(rawText: string, translatedText: string): AlignedParagraph[] {
  return alignParagraphArrays(splitParagraphs(rawText), splitParagraphs(translatedText));
}
