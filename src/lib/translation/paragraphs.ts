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

export const PARAGRAPH_MARKER = "||¶||";

/** Replace blank-line paragraph breaks with a unique marker the LLM must preserve. */
export function injectParagraphMarkers(text: string): string {
  return text.replace(/\n\s*\n+/g, `\n${PARAGRAPH_MARKER}\n`);
}

/** Restore markers back to blank-line breaks and normalize output. */
export function restoreParagraphMarkers(text: string): string {
  return normalizeTranslationOutput(text.replaceAll(PARAGRAPH_MARKER, "\n\n"));
}

/** Count how many paragraph markers appear in the text. */
export function countParagraphMarkers(text: string): number {
  let count = 0;
  let pos = 0;
  while ((pos = text.indexOf(PARAGRAPH_MARKER, pos)) !== -1) {
    count++;
    pos += PARAGRAPH_MARKER.length;
  }
  return count;
}

/** Normalize CRLF, duplicate blank lines, leading/trailing whitespace, chunk boundaries. */
export function normalizeTranslationOutput(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .trim();
}
