// Residual-hanzi span extraction + splice for the repair pass in worker.ts.
// Character class mirrors CJK_RE in ./prompts.ts — keep in sync: detection
// (findResidualSourceChars) and extraction must agree on what "hanzi" is.

const CJK_SPAN_RE = /[㐀-䶿一-鿿豈-﫿]+/g;

export interface HanziSpan {
  start: number;
  end: number; // exclusive
  text: string;
}

/** Maximal runs of CJK ideographs with offsets, in document order. */
export function extractHanziSpans(text: string): HanziSpan[] {
  const spans: HanziSpan[] = [];
  for (const m of text.matchAll(CJK_SPAN_RE)) {
    spans.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
  }
  return spans;
}

/**
 * Replace spans with translations (same order). Returns null on count mismatch.
 * Splices last-to-first so earlier offsets stay valid.
 */
export function spliceSpans(
  text: string,
  spans: HanziSpan[],
  replacements: string[],
): string | null {
  if (spans.length !== replacements.length) return null;
  let out = text;
  for (let i = spans.length - 1; i >= 0; i--) {
    const s = spans[i];
    out = out.slice(0, s.start) + replacements[i] + out.slice(s.end);
  }
  return out;
}
