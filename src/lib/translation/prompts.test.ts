import { describe, it, expect } from "vitest";
import {
  buildSystemPrompt,
  buildUserMessage,
  buildSummaryPrompt,
  buildTitlePrompt,
  findResidualSourceChars,
  formatRelationshipContext,
  RESIDUAL_CJK_CLASS,
  RESIDUAL_CJK_SQL_RE,
} from "./prompts";
import { buildRelationshipPromptContext } from "@/lib/relationships/map";
import { relationshipMapSchema } from "@/lib/relationships/schemas";

describe("prompts module", () => {
  // -- System prompt structure -----------------------------------------------

  it("builds correct system prompt for en->th pair", () => {
    const prompt = buildSystemPrompt("en->th");
    expect(prompt).toContain("English web novels into Thai");
    expect(prompt).toContain("## Translation Priorities");
    expect(prompt).toContain("## Hard Rules");
    expect(prompt).toContain("## Style Guidelines");
    expect(prompt).toContain("## Example");
    expect(prompt).toContain("## Output Requirements");
    expect(prompt).not.toContain("## Terminology & Glossary");
    expect(prompt).not.toContain("## Story Context");
  });

  it("builds correct system prompt for zh->en pair", () => {
    const prompt = buildSystemPrompt("zh->en");
    expect(prompt).toContain("Chinese web novels into English");
    expect(prompt).toContain("cultivation ranks");
  });

  it("builds correct system prompt for zh->th pair", () => {
    const prompt = buildSystemPrompt("zh->th");
    expect(prompt).toContain("Chinese web novels into Thai");
    expect(prompt).toContain("speech level");
  });

  // -- Priority ordering -----------------------------------------------------

  it("includes directed relationship precedence", () => {
    const prompt = buildSystemPrompt("zh->th");
    expect(prompt).toContain("1. Exact glossary names and source → target spellings");
    expect(prompt).toContain("2. Facts explicitly shown in the current source");
    expect(prompt).toContain("3. Locked admin speech choices for the directed pair");
    expect(prompt).toContain("4. Automatic current-scene relationship guidance");
    expect(prompt).toContain("5. Custom instructions and global style defaults");
  });

  // -- Hard rules ------------------------------------------------------------

  it("demands complete translation in Hard Rules", () => {
    for (const pair of ["en->th", "zh->en", "zh->th"]) {
      const prompt = buildSystemPrompt(pair);
      expect(prompt).toContain("Translate everything");
      expect(prompt).toContain("No source-language text may remain");
    }
  });

  it("includes anti-hallucination rule", () => {
    const prompt = buildSystemPrompt("en->th");
    expect(prompt).toContain("Do not add information absent from the source");
  });

  it("includes anti-rewriting rule", () => {
    const prompt = buildSystemPrompt("en->th");
    expect(prompt).toContain("Do not rewrite for literary improvement");
  });

  it("includes paragraph marker rule in Hard Rules", () => {
    const prompt = buildSystemPrompt("en->th");
    expect(prompt).toContain("## Hard Rules");
    expect(prompt).toContain("||¶||");
    expect(prompt).toContain("Preserve every");
  });

  it("includes XML/HTML tag preservation rule", () => {
    const prompt = buildSystemPrompt("en->th");
    expect(prompt).toContain("HTML/XML-like tags");
  });

  // -- Style guidelines ------------------------------------------------------

  it("includes meaning-over-wording rule", () => {
    const prompt = buildSystemPrompt("en->th");
    expect(prompt).toContain("Translate the meaning of each sentence");
    expect(prompt).toContain("do not mirror source sentence structure");
  });

  it("includes ambiguity preservation rule", () => {
    const prompt = buildSystemPrompt("en->th");
    expect(prompt).toContain("preserve the ambiguity");
  });

  it("includes unseen name consistency rule", () => {
    const prompt = buildSystemPrompt("en->th");
    expect(prompt).toContain("transliterate consistently");
    expect(prompt).toContain("same translation every time");
  });

  it("includes single ellipsis guideline", () => {
    const prompt = buildSystemPrompt("en->th");
    expect(prompt).toContain("Render every ellipsis or hesitation pause as a single `…`");
    expect(prompt).toContain("Never output runs of dots");
  });

  it("includes Thai quotation and ellipsis spacing rule for Thai pairs", () => {
    for (const pair of ["en->th", "zh->th"]) {
      const prompt = buildSystemPrompt(pair);
      expect(prompt).toContain("Thai punctuation and quotes");
      expect(prompt).toContain("do not leave space before `…`");
    }
  });

  it("includes dialogue rules for Thai pairs", () => {
    for (const pair of ["en->th", "zh->th"]) {
      const prompt = buildSystemPrompt(pair);
      expect(prompt).toContain("speech level");
      expect(prompt).toContain("Do not make different characters sound alike");
    }
  });

  it("does not include Thai dialogue rules for zh->en", () => {
    const prompt = buildSystemPrompt("zh->en");
    expect(prompt).not.toContain("speech level");
    expect(prompt).not.toContain("Do not make different characters sound alike");
  });

  // -- Few-shot example ------------------------------------------------------

  it("includes few-shot example for each pair", () => {
    for (const pair of ["en->th", "zh->en", "zh->th"]) {
      const prompt = buildSystemPrompt(pair);
      expect(prompt).toContain("## Example");
      expect(prompt).toContain("Source:");
      expect(prompt).toContain("Good translation:");
    }
  });

  it("includes four directional zh->th dialogue examples", () => {
    const prompt = buildSystemPrompt("zh->th");
    expect(prompt).toContain("男人对女人");
    expect(prompt).toContain("เธอ");
    expect(prompt).toContain("儿子对父亲");
    expect(prompt).toContain("ผม");
    expect(prompt).toContain("亲密的男性朋友");
    expect(prompt).toContain("ฉัน");
    expect(prompt).toContain("นาย");
    expect(prompt).toContain("男主对女主");
    expect(prompt).toContain("Do not add ครับ/ค่ะ/คะ by default");
  });

  // -- Glossary --------------------------------------------------------------

  it("includes glossary block with authoritative wording", () => {
    const glossary = "- Lin Fan -> หลินฟาน (character)\n- Sun Peak -> ยอดเขาอาทิตย์ (place)";
    const prompt = buildSystemPrompt("en->th", glossary);
    expect(prompt).toContain("## Terminology & Glossary");
    expect(prompt).toContain("Lin Fan -> หลินฟาน");
    expect(prompt).toContain("authoritative");
    expect(prompt).toContain("Never invent alternative");
  });

  // -- Context ---------------------------------------------------------------

  it("includes context block when summary provided", () => {
    const prompt = buildSystemPrompt("en->th", null, {
      previousSummary: "Lin Fan arrived at Sun Peak.",
    });
    expect(prompt).toContain("## Story Context");
    expect(prompt).toContain("Lin Fan arrived at Sun Peak");
  });

  it("does not include context when summary is empty", () => {
    const prompt = buildSystemPrompt("en->th", null, { previousSummary: "" });
    expect(prompt).not.toContain("## Story Context");
  });

  // -- Custom instructions ---------------------------------------------------

  it("includes custom instructions before Output Requirements", () => {
    const prompt = buildSystemPrompt("en->th", null, null, "Use informal pronouns for Lin Fan.");
    expect(prompt).toContain("## Custom Instructions");
    expect(prompt).toContain("Use informal pronouns for Lin Fan");
    expect(prompt.indexOf("## Custom Instructions")).toBeLessThan(
      prompt.indexOf("## Output Requirements"),
    );
  });

  // -- Output contract -------------------------------------------------------

  it("output contract is the last section", () => {
    const prompt = buildSystemPrompt(
      "en->th",
      "- term -> คำ",
      {
        previousSummary: "Some summary",
      },
      "custom text",
    );
    const outputIdx = prompt.indexOf("## Output Requirements");
    expect(outputIdx).toBeGreaterThan(0);
    const afterOutput = prompt.slice(outputIdx + "## Output Requirements".length);
    expect(afterOutput).not.toContain("\n## ");
  });

  it("output contract references text delimiters", () => {
    const prompt = buildSystemPrompt("en->th");
    expect(prompt).toContain("<<<BEGIN_TEXT>>>");
    expect(prompt).toContain("<<<END_TEXT>>>");
  });

  it("output contract includes chunk boundary awareness", () => {
    const prompt = buildSystemPrompt("en->th");
    expect(prompt).toContain("segment of a longer chapter");
  });

  // -- buildUserMessage ------------------------------------------------------

  it("buildUserMessage wraps text in delimiters", () => {
    const msg = buildUserMessage("Hello world");
    expect(msg).toContain("<<<BEGIN_TEXT>>>");
    expect(msg).toContain("<<<END_TEXT>>>");
    expect(msg).toContain("Hello world");
    expect(msg).not.toContain("Preceding translation");
  });

  it("buildUserMessage includes previous chunk tail when provided", () => {
    const msg = buildUserMessage("Hello world", "previous text here");
    expect(msg).toContain("previous text here");
    expect(msg).toContain("<<<BEGIN_TEXT>>>");
    expect(msg).toContain("<<<END_TEXT>>>");
    expect(msg.indexOf("previous text here")).toBeLessThan(msg.indexOf("<<<BEGIN_TEXT>>>"));
  });

  it("buildUserMessage skips tail for null/empty/whitespace", () => {
    expect(buildUserMessage("text", null)).not.toContain("Preceding");
    expect(buildUserMessage("text", "")).not.toContain("Preceding");
    expect(buildUserMessage("text", "   ")).not.toContain("Preceding");
  });

  // -- findResidualSourceChars -----------------------------------------------

  it("findResidualSourceChars flags hanzi regardless of pair", () => {
    expect(findResidualSourceChars("zh->th", "สวัสดี【虎哥送嘉年华】ครับ")).toHaveLength(6);
    expect(findResidualSourceChars("zh->en", "clean English text")).toHaveLength(0);
    expect(findResidualSourceChars("zh->th", "ข้อความไทยล้วน")).toHaveLength(0);
    expect(findResidualSourceChars("en->th", "leftover English words")).toHaveLength(0);
    // en->th with CJK = misconfigured sourceLang or model artifact — still flagged.
    expect(findResidualSourceChars("en->th", "เหลือ剩余คำ")).toHaveLength(2);
  });

  // -- buildSummaryPrompt ----------------------------------------------------

  it("buildSummaryPrompt returns structured format with English requirement", () => {
    const summaryPrompt = buildSummaryPrompt("zh->th");
    expect(summaryPrompt).toContain("CRITICAL REQUIREMENT: Always write the summary in ENGLISH");
    expect(summaryPrompt).toContain("PLOT:");
    expect(summaryPrompt).toContain("CHARACTERS:");
    expect(summaryPrompt).toContain("SETTING:");
    expect(summaryPrompt).toContain("CONTEXT:");
  });

  // -- buildTitlePrompt ------------------------------------------------------

  it("buildTitlePrompt names the language pair and demands title-only output", () => {
    const prompt = buildTitlePrompt("zh->th");
    expect(prompt).toContain("Chinese to Thai");
    expect(prompt).toContain("ONLY the translated title");
  });
  it("adds glossary and custom sections before the title-only contract", () => {
    const prompt = buildTitlePrompt(
      "zh->th",
      "- 许野 -> สวี่เหยี่ย (character)",
      "Use the approved title style.",
    );

    expect(prompt).toContain("## Terminology & Glossary");
    expect(prompt).toContain("许野 -> สวี่เหยี่ย");
    expect(prompt).toContain("## Custom Instructions");
    expect(prompt).toContain("Use the approved title style.");
    expect(prompt).not.toContain("relationship context");

    const glossaryIndex = prompt.indexOf("## Terminology & Glossary");
    const customIndex = prompt.indexOf("## Custom Instructions");
    const outputIndex = prompt.indexOf("Output ONLY the translated title");
    expect(glossaryIndex).toBeLessThan(customIndex);
    expect(customIndex).toBeLessThan(outputIndex);
    expect(prompt.slice(outputIndex)).not.toContain("\n## ");
  });

  it("omits empty optional title prompt sections", () => {
    const prompt = buildTitlePrompt("en->th", "  ", "\n");
    expect(prompt).not.toContain("## Terminology & Glossary");
    expect(prompt).not.toContain("## Custom Instructions");
    expect(prompt).toContain("Output ONLY the translated title");
  });

  // -- Shared residual CJK class (JS scanner ↔ SQL pre-filter) ---------------

  it("RESIDUAL_CJK_SQL_RE is a bracket class built from the shared char class", () => {
    expect(RESIDUAL_CJK_SQL_RE).toBe(`[${RESIDUAL_CJK_CLASS}]`);
  });

  it("SQL class matches exactly what the JS scanner flags", () => {
    // The DB pre-filter and the JS counter must agree, or the badge would
    // miss chapters the repair pass flags (or vice versa).
    const sqlRe = new RegExp(RESIDUAL_CJK_SQL_RE);
    const samples = [
      "ภาคที่หนึ่ง 第一章 เข้าสู่", // unified ideographs in Thai prose
      "㐀", // ext-A
      "豈", // compat ideograph
      "clean English text",
      "ข้อความไทยล้วน", // pure Thai
      "",
    ];
    for (const s of samples) {
      expect(sqlRe.test(s)).toBe(findResidualSourceChars("zh->th", s).length > 0);
    }
  });
  it("keeps relationship context pairs referentially closed at the shared cap", () => {
    const timestamp = "2026-01-01T00:00:00.000Z";
    const characters = Array.from({ length: 26 }, (_, index) => ({
      id: `character-${index}`,
      sourceName: `character-${String(index).padStart(2, "0")}`,
      targetName: null,
      aliases: [],
      gender: "unknown" as const,
      role: null,
      notes: null,
      enabled: true,
      locked: false,
      evidence: null,
      lastSeenChapter: null,
      updatedAt: timestamp,
    }));
    const relationships = Array.from({ length: 13 }, (_, index) => ({
      id: `relationship-${index}`,
      speakerId: `character-${index * 2}`,
      listenerId: `character-${index * 2 + 1}`,
      relationship: "friend",
      speakerStatus: "peer" as const,
      familiarity: "close" as const,
      selfPronoun: null,
      addresseeTerm: null,
      sentenceParticles: null,
      register: null,
      notes: null,
      enabled: true,
      locked: false,
      evidence: null,
      lastSeenChapter: null,
      updatedAt: timestamp,
    }));
    const map = relationshipMapSchema.parse({ version: 1, characters, relationships });
    const context = buildRelationshipPromptContext(
      map,
      relationships.map((relationship) => ({
        speaker: characters.find((character) => character.id === relationship.speakerId)!
          .sourceName,
        listener: characters.find((character) => character.id === relationship.listenerId)!
          .sourceName,
      })),
    );
    const prompt = formatRelationshipContext(context);
    const projection = JSON.parse(prompt.slice(prompt.lastIndexOf("\n") + 1)) as {
      characters: Array<{ id: string }>;
      relationships: Array<{ id: string; speakerId: string; listenerId: string }>;
      activePairs: Array<{ speakerId: string; listenerId: string; relationshipId?: string }>;
    };
    const characterIds = new Set(projection.characters.map((character) => character.id));

    expect(projection.characters).toHaveLength(24);
    expect(projection.relationships).toHaveLength(12);
    expect(projection.activePairs).toHaveLength(12);
    expect(projection.relationships.some((item) => item.id === "relationship-12")).toBe(false);
    expect(
      projection.relationships.every(
        (item) => characterIds.has(item.speakerId) && characterIds.has(item.listenerId),
      ),
    ).toBe(true);
    expect(
      projection.activePairs.every(
        (item) => characterIds.has(item.speakerId) && characterIds.has(item.listenerId),
      ),
    ).toBe(true);
    expect(prompt).not.toContain('"evidence"');
  });
});
