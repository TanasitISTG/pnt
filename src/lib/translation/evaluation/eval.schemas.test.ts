import { describe, expect, it } from "vitest";

import {
  EVAL_SELECTOR_ERROR,
  evalFindingSchema,
  evalReviewSearchSchema,
  evalSummaryV2Schema,
  parseEvalSelection,
  startTranslationEvalSchema,
} from "./eval.schemas";

describe("parseEvalSelection", () => {
  it("supports symbolic selectors and canonical merged numeric ranges", () => {
    expect(parseEvalSelection(" FIRST3 ")).toEqual({ mode: "first3" });
    expect(parseEvalSelection("all")).toEqual({ mode: "all" });
    expect(parseEvalSelection("1.50, 1-2, 2-3, 4.75")).toEqual({
      mode: "ranges",
      ranges: [
        { from: "1", to: "3" },
        { from: "4.75", to: "4.75" },
      ],
    });
  });

  it("rejects malformed, reversed, signed, overprecise, and empty selectors", () => {
    for (const selector of ["garbage", "1,,2", "3-1", "1e3", "1.234", "", "1-2-3", "+1"]) {
      expect(() => parseEvalSelection(selector)).toThrow(EVAL_SELECTOR_ERROR);
    }
    expect(() => parseEvalSelection("9".repeat(513))).toThrow(EVAL_SELECTOR_ERROR);
  });

  it("preserves decimal bounds without enumerating the interval", () => {
    expect(parseEvalSelection("0001.5, 1-2.25")).toEqual({
      mode: "ranges",
      ranges: [{ from: "1", to: "2.25" }],
    });
    expect(parseEvalSelection("0.01-999999.99")).toEqual({
      mode: "ranges",
      ranges: [{ from: "0.01", to: "999999.99" }],
    });
  });
});

describe("evaluation schemas", () => {
  it("defaults omitted selector and review URL state", () => {
    expect(startTranslationEvalSchema.parse({ novelId: "novel-1" })).toEqual({
      novelId: "novel-1",
      chapterSelector: "first3",
    });
    expect(evalReviewSearchSchema.parse({})).toEqual({
      reviewFilter: "attention",
      reviewPage: 1,
      reviewPageSize: 25,
    });
  });

  it("rejects an explicitly empty or overlong selector before a request is accepted", () => {
    expect(() =>
      startTranslationEvalSchema.parse({ novelId: "novel-1", chapterSelector: " " }),
    ).toThrow(EVAL_SELECTOR_ERROR);
    expect(() =>
      startTranslationEvalSchema.parse({
        novelId: "novel-1",
        chapterSelector: `1${" ".repeat(512)}`,
      }),
    ).toThrow(EVAL_SELECTOR_ERROR);
  });

  it("bounds v2 finding excerpts by Unicode code points and requires glossary terms", () => {
    const base = {
      type: "residual-script" as const,
      paragraphIndex: 2,
      sourceExcerpt: "ส".repeat(160),
      translationExcerpt: "𐐀".repeat(160),
      sourceTerm: null,
      targetTerm: null,
    };
    expect(evalFindingSchema.parse(base)).toEqual(base);
    expect(() =>
      evalFindingSchema.parse({ ...base, sourceExcerpt: `${"ส".repeat(160)}x` }),
    ).toThrow();
    expect(() =>
      evalFindingSchema.parse({
        ...base,
        type: "glossary-miss",
        sourceTerm: null,
        targetTerm: null,
      }),
    ).toThrow();
  });

  it("accepts version two summaries with the same aggregate invariants", () => {
    expect(
      evalSummaryV2Schema.parse({
        version: 2,
        languagePair: "en->th",
        contextFingerprint: "a".repeat(64),
        chapterCount: 1,
        evaluatedChapterCount: 1,
        skippedChapterCount: 0,
        attentionChapterCount: 0,
        residualScriptLetters: 0,
        markerMismatches: 0,
        matchedGlossaryTerms: 0,
        adheredGlossaryTerms: 0,
      }),
    ).toMatchObject({ version: 2, chapterCount: 1 });
  });
});
