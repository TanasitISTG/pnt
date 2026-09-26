// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { normalizeExcerpt } from "@pnt/reader-core/excerpts";
import type { ReaderBookmark } from "@pnt/contracts/reader";
import {
  bookmarkAnchorId,
  buildBookmarkExcerpt,
  findReaderAnchor,
  findSelectionReaderParagraph,
  findVisibleReaderParagraph,
  parseReaderParagraphId,
  READER_BOOKMARK_EXCERPT_LENGTH,
  readerTargetText,
  resolveBookmarkParagraphIndex,
  resolveBookmarkTarget,
} from "./reader-anchors";

function appendParagraph(id: string, text: string, top: number, bottom: number) {
  const element = document.createElement("p");
  element.id = id;
  element.textContent = text;
  element.getBoundingClientRect = () =>
    ({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top }) as DOMRect;
  document.body.append(element);
  return element;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("parseReaderParagraphId", () => {
  it("maps paragraph, pair and column ids to a zero-based index", () => {
    expect(parseReaderParagraphId("reader-paragraph-1")).toEqual({
      paragraphIndex: 0,
      column: null,
    });
    expect(parseReaderParagraphId("reader-pair-12")).toEqual({
      paragraphIndex: 11,
      column: null,
    });
    expect(parseReaderParagraphId("reader-paragraph-4-raw")).toEqual({
      paragraphIndex: 3,
      column: "raw",
    });
    expect(parseReaderParagraphId("reader-paragraph-4-translated")).toEqual({
      paragraphIndex: 3,
      column: "translated",
    });
  });

  it("rejects unrelated or out-of-range ids", () => {
    expect(parseReaderParagraphId("reader-paragraph-0")).toBeNull();
    expect(parseReaderParagraphId("chapter-3")).toBeNull();
    expect(parseReaderParagraphId("reader-paragraph-abc")).toBeNull();
  });

  it("builds the anchor id the bookmarks list navigates with", () => {
    expect(bookmarkAnchorId(0)).toBe("reader-paragraph-1");
    expect(bookmarkAnchorId(41)).toBe("reader-paragraph-42");
  });
});

describe("findReaderAnchor", () => {
  it("resolves any view variant of a paragraph index", () => {
    const translated = appendParagraph("reader-paragraph-3-translated", "translated", 0, 10);
    expect(findReaderAnchor("reader-paragraph-3")).toBe(translated);
  });

  it("falls back to the comparison pair for side-by-side layouts", () => {
    const pair = appendParagraph("reader-pair-3", "pair", 0, 10);
    expect(findReaderAnchor("reader-paragraph-3")).toBe(pair);
    expect(findReaderAnchor("reader-paragraph-3-raw")).toBe(pair);
  });

  it("prefers the pair boundary over a single column of a comparison", () => {
    appendParagraph("reader-paragraph-3-raw", "source", 0, 10);
    appendParagraph("reader-paragraph-3-translated", "translation", 0, 10);
    const pair = appendParagraph("reader-pair-3", "pair", 0, 10);

    expect(findReaderAnchor("reader-paragraph-3")).toBe(pair);
  });

  it("returns null for anchors that are not reader paragraphs", () => {
    expect(findReaderAnchor("reader-search-active")).toBeNull();
  });
});

describe("bookmark capture", () => {
  it("prefers the paragraph at the top of the viewport", () => {
    appendParagraph("reader-paragraph-1", "first", 0, 40);
    appendParagraph("reader-paragraph-2", "second", 200, 260);
    appendParagraph("reader-paragraph-3", "third", 400, 460);

    expect(findVisibleReaderParagraph()?.paragraphIndex).toBe(1);
  });

  it("falls back to the last paragraph once the reader scrolled past everything", () => {
    appendParagraph("reader-paragraph-1", "first", -400, -300);
    appendParagraph("reader-paragraph-2", "second", -200, -100);

    expect(findVisibleReaderParagraph()?.paragraphIndex).toBe(1);
  });

  it("reads the translated cell of a comparison pair", () => {
    const pair = document.createElement("div");
    pair.id = "reader-pair-2";
    const raw = document.createElement("p");
    raw.id = "reader-paragraph-2-raw";
    raw.textContent = "source text";
    const translated = document.createElement("p");
    translated.id = "reader-paragraph-2-translated";
    translated.textContent = "translated text";
    pair.append(raw, translated);
    pair.getBoundingClientRect = () => ({ top: 200, bottom: 260 }) as DOMRect;
    document.body.append(pair);

    const target = findVisibleReaderParagraph();
    expect(target?.paragraphIndex).toBe(1);
    expect(target?.column).toBeNull();
    expect(readerTargetText(target!.element)).toBe("translated text");
  });

  it("uses the current selection when it sits inside a reader paragraph", () => {
    const paragraph = appendParagraph("reader-paragraph-5", "selected sentence here", 300, 360);
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const target = findSelectionReaderParagraph();
    expect(target).toMatchObject({
      paragraphIndex: 4,
      column: null,
      text: "selected sentence here",
    });

    selection?.removeAllRanges();
  });

  it("falls back to the visible paragraph when nothing is selected", () => {
    appendParagraph("reader-paragraph-2", "visible paragraph", 200, 260);

    const target = resolveBookmarkTarget();
    expect(target).toMatchObject({ paragraphIndex: 1, text: "visible paragraph" });
    expect(findSelectionReaderParagraph()).toBeNull();
  });

  it("normalizes and caps the stored excerpt", () => {
    const element = document.createElement("p");
    element.textContent = `  spaced\n\n text ${"x".repeat(READER_BOOKMARK_EXCERPT_LENGTH * 2)}  `;

    expect(normalizeExcerpt(" a\n b ")).toBe("a b");
    const excerpt = buildBookmarkExcerpt(element);
    expect(excerpt.startsWith("spaced text x")).toBe(true);
    expect(excerpt.endsWith("…")).toBe(true);
    expect(excerpt.length).toBeLessThanOrEqual(READER_BOOKMARK_EXCERPT_LENGTH + 1);
  });
});

function bookmarkFixture(overrides: Partial<ReaderBookmark> = {}): ReaderBookmark {
  return {
    id: "bookmark-1",
    chapterId: "chapter-1",
    paragraphIndex: 1,
    column: null,
    excerpt: "target paragraph",
    note: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function chapterLoader(chapter: {
  rawContent: string;
  translatedContent: string | null;
}): (chapterId: string) => Promise<{ rawContent: string; translatedContent: string | null }> {
  return async () => chapter;
}

describe("resolveBookmarkParagraphIndex", () => {
  it("keeps the stored index when the translated paragraphs still match", async () => {
    const index = await resolveBookmarkParagraphIndex(
      chapterLoader({
        rawContent: "raw one\nraw two\nraw three",
        translatedContent: "หนึ่ง\nสอง\ntarget paragraph",
      }),
      bookmarkFixture(),
    );

    expect(index).toBe(2);
  });

  it("recovers the moved paragraph from the translated column", async () => {
    const index = await resolveBookmarkParagraphIndex(
      chapterLoader({
        rawContent: "raw",
        translatedContent: "inserted opener\ntarget paragraph\ntail",
      }),
      bookmarkFixture(),
    );

    expect(index).toBe(1);
  });

  it("reads the raw column for raw bookmarks", async () => {
    const index = await resolveBookmarkParagraphIndex(
      chapterLoader({
        rawContent: "inserted opener\ntarget paragraph",
        translatedContent: "one\ntwo",
      }),
      bookmarkFixture({ column: "raw" }),
    );

    expect(index).toBe(1);
  });

  it("falls back to the raw text when the translation was cleared", async () => {
    const index = await resolveBookmarkParagraphIndex(
      chapterLoader({ rawContent: "target paragraph\nsecond", translatedContent: null }),
      bookmarkFixture({ column: "translated", paragraphIndex: 0 }),
    );

    expect(index).toBe(0);
  });

  it("keeps the stored index when the chapter cannot be loaded", async () => {
    const index = await resolveBookmarkParagraphIndex(
      async () => Promise.reject(new Error("offline")),
      bookmarkFixture({ paragraphIndex: 4 }),
    );

    expect(index).toBe(4);
  });

  it("keeps the stored index when the chapter is gone", async () => {
    const index = await resolveBookmarkParagraphIndex(
      async () => null,
      bookmarkFixture({ paragraphIndex: 3 }),
    );

    expect(index).toBe(3);
  });
});
