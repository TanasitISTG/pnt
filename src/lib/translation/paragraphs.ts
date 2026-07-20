// Paragraph splitting/alignment for the side-by-side reader.
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

export interface AlignedParagraph {
  raw?: string;
  translated?: string;
}

// Align by index; when counts mismatch the shorter side leaves gaps at the tail.
export function alignParagraphs(rawText: string, translatedText: string): AlignedParagraph[] {
  const raw = splitParagraphs(rawText);
  const translated = splitParagraphs(translatedText);
  const len = Math.max(raw.length, translated.length);
  const out: AlignedParagraph[] = [];
  for (let i = 0; i < len; i++) {
    out.push({ raw: raw[i], translated: translated[i] });
  }
  return out;
}
