import { splitParagraphs } from "@/lib/translation/text/paragraphs";
import { findExcerptParagraphIndex, normalizeExcerpt } from "@/lib/reader/search";
import type { ReaderBookmark, ReaderColumn } from "@/lib/reader/types";

export const READER_BOOKMARK_EXCERPT_LENGTH = 160;

const HEADER_CLEARANCE_PX = 120;
const READER_TARGET_SELECTOR = '[id^="reader-paragraph-"], [id^="reader-pair-"]';
const READER_ID_PATTERN = /^reader-(?:paragraph|pair)-(\d+)(?:-(raw|translated))?$/;

export interface ReaderParagraphTarget {
  paragraphIndex: number;
  column: ReaderColumn | null;
  element: HTMLElement;
}

export interface ReaderSelectionTarget extends ReaderParagraphTarget {
  text: string;
}

export function parseReaderParagraphId(
  id: string,
): { paragraphIndex: number; column: ReaderColumn | null } | null {
  const match = READER_ID_PATTERN.exec(id);
  if (!match) return null;
  const number = Number.parseInt(match[1], 10);
  if (!Number.isFinite(number) || number < 1) return null;
  const column = match[2] === "raw" || match[2] === "translated" ? match[2] : null;
  return { paragraphIndex: number - 1, column };
}

export function bookmarkAnchorId(paragraphIndex: number): string {
  return `reader-paragraph-${paragraphIndex + 1}`;
}

export function findReaderAnchor(anchor: string): HTMLElement | null {
  const direct = document.getElementById(anchor);
  if (direct) return direct;
  if (!READER_ID_PATTERN.test(anchor)) return null;

  const parsed = parseReaderParagraphId(anchor);
  if (!parsed) return null;

  const number = parsed.paragraphIndex + 1;
  const candidates = [
    `reader-paragraph-${number}`,
    // Compare view renders the pair as the paragraph boundary, so it anchors the paragraph start.
    `reader-pair-${number}`,
    `reader-paragraph-${number}-translated`,
    `reader-paragraph-${number}-raw`,
  ];
  for (const candidate of candidates) {
    const element = document.getElementById(candidate);
    if (element) return element;
  }
  return null;
}

export function buildBookmarkExcerpt(element: HTMLElement, text?: string): string {
  const source = normalizeExcerpt(text ?? readerTargetText(element));
  if (source.length <= READER_BOOKMARK_EXCERPT_LENGTH) return source;
  return `${source.slice(0, READER_BOOKMARK_EXCERPT_LENGTH).trimEnd()}…`;
}

// Side-by-side pairs carry their own translated cell; that text is what a reader bookmarks.
export function readerTargetText(element: HTMLElement): string {
  const translated = element.id.startsWith("reader-pair-")
    ? element.querySelector<HTMLElement>('[id$="-translated"]')
    : null;
  return (translated ?? element).textContent ?? "";
}

export function findVisibleReaderParagraph(): ReaderParagraphTarget | null {
  const elements = document.querySelectorAll<HTMLElement>(READER_TARGET_SELECTOR);
  let last: ReaderParagraphTarget | null = null;
  for (const element of elements) {
    const parsed = parseReaderParagraphId(element.id);
    if (!parsed) continue;
    const target = { paragraphIndex: parsed.paragraphIndex, column: parsed.column, element };
    if (element.getBoundingClientRect().bottom >= HEADER_CLEARANCE_PX) return target;
    last = target;
  }
  return last;
}

export function findSelectionReaderParagraph(): ReaderSelectionTarget | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const text = normalizeExcerpt(selection.toString());
  if (!text) return null;

  const range = selection.getRangeAt(0);
  const node = range.startContainer;
  const element = node instanceof Element ? node : node.parentElement;
  const paragraph = element?.closest<HTMLElement>(READER_TARGET_SELECTOR);
  if (!paragraph) return null;

  const parsed = parseReaderParagraphId(paragraph.id);
  if (!parsed) return null;
  return { ...parsed, element: paragraph, text };
}

export function resolveBookmarkTarget(): ReaderSelectionTarget | null {
  const selection = findSelectionReaderParagraph();
  if (selection) return selection;
  const visible = findVisibleReaderParagraph();
  if (!visible) return null;
  return { ...visible, text: readerTargetText(visible.element) };
}

// The bookmarked column is the one whose text the excerpt came from.
function bookmarkParagraphs(chapter: BookmarkChapter, column: ReaderColumn | null): string[] {
  if (column === "raw") return splitParagraphs(chapter.rawContent);
  const translated = chapter.translatedContent ? splitParagraphs(chapter.translatedContent) : [];
  return translated.length > 0 ? translated : splitParagraphs(chapter.rawContent);
}

export interface BookmarkChapter {
  rawContent: string;
  translatedContent: string | null;
}

// Resolves a bookmark to the paragraph it points at today: the stored index while the text
// still matches it, otherwise wherever the excerpt moved to. A failed or missing chapter
// keeps the stored index, so navigation never breaks on a stale bookmark.
export async function resolveBookmarkParagraphIndex(
  loadChapter: (chapterId: string) => Promise<BookmarkChapter | null>,
  bookmark: ReaderBookmark,
): Promise<number> {
  try {
    const chapter = await loadChapter(bookmark.chapterId);
    if (!chapter) return bookmark.paragraphIndex;
    return findExcerptParagraphIndex(
      bookmarkParagraphs(chapter, bookmark.column),
      bookmark.excerpt,
      bookmark.paragraphIndex,
    );
  } catch {
    return bookmark.paragraphIndex;
  }
}
