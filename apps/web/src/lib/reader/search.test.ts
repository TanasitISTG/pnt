import { describe, expect, it } from "vitest";

import {
  buildReaderSearchTargets,
  collectReaderSearchMatches,
  findTextMatches,
  highlightsForParagraph,
  READER_SEARCH_MATCH_LIMIT,
  type ReaderSearchMatch,
} from "./search";

import { findExcerptParagraphIndex, normalizeExcerpt } from "@pnt/reader-core/excerpts";

describe("findTextMatches", () => {
  it("returns every non-overlapping occurrence with its range", () => {
    expect(findTextMatches("rain rain rain", "rain")).toEqual([
      { start: 0, end: 4 },
      { start: 5, end: 9 },
      { start: 10, end: 14 },
    ]);
  });

  it("matches case-insensitively but keeps original offsets", () => {
    expect(findTextMatches("The Rain", "rain")).toEqual([{ start: 4, end: 8 }]);
  });

  it("does not overlap matches inside repeated patterns", () => {
    expect(findTextMatches("aaaa", "aa")).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });

  it("returns nothing for an empty or whitespace query", () => {
    expect(findTextMatches("rain", "")).toEqual([]);
    expect(findTextMatches("rain", "   ")).toEqual([]);
  });

  it("finds matches in Thai text without word boundaries", () => {
    expect(findTextMatches("ฝนตกหนักตอนกลางคืน", "ตก")).toEqual([{ start: 2, end: 4 }]);
  });

  it("caps the matches it collects per paragraph", () => {
    const text = "a".repeat(READER_SEARCH_MATCH_LIMIT + 50);
    expect(findTextMatches(text, "a")).toHaveLength(READER_SEARCH_MATCH_LIMIT);
  });
});

describe("buildReaderSearchTargets", () => {
  const rawParagraphs = ["raw one", "raw two"];
  const translatedParagraphs = ["translated one", "translated two"];
  const aligned = [
    { raw: "raw one", translated: "translated one" },
    { raw: "raw two", translated: "translated two" },
  ];

  it("uses raw paragraphs whenever no translation exists", () => {
    expect(
      buildReaderSearchTargets({
        viewMode: "translated",
        hasTranslation: false,
        rawParagraphs,
        translatedParagraphs: [],
        aligned: [],
      }),
    ).toEqual([
      { paragraphIndex: 0, column: null, text: "raw one" },
      { paragraphIndex: 1, column: null, text: "raw two" },
    ]);
  });

  it("searches both columns of a comparison view, raw first then translated", () => {
    expect(
      buildReaderSearchTargets({
        viewMode: "side",
        hasTranslation: true,
        rawParagraphs,
        translatedParagraphs,
        aligned,
      }),
    ).toEqual([
      { paragraphIndex: 0, column: "raw", text: "raw one" },
      { paragraphIndex: 0, column: "translated", text: "translated one" },
      { paragraphIndex: 1, column: "raw", text: "raw two" },
      { paragraphIndex: 1, column: "translated", text: "translated two" },
    ]);
  });

  it("skips empty cells of a partial alignment", () => {
    expect(
      buildReaderSearchTargets({
        viewMode: "side",
        hasTranslation: true,
        rawParagraphs,
        translatedParagraphs,
        aligned: [
          { raw: "raw one", translated: null },
          { raw: null, translated: "translated two" },
        ],
      }),
    ).toEqual([
      { paragraphIndex: 0, column: "raw", text: "raw one" },
      { paragraphIndex: 1, column: "translated", text: "translated two" },
    ]);
  });

  it("follows the active single-column view", () => {
    const translated = buildReaderSearchTargets({
      viewMode: "translated",
      hasTranslation: true,
      rawParagraphs,
      translatedParagraphs,
      aligned,
    });
    const raw = buildReaderSearchTargets({
      viewMode: "raw",
      hasTranslation: true,
      rawParagraphs,
      translatedParagraphs,
      aligned,
    });

    expect(translated).toEqual([
      { paragraphIndex: 0, column: null, text: "translated one" },
      { paragraphIndex: 1, column: null, text: "translated two" },
    ]);
    expect(raw).toEqual([
      { paragraphIndex: 0, column: null, text: "raw one" },
      { paragraphIndex: 1, column: null, text: "raw two" },
    ]);
  });
});

describe("collectReaderSearchMatches", () => {
  it("walks targets in document order and keeps paragraph identity", () => {
    const matches = collectReaderSearchMatches(
      [
        { paragraphIndex: 0, column: "raw", text: "rain again" },
        { paragraphIndex: 0, column: "translated", text: "rain rain" },
        { paragraphIndex: 1, column: "translated", text: "no match" },
      ],
      "rain",
    );

    expect(matches).toEqual([
      { paragraphIndex: 0, column: "raw", start: 0, end: 4 },
      { paragraphIndex: 0, column: "translated", start: 0, end: 4 },
      { paragraphIndex: 0, column: "translated", start: 5, end: 9 },
    ]);
  });

  it("returns nothing for an empty query", () => {
    expect(
      collectReaderSearchMatches([{ paragraphIndex: 0, column: null, text: "rain" }], "  "),
    ).toEqual([]);
  });

  it("stops collecting once the global cap is reached", () => {
    const targets = Array.from({ length: READER_SEARCH_MATCH_LIMIT }, (_, index) => ({
      paragraphIndex: index,
      column: null,
      text: "a",
    }));

    expect(collectReaderSearchMatches(targets, "a")).toHaveLength(READER_SEARCH_MATCH_LIMIT);
  });
});

describe("highlightsForParagraph", () => {
  const matches: ReaderSearchMatch[] = [
    { paragraphIndex: 0, column: null, start: 0, end: 4 },
    { paragraphIndex: 0, column: null, start: 5, end: 9 },
    { paragraphIndex: 1, column: "translated", start: 0, end: 4 },
  ];

  it("returns ranges for one paragraph and column only", () => {
    expect(highlightsForParagraph(matches, 0, 0, null)).toEqual({
      ranges: [
        { start: 0, end: 4 },
        { start: 5, end: 9 },
      ],
      activeRange: { start: 0, end: 4 },
    });
    expect(highlightsForParagraph(matches, 2, 1, "translated")).toEqual({
      ranges: [{ start: 0, end: 4 }],
      activeRange: { start: 0, end: 4 },
    });
    expect(highlightsForParagraph(matches, 0, 1, "translated")?.activeRange).toBeNull();
  });

  it("marks the active match separately from the other ranges", () => {
    expect(highlightsForParagraph(matches, 1, 0, null)?.activeRange).toEqual({
      start: 5,
      end: 9,
    });
  });

  it("returns undefined for paragraphs without matches", () => {
    expect(highlightsForParagraph(matches, 0, 2, null)).toBeUndefined();
    expect(highlightsForParagraph(matches, 0, 1, "raw")).toBeUndefined();
  });
});

describe("normalizeExcerpt", () => {
  it("collapses whitespace so stored excerpts compare across renders", () => {
    expect(normalizeExcerpt("  a\n\n b \t c  ")).toBe("a b c");
  });
});

describe("findExcerptParagraphIndex", () => {
  const paragraphs = ["first paragraph", "second paragraph", "third paragraph"];

  it("keeps the stored index while the paragraph still holds the excerpt", () => {
    expect(findExcerptParagraphIndex(paragraphs, "third paragraph", 2)).toBe(2);
  });

  it("recovers the paragraph after the text moved", () => {
    const shifted = ["inserted opener", ...paragraphs];
    expect(findExcerptParagraphIndex(shifted, "third paragraph", 2)).toBe(3);
  });

  it("recovers a paragraph that moved earlier", () => {
    const shifted = ["second paragraph", "first paragraph", "third paragraph"];
    expect(findExcerptParagraphIndex(shifted, "second paragraph", 1)).toBe(0);
  });

  it("matches a truncated excerpt through its whitespace differences", () => {
    const reflowed = ["an opening line", "the quick brown fox jumps over the lazy dog"];
    expect(findExcerptParagraphIndex(reflowed, "the   quick\nbrown fox jumps…", 0)).toBe(1);
  });

  it("matches mid-paragraph selections", () => {
    expect(findExcerptParagraphIndex(paragraphs, "second", 0)).toBe(1);
  });

  it("clamps the stored index when the excerpt is gone and the chapter shrank", () => {
    expect(findExcerptParagraphIndex(["only paragraph"], "vanished text", 7)).toBe(0);
  });

  it("falls back to the stored index when there is nothing to match", () => {
    expect(findExcerptParagraphIndex(paragraphs, "   ", 2)).toBe(2);
  });

  it("returns zero for an empty chapter", () => {
    expect(findExcerptParagraphIndex([], "anything", 3)).toBe(0);
  });
});
