import { describe, expect, it } from "vitest";

import {
  buildRelationshipAnalysisPrompt,
  buildRelationshipAnalysisUserMessage,
  parseRelationshipAnalysis,
} from "./analysis-prompt";
import { emptyRelationshipMap } from "./map";
import { relationshipMapSchema } from "./schemas";

const validResponse = JSON.stringify({
  characters: [
    {
      sourceName: "儿子",
      targetName: "ลูกชาย",
      aliases: [],
      gender: "male",
      role: "son",
      notes: null,
      evidence: "儿子说",
    },
  ],
  relationships: [
    {
      speaker: "儿子",
      listener: "父亲",
      relationship: "son",
      speakerStatus: "lower",
      familiarity: "close",
      selfPronoun: "ผม",
      addresseeTerm: "พ่อ",
      sentenceParticles: null,
      register: "respectful",
      notes: null,
      evidence: "儿子说",
    },
  ],
  activePairs: [{ speaker: "儿子", listener: "父亲", evidence: "儿子说" }],
});

describe("relationship analysis prompt", () => {
  it("passes bounded map, glossary, summary, and source-window context", () => {
    const system = buildRelationshipAnalysisPrompt({
      pair: "zh->th",
      existingMap: emptyRelationshipMap(),
      approvedMappings: [{ source: "父亲", target: "พ่อ" }],
      storySummary: "The son is speaking with his father.",
      previousSourceTail: "父亲看着儿子。",
      currentChunk: "儿子说：我会回来。",
    });
    const user = buildRelationshipAnalysisUserMessage({
      previousSourceTail: "父亲看着儿子。",
      currentChunk: "儿子说：我会回来。",
    });

    expect(system).toContain("zh->th");
    expect(system).toContain("父亲");
    expect(system).toContain("พ่อ");
    expect(system).toContain("Do not invent");
    expect(system).toContain("Never infer or output Thai speech choices");
    expect(system).not.toContain("selfPronoun");
    expect(system).not.toContain("addresseeTerm");
    expect(system).not.toContain("sentenceParticles");
    expect(user).toContain("父亲看着儿子");
    expect(user).toContain("<<<BEGIN_CURRENT_SOURCE>>>");
    expect(user).toContain("儿子说：我会回来");
  });
  it("strips legacy exact speech fields from provider output", () => {
    const relationship = parseRelationshipAnalysis(validResponse)?.relationships[0];

    expect(relationship).toEqual({
      speaker: "儿子",
      listener: "父亲",
      relationship: "son",
      speakerStatus: "lower",
      familiarity: "close",
      register: "respectful",
      notes: null,
      evidence: "儿子说",
    });
    expect(relationship).not.toHaveProperty("selfPronoun");
    expect(relationship).not.toHaveProperty("addresseeTerm");
    expect(relationship).not.toHaveProperty("sentenceParticles");
  });
  it("hides stored exact speech fields from automatic analysis", () => {
    const timestamp = "2026-01-01T00:00:00.000Z";
    const map = relationshipMapSchema.parse({
      version: 1,
      characters: [
        {
          id: "speaker",
          sourceName: "甲",
          targetName: "ตัวเอก",
          aliases: [],
          gender: "male",
          role: null,
          notes: null,
          enabled: true,
          locked: false,
          evidence: null,
          lastSeenChapter: null,
          updatedAt: timestamp,
        },
        {
          id: "listener",
          sourceName: "乙",
          targetName: "คู่สนทนา",
          aliases: [],
          gender: "female",
          role: null,
          notes: null,
          enabled: true,
          locked: false,
          evidence: null,
          lastSeenChapter: null,
          updatedAt: timestamp,
        },
      ],
      relationships: [
        {
          id: "pair",
          speakerId: "speaker",
          listenerId: "listener",
          relationship: "friend",
          speakerStatus: "peer",
          familiarity: "close",
          selfPronoun: "ฉัน",
          addresseeTerm: "เธอ",
          sentenceParticles: "นะ",
          register: "informal",
          notes: null,
          enabled: true,
          locked: true,
          evidence: "甲对乙说",
          lastSeenChapter: 1,
          updatedAt: timestamp,
        },
      ],
    });
    const prompt = buildRelationshipAnalysisPrompt({
      pair: "zh->th",
      existingMap: map,
      approvedMappings: [],
      currentChunk: "甲对乙说：你好。",
    });

    expect(prompt).not.toContain("selfPronoun");
    expect(prompt).not.toContain("addresseeTerm");
    expect(prompt).not.toContain("sentenceParticles");
    expect(prompt).not.toContain("ฉัน");
    expect(prompt).not.toContain("เธอ");
    expect(prompt).not.toContain("นะ");
  });

  it("parses plain and fenced JSON while requiring evidence", () => {
    expect(parseRelationshipAnalysis(validResponse)?.activePairs).toEqual([
      { speaker: "儿子", listener: "父亲", evidence: "儿子说" },
    ]);
    expect(
      parseRelationshipAnalysis(`analysis:\n\`\`\`json\n${validResponse}\n\`\`\``)?.characters,
    ).toHaveLength(1);
    expect(
      parseRelationshipAnalysis(
        JSON.stringify({ characters: [], relationships: [], activePairs: [] }),
      ),
    ).toEqual({
      characters: [],
      relationships: [],
      activePairs: [],
    });
    expect(
      parseRelationshipAnalysis(
        JSON.stringify({
          characters: [{ sourceName: "儿子", evidence: "not in schema?" }],
          relationships: [],
          activePairs: [],
        }),
      ),
    ).not.toBeNull();
    expect(
      parseRelationshipAnalysis(
        JSON.stringify({
          characters: [{ sourceName: "儿子", targetName: null, aliases: [], gender: "male" }],
          relationships: [],
          activePairs: [],
        }),
      ),
    ).toBeNull();
  });

  it("normalizes common endpoint and field aliases", () => {
    const result = parseRelationshipAnalysis(
      JSON.stringify({
        characters: [
          {
            name: "儿子",
            target: "ลูกชาย",
            alias: "小儿",
            gender: "unknown",
            note: "child",
            evidence: "儿子",
          },
        ],
        relationships: [
          {
            speakerName: "儿子",
            listenerName: "父亲",
            label: "son",
            pronoun: "ผม",
            title: "พ่อ",
            particles: "",
            evidence: "儿子",
          },
        ],
        activePairs: [{ speakerName: "儿子", listenerName: "父亲", evidence: "儿子" }],
      }),
    );
    expect(result?.characters[0]?.aliases).toEqual(["小儿"]);
    expect(result?.relationships[0]).toEqual({
      speaker: "儿子",
      listener: "父亲",
      relationship: "son",
      speakerStatus: "unknown",
      familiarity: "unknown",
      register: null,
      notes: null,
      evidence: "儿子",
    });
  });

  it("bounds analysis context to relevant entries with referential relationships", () => {
    const timestamp = "2026-01-01T00:00:00.000Z";
    const makeCharacter = (id: string, sourceName: string) => ({
      id,
      sourceName,
      targetName: null,
      aliases: [],
      gender: "unknown" as const,
      role: null,
      notes: "stored-note-sentinel",
      enabled: true,
      locked: false,
      evidence: null,
      lastSeenChapter: null,
      updatedAt: timestamp,
    });
    const makeRelationship = (id: string, speakerId: string, listenerId: string) => ({
      id,
      speakerId,
      listenerId,
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
    });
    const currentNames = Array.from(
      { length: 30 },
      (_, index) => `current-${String(index).padStart(2, "0")}`,
    );
    const tailNames = Array.from(
      { length: 6 },
      (_, index) => `tail-${String(index).padStart(2, "0")}`,
    );
    const irrelevantNames = Array.from(
      { length: 12 },
      (_, index) => `irrelevant-${String(index).padStart(2, "0")}`,
    );
    const characters = [
      ...currentNames.map((name, index) => makeCharacter(`current-${index}`, name)),
      ...tailNames.map((name, index) => makeCharacter(`tail-${index}`, name)),
      ...irrelevantNames.map((name, index) => makeCharacter(`irrelevant-${index}`, name)),
    ];
    const relationships = [
      ...Array.from({ length: 24 }, (_, index) =>
        makeRelationship(
          `current-relation-${index}`,
          `current-${index}`,
          `current-${(index + 1) % 24}`,
        ),
      ),
      makeRelationship("unselected-relation", "current-24", "current-25"),
      makeRelationship("irrelevant-relation", "irrelevant-0", "irrelevant-1"),
    ];
    const map = relationshipMapSchema.parse({ version: 1, characters, relationships });
    const prompt = buildRelationshipAnalysisPrompt({
      pair: "zh->th",
      existingMap: map,
      approvedMappings: [
        ...currentNames.map((source) => ({ source, target: `${source}-th` })),
        ...tailNames.map((source) => ({ source, target: `${source}-th` })),
        { source: "irrelevant-00", target: "irrelevant-th" },
      ],
      previousSourceTail: tailNames.join(" "),
      currentChunk: currentNames.join(" "),
    });
    const mapPrefix = "Existing enabled relationship map:\n";
    const mappingsPrefix = "\nApproved character glossary mappings:";
    const mapStart = prompt.indexOf(mapPrefix) + mapPrefix.length;
    const mapEnd = prompt.indexOf(mappingsPrefix, mapStart);
    const projected = JSON.parse(prompt.slice(mapStart, mapEnd)) as {
      characters: Array<{ id: string }>;
      relationships: Array<{ speakerId: string; listenerId: string }>;
    };
    const mappingsStart = mapEnd + mappingsPrefix.length;
    const summaryPrefix = "\nRolling story summary";
    const mappings = JSON.parse(
      prompt.slice(mappingsStart, prompt.indexOf(summaryPrefix, mappingsStart)),
    );

    expect(projected.characters).toHaveLength(24);
    expect(projected.relationships).toHaveLength(24);
    expect(mappings).toHaveLength(24);
    expect(projected.characters.every((item) => item.id.startsWith("current-"))).toBe(true);
    const characterIds = new Set(projected.characters.map((item) => item.id));
    expect(
      projected.relationships.every(
        (item) => characterIds.has(item.speakerId) && characterIds.has(item.listenerId),
      ),
    ).toBe(true);
    expect(prompt).not.toContain("stored-note-sentinel");
    expect(prompt).not.toContain("irrelevant-00");
  });
});
