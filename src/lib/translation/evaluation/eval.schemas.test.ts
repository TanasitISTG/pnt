import { describe, expect, it } from "vitest";

import {
  EVAL_SELECTOR_ERROR,
  evalReviewSearchSchema,
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
});
