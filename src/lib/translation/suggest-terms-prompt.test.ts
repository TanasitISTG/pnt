import { describe, it, expect } from "vitest";
import {
  buildTermSuggestionPrompt,
  buildTermSuggestionUserMessage,
  buildGlossaryReviewPrompt,
  parseTermSuggestions,
  parseGlossaryReviewResponse,
} from "./suggest-terms-prompt";

describe("suggest-terms-prompt", () => {
  it("builds prompt including existing terms", () => {
    const prompt = buildTermSuggestionPrompt("en->th", ["Lin Fan", "Sun Peak"]);
    expect(prompt).toContain("Lin Fan, Sun Peak");
    expect(prompt).toContain("en->th");
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

  it("builds user message with source, translation, and summary", () => {
    const msg = buildTermSuggestionUserMessage("translated text here", {
      rawSourceExcerpt: "original source text",
      chapterSummary: "A summary of the chapter",
    });
    expect(msg).toContain("Source text excerpt");
    expect(msg).toContain("original source text");
    expect(msg).toContain("translated text here");
    expect(msg).toContain("Chapter summary");
    expect(msg).toContain("A summary of the chapter");
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
    expect(result[0]).toEqual({
      source: "Lin Fan",
      target: "หลินฟาน",
      category: "character",
      note: "MC",
    });
    expect(result[1].category).toBe("place");
  });

  it("parses JSON inside markdown code block", () => {
    const md =
      'Here are the extracted terms:\n```json\n{\n  "terms": [\n    { "source": "Sword", "target": "กระบี่", "category": "item" }\n  ]\n}\n```';
    const result = parseTermSuggestions(md);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe("Sword");
    expect(result[0].category).toBe("item");
  });

  it("handles invalid or empty inputs gracefully", () => {
    expect(parseTermSuggestions("")).toEqual([]);
    expect(parseTermSuggestions("not json")).toEqual([]);
    expect(parseTermSuggestions("{}")).toEqual([]);
  });
});

describe("glossary review", () => {
  it("builds review prompt with approved mappings", () => {
    const prompt = buildGlossaryReviewPrompt("en->th", [{ source: "Lin Fan", target: "หลินฟาน" }]);
    expect(prompt).toContain("APPROVE");
    expect(prompt).toContain("REJECT");
    expect(prompt).toContain("PENDING");
    expect(prompt).toContain("Lin Fan -> หลินฟาน");
  });

  it("parses valid review response", () => {
    const json = JSON.stringify({
      reviews: [
        {
          source: "New Character",
          target: "ตัวละครใหม่",
          action: "approve",
          confidence: "high",
          reason: "Clear character name with consistent usage",
        },
        {
          source: "Maybe Term",
          target: "ศัพท์ที่อาจใช้",
          action: "pending",
          confidence: "low",
          reason: "Unclear if recurring",
        },
      ],
    });
    const result = parseGlossaryReviewResponse(json);
    expect(result).toHaveLength(2);
    expect(result[0].action).toBe("approve");
    expect(result[0].confidence).toBe("high");
    expect(result[1].action).toBe("pending");
  });

  it("falls back to pending for invalid action/confidence", () => {
    const json = JSON.stringify({
      reviews: [
        {
          source: "Bad",
          target: "Term",
          action: "invalid_action",
          confidence: "invalid_confidence",
          reason: "test",
        },
      ],
    });
    const result = parseGlossaryReviewResponse(json);
    expect(result).toHaveLength(1);
    expect(result[0].action).toBe("pending");
    expect(result[0].confidence).toBe("low");
  });

  it("parses markdown-fenced review response", () => {
    const md =
      '```json\n{"reviews": [{"source": "X", "target": "Y", "action": "reject", "confidence": "high", "reason": "duplicate", "matchingApprovedTerm": "X Original"}]}\n```';
    const result = parseGlossaryReviewResponse(md);
    expect(result).toHaveLength(1);
    expect(result[0].action).toBe("reject");
    expect(result[0].matchingApprovedTerm).toBe("X Original");
  });

  it("handles empty and invalid inputs", () => {
    expect(parseGlossaryReviewResponse("")).toEqual([]);
    expect(parseGlossaryReviewResponse("not json")).toEqual([]);
    expect(parseGlossaryReviewResponse("{}")).toEqual([]);
  });
});
