import { describe, expect, it } from "vitest";

import {
  buildGlossaryReviewPrompt,
  buildGlossaryReviewUserMessage,
  buildTermSuggestionPrompt,
  buildTermSuggestionUserMessage,
  parseGlossaryReviewResponse,
  parseTermSuggestions,
} from "./suggestions";

describe("suggest-terms-prompt", () => {
  it("builds prompt including existing terms and eligibility limits", () => {
    const prompt = buildTermSuggestionPrompt("en->th", ["Lin Fan", "Sun Peak"]);
    expect(prompt).toContain("Lin Fan, Sun Peak");
    expect(prompt).toContain("en->th");
    expect(prompt).toContain("at most 8 candidates");
    expect(prompt).toContain("common nouns");
    expect(prompt).toContain("one-off descriptions");
  });

  it("requests notes in the target language", () => {
    expect(buildTermSuggestionPrompt("en->th", [])).toContain("note written in Thai");
    expect(buildTermSuggestionPrompt("zh->en", [])).toContain("note written in English");
    expect(buildTermSuggestionPrompt("zh->th", [])).toContain("note written in Thai");
  });

  it("includes approved mappings in prompt when provided", () => {
    const prompt = buildTermSuggestionPrompt("en->th", [], {
      approvedMappings: [
        { source: "Lin Fan", target: "หลินฟาน" },
        { source: "Sun Peak", target: "ยอดเขาอาทิตย์" },
      ],
    });
    expect(prompt).toContain("Lin Fan -> หลินฟาน");
    expect(prompt).toContain("Approved glossary mappings");
  });

  it("builds user message with bounded bilingual evidence and no summary", () => {
    const msg = buildTermSuggestionUserMessage("translated text here", {
      rawSourceExcerpt: "original source text",
    });
    expect(msg).toContain("Source text excerpt");
    expect(msg).toContain("original source text");
    expect(msg).toContain("translated text here");
    expect(msg).not.toContain("Chapter summary");
  });

  it("builds review user message with the same bounded bilingual evidence", () => {
    const msg = buildGlossaryReviewUserMessage(
      [{ source: "Lin Fan", target: "หลินฟาน", category: "character" }],
      "original source text",
      "translated text here",
    );
    expect(msg).toContain('"source": "Lin Fan"');
    expect(msg).toContain("original source text");
    expect(msg).toContain("translated text here");
    expect(msg).not.toContain("Chapter summary");
  });

  it("parses clean JSON response", () => {
    const json = JSON.stringify({
      terms: [
        { source: "Lin Fan", target: "หลินฟาน", category: "character", note: "MC" },
        { source: "Sun Peak", target: "ยอดเขาอาทิตย์", category: "place" },
      ],
    });
    const result = parseTermSuggestions(json);
    expect(result).toHaveLength(2);
    expect(result?.[0]).toEqual({
      source: "Lin Fan",
      target: "หลินฟาน",
      category: "character",
      note: "MC",
    });
    expect(result?.[1]?.category).toBe("place");
  });
  it("parses a top-level array and preserves a valid empty array", () => {
    const result = parseTermSuggestions(
      JSON.stringify([{ source: "Sword", target: "กระบี่", category: "item" }]),
    );
    expect(result).toEqual([{ source: "Sword", target: "กระบี่", category: "item" }]);
    expect(parseTermSuggestions('{"terms":[]}')).toEqual([]);
  });
  it("rejects a non-empty array when every term is schema-invalid", () => {
    expect(
      parseTermSuggestions(
        JSON.stringify({
          terms: [{ source: "Missing target" }, { target: "Missing source" }],
        }),
      ),
    ).toBeNull();
  });

  it("parses JSON inside markdown code block", () => {
    const md =
      'Here are the extracted terms:\n```json\n{\n  "terms": [\n    { "source": "Sword", "target": "กระบี่", "category": "item" }\n  ]\n}\n```';
    const result = parseTermSuggestions(md);
    expect(result).toHaveLength(1);
    expect(result?.[0]?.source).toBe("Sword");
    expect(result?.[0]?.category).toBe("item");
  });

  it("handles invalid or empty inputs gracefully", () => {
    expect(parseTermSuggestions("")).toBeNull();
    expect(parseTermSuggestions("not json")).toBeNull();
    expect(parseTermSuggestions("{}")).toBeNull();
  });
});

describe("glossary review", () => {
  it("builds review prompt with eligibility and approved mappings", () => {
    const prompt = buildGlossaryReviewPrompt("en->th", [{ source: "Lin Fan", target: "หลินฟาน" }]);
    expect(prompt).toContain("APPROVE");
    expect(prompt).toContain("REJECT");
    expect(prompt).toContain("PENDING");
    expect(prompt).toContain("Lin Fan -> หลินฟาน");
    expect(prompt).toContain('"termType": "named_entity" | "story_specific" | "generic"');
    expect(prompt).toContain("generic vocabulary");
    expect(prompt).toContain("Uncertain ordinary vocabulary must be rejected");
    expect(prompt).toContain(
      "Confidence measures confidence in both glossary eligibility and literal source/target evidence",
    );
  });

  it("parses valid review response", () => {
    const json = JSON.stringify({
      reviews: [
        {
          source: "New Character",
          target: "ตัวละครใหม่",
          termType: "named_entity",
          action: "approve",
          confidence: "high",
          reason: "Clear character name with consistent usage",
        },
        {
          source: "Maybe Term",
          target: "ศัพท์ที่อาจใช้",
          termType: "story_specific",
          action: "pending",
          confidence: "low",
          reason: "Unclear if recurring",
        },
      ],
    });
    const result = parseGlossaryReviewResponse(json);
    expect(result).toHaveLength(2);
    expect(result?.[0]?.termType).toBe("named_entity");
    expect(result?.[0]?.action).toBe("approve");
    expect(result?.[0]?.confidence).toBe("high");
    expect(result?.[1]?.action).toBe("pending");
  });

  it("falls back to pending, low confidence, and generic for invalid review fields", () => {
    const json = JSON.stringify({
      reviews: [
        {
          source: "Bad",
          target: "Term",
          action: "invalid_action",
          confidence: "invalid_confidence",
          termType: "invalid_type",
          reason: "test",
        },
      ],
    });
    const result = parseGlossaryReviewResponse(json);
    expect(result).toHaveLength(1);
    expect(result?.[0]?.termType).toBe("generic");
    expect(result?.[0]?.action).toBe("pending");
    expect(result?.[0]?.confidence).toBe("low");
  });

  it("defaults missing termType to generic", () => {
    const result = parseGlossaryReviewResponse(
      JSON.stringify({
        reviews: [
          { source: "Old Schema", target: "ศัพท์เก่า", action: "approve", confidence: "high" },
        ],
      }),
    );
    expect(result?.[0]?.termType).toBe("generic");
  });

  it("parses markdown-fenced review response", () => {
    const md =
      '```json\n{"reviews": [{"source": "X", "target": "Y", "termType": "named_entity", "action": "reject", "confidence": "high", "reason": "duplicate", "matchingApprovedTerm": "X Original"}]}\n```';
    const result = parseGlossaryReviewResponse(md);
    expect(result).toHaveLength(1);
    expect(result?.[0]?.termType).toBe("named_entity");
    expect(result?.[0]?.action).toBe("reject");
    expect(result?.[0]?.matchingApprovedTerm).toBe("X Original");
  });

  it("handles empty and invalid inputs", () => {
    expect(parseGlossaryReviewResponse("")).toBeNull();
    expect(parseGlossaryReviewResponse("not json")).toBeNull();
    expect(parseGlossaryReviewResponse("{}")).toBeNull();
    expect(parseGlossaryReviewResponse('{"reviews":[]}')).toEqual([]);
  });
});
