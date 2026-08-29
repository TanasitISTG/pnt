import { describe, expect, it } from "vitest";

import {
  MAX_GLOSSARY_SUGGESTIONS_PER_CHAPTER,
  applyGlossarySuggestionPolicy,
  selectRelevantApprovedMappings,
} from "./policy";
import type { GlossaryReviewResult, SuggestedTerm } from "../types/glossary";

function suggestion(source: string, target = `target-${source}`): SuggestedTerm {
  return { source, target, category: "other" };
}

function review(
  source: string,
  target = `target-${source}`,
  overrides: Partial<GlossaryReviewResult> = {},
): GlossaryReviewResult {
  return {
    source,
    target,
    termType: "named_entity",
    action: "approve",
    confidence: "high",
    reason: "stable named term",
    ...overrides,
  };
}

describe("glossary suggestion policy", () => {
  it("deduplicates sources using NFKC and collapsed whitespace", () => {
    const result = applyGlossarySuggestionPolicy({
      suggestions: [suggestion("Ａ  lpha"), suggestion("A lpha")],
      reviews: [review("A lpha", "อัลฟา")],
      fullRawSource: "Ａ  lpha",
      fullTranslation: "อัลฟา",
      existingSources: [],
    });

    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0].source).toBe("Ａ  lpha");
    expect(result.discardedCount).toBe(1);
  });

  it("counts conflicts across every existing status", () => {
    const result = applyGlossarySuggestionPolicy({
      suggestions: [suggestion("Existing Term"), suggestion("Fresh Term")],
      reviews: [review("Existing Term"), review("Fresh Term")],
      fullRawSource: "Existing Term Fresh Term",
      fullTranslation: "target-Existing Term target-Fresh Term",
      existingSources: ["Existing   Term"],
    });

    expect(result.conflictCount).toBe(1);
    expect(result.discardedCount).toBe(0);
    expect(result.accepted.map((term) => term.source)).toEqual(["Fresh Term"]);
  });

  it("rejects short sources and independently missing source or target evidence", () => {
    const result = applyGlossarySuggestionPolicy({
      suggestions: [
        suggestion("中"),
        suggestion("Absent Source", "Present Target"),
        suggestion("Present Source", "Absent Target"),
      ],
      reviews: [
        review("中", "中译"),
        review("Absent Source", "Present Target"),
        review("Present Source", "Absent Target"),
      ],
      fullRawSource: "中 Present Source",
      fullTranslation: "中译 Present Target",
      existingSources: [],
    });

    expect(result.accepted).toEqual([]);
    expect(result.discardedCount).toBe(3);
  });

  it("requires a matching review", () => {
    const result = applyGlossarySuggestionPolicy({
      suggestions: [suggestion("Unreviewed")],
      reviews: [],
      fullRawSource: "Unreviewed",
      fullTranslation: "target-Unreviewed",
      existingSources: [],
    });

    expect(result.accepted).toEqual([]);
    expect(result.discardedCount).toBe(1);
  });

  it("rejects generic terms even when review action says approve", () => {
    const result = applyGlossarySuggestionPolicy({
      suggestions: [suggestion("手机", "โทรศัพท์")],
      reviews: [review("手机", "โทรศัพท์", { termType: "generic" })],
      fullRawSource: "手机",
      fullTranslation: "โทรศัพท์",
      existingSources: [],
    });

    expect(result.accepted).toEqual([]);
    expect(result.discardedCount).toBe(1);
  });

  it("caps distinct candidates after removing conflicts", () => {
    const suggestions = Array.from(
      { length: MAX_GLOSSARY_SUGGESTIONS_PER_CHAPTER + 2 },
      (_, index) => suggestion(`Term ${index}`),
    );
    const reviews = suggestions.map((term) => review(term.source, term.target));
    const result = applyGlossarySuggestionPolicy({
      suggestions: [suggestion("Already There"), ...suggestions],
      reviews: [review("Already There"), ...reviews],
      fullRawSource: ["Already There", ...suggestions.map((term) => term.source)].join(" "),
      fullTranslation: ["target-Already There", ...suggestions.map((term) => term.target)].join(
        " ",
      ),
      existingSources: ["Already There"],
    });

    expect(result.conflictCount).toBe(1);
    expect(result.accepted).toHaveLength(MAX_GLOSSARY_SUGGESTIONS_PER_CHAPTER);
    expect(result.discardedCount).toBe(2);
  });

  it("approves named entities and leaves story-specific terms pending", () => {
    const result = applyGlossarySuggestionPolicy({
      suggestions: [suggestion("许野", "สวี่เหยี่ย"), suggestion("灵脉", "เส้นพลังวิญญาณ")],
      reviews: [
        review("许野", "สวี่เหยี่ย"),
        review("灵脉", "เส้นพลังวิญญาณ", {
          termType: "story_specific",
          action: "pending",
        }),
      ],
      fullRawSource: "许野 灵脉",
      fullTranslation: "สวี่เหยี่ย เส้นพลังวิญญาณ",
      existingSources: [],
    });

    expect(result.accepted).toEqual([
      expect.objectContaining({ source: "许野", target: "สวี่เหยี่ย", status: "approved" }),
      expect.objectContaining({ source: "灵脉", target: "เส้นพลังวิญญาณ", status: "pending" }),
    ]);
  });

  it("selects, deduplicates, and caps relevant mappings deterministically", () => {
    const suggestions = [suggestion("Alpha", "Shared Target")];
    const approvedTerms = [
      { source: "Unrelated", target: "ไม่เกี่ยวข้อง" },
      { source: "Alpha Zed", target: "Z" },
      { source: "Target Match", target: "Shared Target" },
      { source: "Alpha Able", target: "A" },
      { source: "Alpha Able", target: "A" },
    ];
    const expected = [
      { source: "Alpha Able", target: "A" },
      { source: "Alpha Zed", target: "Z" },
    ];

    expect(selectRelevantApprovedMappings(suggestions, approvedTerms, 2)).toEqual(expected);
    expect(selectRelevantApprovedMappings(suggestions, approvedTerms.toReversed(), 2)).toEqual(
      expected,
    );
  });
});
