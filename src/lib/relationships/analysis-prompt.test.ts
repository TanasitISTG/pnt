import { describe, expect, it } from "vitest";

import {
  buildRelationshipAnalysisPrompt,
  buildRelationshipAnalysisUserMessage,
  parseRelationshipAnalysis,
} from "./analysis-prompt";
import { emptyRelationshipMap } from "./map";

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
  activePairs: [{ speaker: "儿子", listener: "父亲" }],
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
    expect(system).toContain("Never infer a global Thai mapping for Chinese 我 or 你");
    expect(user).toContain("父亲看着儿子");
    expect(user).toContain("<<<BEGIN_CURRENT_SOURCE>>>");
    expect(user).toContain("儿子说：我会回来");
  });

  it("parses plain and fenced JSON while requiring evidence", () => {
    expect(parseRelationshipAnalysis(validResponse)?.activePairs).toEqual([
      { speaker: "儿子", listener: "父亲" },
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
        activePairs: [{ speakerName: "儿子", listenerName: "父亲" }],
      }),
    );
    expect(result?.characters[0]?.aliases).toEqual(["小儿"]);
    expect(result?.relationships[0]?.selfPronoun).toBe("ผม");
  });
});
