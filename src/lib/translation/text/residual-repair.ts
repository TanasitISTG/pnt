// Residual-hanzi span extraction + splice for the repair pass in worker.ts.
// Detection and extraction share the same character class from ./residual.

import type { HanziSpan } from "../types/text";
import { RESIDUAL_CJK_CLASS } from "./residual";

const CJK_SPAN_RE = new RegExp(`[${RESIDUAL_CJK_CLASS}]+`, "g");
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
