export const PARAGRAPH_MARKER = "||¶||";

// The LLM frequently mangles the marker (||¶|, ||¶¶||, ¶||, ...). A pilcrow
// never appears in real prose, so any run of pipes around pilcrows is a marker.
const MARKER_PATTERN = /\|*¶+\|*/g;

/** Replace blank-line paragraph breaks with a unique marker the LLM must preserve. */
export function injectParagraphMarkers(text: string): string {
  return text.replace(/\n\s*\n+/g, `\n${PARAGRAPH_MARKER}\n`);
}

/** Restore markers (including model-mangled variants) back to blank-line breaks. */
export function restoreParagraphMarkers(text: string): string {
  return normalizeTranslationOutput(text.replace(MARKER_PATTERN, "\n\n"));
}

/** Count paragraph markers, tolerating model-mangled variants. */
export function countParagraphMarkers(text: string): number {
  return (text.match(MARKER_PATTERN) ?? []).length;
}

/** Collapse runs of 2+ dot-like characters into a single ellipsis '…'. */
export function normalizePunctuation(text: string): string {
  return text.replace(/[.·‥…⋯⋅・⸰．‧]{2,}/g, "…");
}

/** Normalize CRLF, duplicate blank lines, leading/trailing whitespace, chunk boundaries, dot artifacts. */
export function normalizeTranslationOutput(text: string): string {
  const normalized = text
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .trim();
  return normalizePunctuation(normalized);
}
