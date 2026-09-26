import { expect, it } from "bun:test";
import { alignParagraphs, splitParagraphs } from "./paragraphs";
import { findExcerptParagraphIndex } from "./excerpts";

it("splits and aligns bilingual paragraphs with trailing gaps", () => {
  expect(splitParagraphs("first\n\nsecond")).toEqual(["first", "second"]);
  expect(alignParagraphs("first\nsecond", "หนึ่ง")).toEqual([
    { raw: "first", translated: "หนึ่ง" },
    { raw: "second", translated: undefined },
  ]);
});

it("relocates an edited bookmark by excerpt before falling back to index", () => {
  expect(findExcerptParagraphIndex(["first", "new chapter text"], "new chapter text", 0)).toBe(1);
  expect(findExcerptParagraphIndex(["first", "second"], "missing", 50)).toBe(1);
});
