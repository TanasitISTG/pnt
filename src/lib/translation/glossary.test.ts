import { describe, it, expect } from "vitest";
import { filterGlossaryForChunk, formatGlossaryBlock } from "./glossary";

describe("glossary module", () => {
  const sampleTerms = [
    { source: "Lin Fan", target: "หลินฟาน", category: "character" },
    { source: "Sun", target: "อาทิตย์", category: "other" },
    { source: "Sun Peak", target: "ยอดเขาอาทิตย์", category: "place" },
    { source: "林凡", target: "Lin Fan", category: "character" },
    { source: "Solar Flare Slash", target: "เพลงดาบสุริยะ", category: "skill" },
  ];

  it("filters matching Latin terms case-insensitively", () => {
    const text = "lin fan walked towards the hall.";
    const result = filterGlossaryForChunk(sampleTerms, text);
    expect(result.map((r) => r.source)).toContain("Lin Fan");
    expect(result.map((r) => r.source)).not.toContain("Solar Flare Slash");
  });

  it("filters CJK terms case-sensitively", () => {
    const text = "林凡来到了大殿。";
    const result = filterGlossaryForChunk(sampleTerms, text);
    expect(result.map((r) => r.source)).toEqual(["林凡"]);
  });

  it("sorts matches longest source term first", () => {
    const text = "Welcome to Sun Peak on the Sun.";
    const result = filterGlossaryForChunk(sampleTerms, text);
    expect(result.map((r) => r.source)).toEqual(["Sun Peak", "Sun"]);
  });

  it("returns empty array for empty inputs", () => {
    expect(filterGlossaryForChunk([], "test")).toEqual([]);
    expect(filterGlossaryForChunk(sampleTerms, "")).toEqual([]);
  });

  it("normalizes Unicode and smart quotes for matching", () => {
    const terms = [{ source: "Lin\u2019s Fan", target: "หลินฟาน", category: "character" }];
    const text = "Lin's Fan arrived.";
    const result = filterGlossaryForChunk(terms, text);
    expect(result).toHaveLength(1);
  });

  it("normalizes excess whitespace in source terms", () => {
    const terms = [{ source: "Solar  Flare   Slash", target: "เพลงดาบสุริยะ", category: "skill" }];
    const text = "He used Solar Flare Slash.";
    const result = filterGlossaryForChunk(terms, text);
    expect(result).toHaveLength(1);
  });

  it("formats glossary terms correctly", () => {
    const terms = [
      { source: "Lin Fan", target: "หลินฟาน", category: "character" },
      { source: "Sun Peak", target: "ยอดเขาอาทิตย์", category: "place" },
    ];
    const block = formatGlossaryBlock(terms);
    expect(block).toBe("- Lin Fan -> หลินฟาน (character)\n- Sun Peak -> ยอดเขาอาทิตย์ (place)");
  });
});
