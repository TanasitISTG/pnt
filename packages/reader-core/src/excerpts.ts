const EXCERPT_MATCH_LENGTH = 24;

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
  const prefix = needle.slice(0, EXCERPT_MATCH_LENGTH);
  if (haystacks[fallbackIndex]?.includes(prefix)) return fallbackIndex;

  const byPrefix = haystacks.findIndex((text) => text.includes(prefix));
  if (byPrefix !== -1) return byPrefix;

  const byExcerpt = haystacks.findIndex((text) => text.includes(needle));
  if (byExcerpt !== -1) return byExcerpt;

  return clampFallback;
}
