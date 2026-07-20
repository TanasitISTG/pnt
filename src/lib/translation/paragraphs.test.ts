import { describe, expect, it } from "vitest";
import { alignParagraphs, splitParagraphs } from "./paragraphs";

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
