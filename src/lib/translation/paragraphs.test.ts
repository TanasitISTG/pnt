import { describe, expect, it } from "vitest";
import {
  alignParagraphs,
  splitParagraphs,
  injectParagraphMarkers,
  restoreParagraphMarkers,
  countParagraphMarkers,
  normalizeTranslationOutput,
  PARAGRAPH_MARKER,
} from "./paragraphs";

describe("splitParagraphs", () => {
  it("splits on blank lines", () => {
    expect(splitParagraphs("one\n\ntwo\n\n\nthree")).toEqual(["one", "two", "three"]);
  });

  it("falls back to single newlines", () => {
    expect(splitParagraphs("一\n二\n三")).toEqual(["一", "二", "三"]);
  });

  it("handles empty and whitespace input", () => {
    expect(splitParagraphs("")).toEqual([]);
    expect(splitParagraphs("   \n\n  ")).toEqual([]);
  });

  it("keeps a single paragraph whole", () => {
    expect(splitParagraphs("just one")).toEqual(["just one"]);
  });
});

describe("alignParagraphs", () => {
  it("zips equal counts by index", () => {
    expect(alignParagraphs("a\n\nb", "A\n\nB")).toEqual([
      { raw: "a", translated: "A" },
      { raw: "b", translated: "B" },
    ]);
  });

  it("leaves gaps when counts mismatch", () => {
    expect(alignParagraphs("a\n\nb\n\nc", "A")).toEqual([
      { raw: "a", translated: "A" },
      { raw: "b", translated: undefined },
      { raw: "c", translated: undefined },
    ]);
  });
});

describe("paragraph markers", () => {
  it("injects markers at paragraph breaks", () => {
    const result = injectParagraphMarkers("one\n\ntwo\n\nthree");
    expect(result).toBe(`one\n${PARAGRAPH_MARKER}\ntwo\n${PARAGRAPH_MARKER}\nthree`);
  });

  it("restores markers to blank lines", () => {
    const marked = `one\n${PARAGRAPH_MARKER}\ntwo\n${PARAGRAPH_MARKER}\nthree`;
    expect(restoreParagraphMarkers(marked)).toBe("one\n\ntwo\n\nthree");
  });

  it("counts markers correctly", () => {
    const marked = `a\n${PARAGRAPH_MARKER}\nb\n${PARAGRAPH_MARKER}\nc`;
    expect(countParagraphMarkers(marked)).toBe(2);
  });

  it("returns zero for text without markers", () => {
    expect(countParagraphMarkers("plain text")).toBe(0);
  });

  it("normalizes CRLF and duplicate blank lines", () => {
    expect(normalizeTranslationOutput("a\r\n\r\n\r\n\r\nb")).toBe("a\n\nb");
  });

  it("strips trailing whitespace on lines", () => {
    expect(normalizeTranslationOutput("line1   \n  line2")).toBe("line1\nline2");
  });

  it("handles roundtrip inject → restore preserving paragraphs", () => {
    const original = "First paragraph here.\n\nSecond paragraph.\n\n\n\nThird one.";
    const injected = injectParagraphMarkers(original);
    const restored = restoreParagraphMarkers(injected);
    expect(restored).toBe("First paragraph here.\n\nSecond paragraph.\n\nThird one.");
  });
});
