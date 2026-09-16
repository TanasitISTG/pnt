import type { ReaderColumn, ReaderViewMode } from "./types";

export const READER_SEARCH_MATCH_LIMIT = 500;
export const READER_SEARCH_ACTIVE_MARK_ID = "reader-search-active";
export const READER_EXCERPT_MATCH_LENGTH = 24;

export function normalizeExcerpt(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeForMatch(text: string): string {
  return normalizeExcerpt(text).replace(/…$/, "").toLowerCase();
}

// Bookmarked excerpts survive re-translation and edits: the stored paragraph index is kept
// only while it still holds the excerpt, otherwise the text is located again.
export function findExcerptParagraphIndex(
  paragraphs: readonly string[],
  excerpt: string,
  fallbackIndex: number,
): number {
  if (paragraphs.length === 0) return 0;

  const clampFallback = Math.max(0, Math.min(paragraphs.length - 1, fallbackIndex));
  const needle = normalizeForMatch(excerpt);
  if (!needle) return clampFallback;

  const haystacks = paragraphs.map(normalizeForMatch);
  const prefix = needle.slice(0, READER_EXCERPT_MATCH_LENGTH);
  if (haystacks[fallbackIndex]?.includes(prefix)) return fallbackIndex;

  const byPrefix = haystacks.findIndex((text) => text.includes(prefix));
  if (byPrefix !== -1) return byPrefix;

  const byExcerpt = haystacks.findIndex((text) => text.includes(needle));
  if (byExcerpt !== -1) return byExcerpt;

  return clampFallback;
}

export interface ReaderSearchTarget {
  paragraphIndex: number;
  column: ReaderColumn | null;
  text: string;
}

export interface ReaderSearchMatch {
  paragraphIndex: number;
  column: ReaderColumn | null;
  start: number;
  end: number;
}

export interface ReaderSearchRange {
  start: number;
  end: number;
}

export interface ReaderParagraphHighlights {
  ranges: ReaderSearchRange[];
  activeRange: ReaderSearchRange | null;
}

export function findTextMatches(text: string, query: string): ReaderSearchRange[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const haystack = text.toLowerCase();
  const ranges: ReaderSearchRange[] = [];
  let from = 0;
  while (ranges.length < READER_SEARCH_MATCH_LIMIT) {
    const index = haystack.indexOf(needle, from);
    if (index === -1) break;
    ranges.push({ start: index, end: index + needle.length });
    from = index + needle.length;
  }
  return ranges;
}

export function collectReaderSearchMatches(
  targets: readonly ReaderSearchTarget[],
  query: string,
): ReaderSearchMatch[] {
  if (!query.trim()) return [];
  const matches: ReaderSearchMatch[] = [];
  for (const target of targets) {
    for (const range of findTextMatches(target.text, query)) {
      matches.push({
        paragraphIndex: target.paragraphIndex,
        column: target.column,
        start: range.start,
        end: range.end,
      });
      if (matches.length >= READER_SEARCH_MATCH_LIMIT) return matches;
    }
  }
  return matches;
}

interface BuildReaderSearchTargetsInput {
  viewMode: ReaderViewMode;
  hasTranslation: boolean;
  rawParagraphs: readonly string[];
  translatedParagraphs: readonly string[];
  aligned: readonly { raw?: string | null; translated?: string | null }[];
}

export function buildReaderSearchTargets({
  viewMode,
  hasTranslation,
  rawParagraphs,
  translatedParagraphs,
  aligned,
}: BuildReaderSearchTargetsInput): ReaderSearchTarget[] {
  if (!hasTranslation) {
    return rawParagraphs.map((text, paragraphIndex) => ({
      paragraphIndex,
      column: null,
      text,
    }));
  }

  if (viewMode === "side") {
    const targets: ReaderSearchTarget[] = [];
    aligned.forEach((pair, paragraphIndex) => {
      if (pair.raw) targets.push({ paragraphIndex, column: "raw", text: pair.raw });
      if (pair.translated)
        targets.push({ paragraphIndex, column: "translated", text: pair.translated });
    });
    return targets;
  }

  const paragraphs = viewMode === "translated" ? translatedParagraphs : rawParagraphs;
  return paragraphs.map((text, paragraphIndex) => ({ paragraphIndex, column: null, text }));
}

export function highlightsForParagraph(
  matches: readonly ReaderSearchMatch[],
  activeIndex: number,
  paragraphIndex: number,
  column: ReaderColumn | null,
): ReaderParagraphHighlights | undefined {
  const ranges: ReaderSearchRange[] = [];
  let activeRange: ReaderSearchRange | null = null;

  matches.forEach((match, index) => {
    if (match.paragraphIndex !== paragraphIndex) return;
    if (match.column !== column) return;
    const range = { start: match.start, end: match.end };
    ranges.push(range);
    if (index === activeIndex) activeRange = range;
  });

  if (ranges.length === 0) return undefined;
  return { ranges, activeRange };
}
