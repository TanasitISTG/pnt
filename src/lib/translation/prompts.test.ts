import { describe, it, expect } from "vitest";
import {
  buildSystemPrompt,
  buildSummaryPrompt,
  buildTitlePrompt,
  findResidualSourceChars,
} from "./prompts";

describe("prompts module", () => {
  it("builds correct system prompt for en->th pair", () => {
    const prompt = buildSystemPrompt("en->th");
    expect(prompt).toContain("English to Thai");
    expect(prompt).not.toContain("## Terminology & Glossary");
    expect(prompt).not.toContain("## Story Context");
  });

  it("builds correct system prompt for zh->en pair", () => {
    const prompt = buildSystemPrompt("zh->en");
    expect(prompt).toContain("Chinese");
    expect(prompt).toContain("English");
  });

  it("builds correct system prompt for zh->th pair", () => {
    const prompt = buildSystemPrompt("zh->th");
    expect(prompt).toContain("Chinese");
    expect(prompt).toContain("Thai");
  });

  it("includes glossary block with canonical wording instruction", () => {
    const glossary = "- Lin Fan -> หลินฟาน (character)\n- Sun Peak -> ยอดเขาอาทิตย์ (place)";
    const prompt = buildSystemPrompt("en->th", glossary);
    expect(prompt).toContain("## Terminology & Glossary");
    expect(prompt).toContain("Lin Fan -> หลินฟาน");
    expect(prompt).toContain("exact target wording");
  });

  it("includes paragraph marker instructions", () => {
    const prompt = buildSystemPrompt("en->th");
    expect(prompt).toContain("## Paragraph Formatting");
    expect(prompt).toContain("||¶||");
    expect(prompt).toContain("preserve every");
  });

  it("includes context block when summary or tail provided", () => {
    const prompt = buildSystemPrompt("en->th", null, {
      previousSummary: "Lin Fan arrived at Sun Peak.",
      previousChunkTail: "He looked up at the main hall.",
    });

    expect(prompt).toContain("## Story Context");
    expect(prompt).toContain("Lin Fan arrived at Sun Peak");
    expect(prompt).toContain("He looked up at the main hall");
  });

  it("includes custom instructions when provided", () => {
    const prompt = buildSystemPrompt("en->th", null, null, "Use informal pronouns for Lin Fan.");
    expect(prompt).toContain("## Custom Instructions");
    expect(prompt).toContain("Use informal pronouns for Lin Fan");
  });

  it("demands complete translation including brackets and names", () => {
    for (const pair of ["en->th", "zh->en", "zh->th"]) {
      const prompt = buildSystemPrompt(pair);
      expect(prompt).toContain("Translate everything");
      expect(prompt).toContain("No source-language text may remain");
    }
  });

  it("findResidualSourceChars flags hanzi in zh output only", () => {
    expect(findResidualSourceChars("zh->th", "สวัสดี【虎哥送嘉年华】ครับ")).toHaveLength(6);
    expect(findResidualSourceChars("zh->en", "clean English text")).toHaveLength(0);
    expect(findResidualSourceChars("zh->th", "ข้อความไทยล้วน")).toHaveLength(0);
    expect(findResidualSourceChars("en->th", "leftover English words")).toHaveLength(0);
  });

  it("buildSummaryPrompt returns English requirement instruction", () => {
    const summaryPrompt = buildSummaryPrompt("zh->th");
    expect(summaryPrompt).toContain("CRITICAL REQUIREMENT: Always write the summary in ENGLISH");
  });

  it("buildTitlePrompt names the language pair and demands title-only output", () => {
    const prompt = buildTitlePrompt("zh->th");
    expect(prompt).toContain("Chinese to Thai");
    expect(prompt).toContain("ONLY the translated title");
  });
});
