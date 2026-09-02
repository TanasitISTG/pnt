import { normalizePair } from "../prompts/language";
import type { ResidualScriptSpan } from "../types/text";

const LETTER_RE = /\p{L}/u;
const MARK_RE = /\p{M}/u;
const NEWLINE_RE = /\r|\n/u;
const THAI_SCRIPT_RE = /\p{Script_Extensions=Thai}/u;
const LATIN_SCRIPT_RE = /\p{Script_Extensions=Latin}/u;
const SOURCE_TAG_RE = /<[^<>]+>/g;

interface ProtectedRange {
  start: number;
  end: number;
}

interface SuspectLetter {
  start: number;
  end: number;
}

interface ScanRegion {
  start: number;
  end: number;
}

function isSuspectLetter(char: string, normalizedPair: string): boolean {
  if (!LETTER_RE.test(char)) return false;
  return normalizedPair.endsWith("->th") ? !THAI_SCRIPT_RE.test(char) : !LATIN_SCRIPT_RE.test(char);
}

function addOccurrences(text: string, needle: string, ranges: ProtectedRange[]): void {
  if (!needle) return;
  let from = 0;
  while (from <= text.length - needle.length) {
    const index = text.indexOf(needle, from);
    if (index < 0) return;
    ranges.push({ start: index, end: index + needle.length });
    from = index + 1;
  }
}

function getProtectedRanges(
  text: string,
  sourceText: string | undefined,
  protectedTerms: readonly string[] | undefined,
): ProtectedRange[] {
  const ranges: ProtectedRange[] = [];
  for (const term of protectedTerms ?? []) {
    addOccurrences(text, term, ranges);
  }

  if (sourceText) {
    for (const match of sourceText.matchAll(SOURCE_TAG_RE)) {
      addOccurrences(text, match[0], ranges);
    }
  }

  ranges.sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: ProtectedRange[] = [];
  for (const range of ranges) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function getLineRegions(text: string, region: ScanRegion): ScanRegion[] {
  const lines: ScanRegion[] = [];
  let lineStart = region.start;
  for (let index = region.start; index < region.end;) {
    const codePoint = text.codePointAt(index);
    if (codePoint === undefined) break;
    const char = String.fromCodePoint(codePoint);
    const next = index + char.length;
    if (NEWLINE_RE.test(char)) {
      lines.push({ start: lineStart, end: index });
      lineStart = next;
    }
    index = next;
  }
  lines.push({ start: lineStart, end: region.end });
  return lines;
}

function getUnprotectedRegions(text: string, ranges: ProtectedRange[]): ScanRegion[] {
  const regions: ScanRegion[] = [];
  let start = 0;
  for (const range of ranges) {
    if (start < range.start) regions.push({ start, end: range.start });
    start = Math.max(start, range.end);
  }
  if (start < text.length) regions.push({ start, end: text.length });
  return regions;
}

function extendOverAdjacentMarks(
  text: string,
  start: number,
  end: number,
  line: ScanRegion,
): { start: number; end: number } {
  let extendedStart = start;
  while (extendedStart > line.start) {
    const previousStart = extendedStart - 1;
    const previousUnit = text.charCodeAt(previousStart);
    const charStart =
      previousUnit >= 0xdc00 && previousUnit <= 0xdfff ? previousStart - 1 : previousStart;
    const char = text.slice(charStart, extendedStart);
    if (!MARK_RE.test(char)) break;
    extendedStart = charStart;
  }

  let extendedEnd = end;
  while (extendedEnd < line.end) {
    const codePoint = text.codePointAt(extendedEnd);
    if (codePoint === undefined) break;
    const char = String.fromCodePoint(codePoint);
    if (!MARK_RE.test(char)) break;
    extendedEnd += char.length;
  }
  return { start: extendedStart, end: extendedEnd };
}

function scanLine(text: string, line: ScanRegion, pair: string): ResidualScriptSpan[] {
  const spans: ResidualScriptSpan[] = [];
  let suspectLetters: SuspectLetter[] = [];

  const flush = () => {
    if (suspectLetters.length === 0) return;
    const first = suspectLetters[0];
    const last = suspectLetters[suspectLetters.length - 1];
    const bounds = extendOverAdjacentMarks(text, first.start, last.end, line);
    spans.push({
      start: bounds.start,
      end: bounds.end,
      text: text.slice(bounds.start, bounds.end),
      letterCount: suspectLetters.length,
    });
    suspectLetters = [];
  };

  for (let index = line.start; index < line.end;) {
    const codePoint = text.codePointAt(index);
    if (codePoint === undefined) break;
    const char = String.fromCodePoint(codePoint);
    const next = index + char.length;
    if (LETTER_RE.test(char)) {
      if (isSuspectLetter(char, pair)) {
        suspectLetters.push({ start: index, end: next });
      } else {
        flush();
      }
    }
    index = next;
  }
  flush();
  return spans;
}

export function scanResidualScripts(
  pair: string,
  text: string,
  options?: { sourceText?: string; protectedTerms?: readonly string[] },
): { spans: ResidualScriptSpan[]; letterCount: number } {
  const normalizedPair = normalizePair(pair);
  const protectedRanges = getProtectedRanges(text, options?.sourceText, options?.protectedTerms);
  const spans: ResidualScriptSpan[] = [];
  for (const region of getUnprotectedRegions(text, protectedRanges)) {
    for (const line of getLineRegions(text, region)) {
      spans.push(...scanLine(text, line, normalizedPair));
    }
  }
  return {
    spans,
    letterCount: spans.reduce((total, span) => total + span.letterCount, 0),
  };
}
export function sourceTagsArePreserved(sourceText: string, translatedText: string): boolean {
  const sourceTags = sourceText.match(SOURCE_TAG_RE) ?? [];
  const translatedTags = translatedText.match(SOURCE_TAG_RE) ?? [];
  return (
    sourceTags.length === translatedTags.length &&
    sourceTags.every((tag, index) => translatedTags[index] === tag)
  );
}

export function spliceResidualSpans(
  text: string,
  spans: readonly ResidualScriptSpan[],
  replacements: readonly string[],
): string | null {
  if (spans.length !== replacements.length) return null;
  let out = text;
  for (let index = spans.length - 1; index >= 0; index--) {
    const span = spans[index];
    out = out.slice(0, span.start) + replacements[index] + out.slice(span.end);
  }
  return out;
}
