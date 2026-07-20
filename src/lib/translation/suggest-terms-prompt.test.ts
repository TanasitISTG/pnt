import { describe, it, expect } from "vitest";
import { buildTermSuggestionPrompt, parseTermSuggestions } from "./suggest-terms-prompt";

describe("suggest-terms-prompt", () => {
  it("builds prompt including existing terms", () => {
    const prompt = buildTermSuggestionPrompt("en->th", ["Lin Fan", "Sun Peak"]);
    expect(prompt).toContain("Lin Fan, Sun Peak");
    expect(prompt).toContain("en->th");
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
