import { describe, expect, it } from "vitest";

import {
  buildRelationshipPromptContext,
  emptyRelationshipMap,
  mergeAutomaticRelationshipAnalysis,
  parseRelationshipMap,
  serializeRelationshipMap,
} from "./map";
import { relationshipAnalysisSchema, relationshipMapSchema } from "./schemas";

const updatedAt = "2026-01-01T00:00:00.000Z";

function character(id: string, sourceName: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    sourceName,
    targetName: null,
    aliases: [],
    gender: "unknown" as const,
    role: null,
    notes: null,
    enabled: true,
    locked: false,
    evidence: null,
    lastSeenChapter: null,
    updatedAt,
    ...overrides,
  };
}

function relationship(
  id: string,
  speakerId: string,
  listenerId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
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
    updatedAt,
    ...overrides,
  };
}

function analysis() {
  return relationshipAnalysisSchema.parse({
    characters: [
      {
        sourceName: "父亲",
        targetName: "พ่อ",
        aliases: [],
        gender: "male",
        role: "father",
        notes: null,
        evidence: "父亲",
      },
      {
        sourceName: "儿子",
        targetName: "ลูกชาย",
        aliases: [],
        gender: "male",
        role: "son",
        notes: null,
        evidence: "儿子",
      },
    ],
    relationships: [
      {
        speaker: "儿子",
        listener: "父亲",
        relationship: "son",
        speakerStatus: "lower",
        familiarity: "close",
        selfPronoun: "ฉัน",
        addresseeTerm: "พ่อ",
        sentenceParticles: null,
        register: "respectful",
        evidence: "儿子",
      },
    ],
    activePairs: [{ speaker: "儿子", listener: "父亲", evidence: "儿子" }],
  });
}

describe("relationship map", () => {
  it("fails closed for malformed, duplicate, and over-limit documents", () => {
    expect(parseRelationshipMap("not json")).toBeNull();
    expect(
      parseRelationshipMap(JSON.stringify({ version: 1, characters: [], relationships: [] })),
    ).not.toBeNull();

    const tooManyCharacters = {
      version: 1 as const,
      characters: Array.from({ length: 201 }, (_, index) =>
        character(`c-${index}`, `name-${index}`),
      ),
      relationships: [],
    };
    expect(relationshipMapSchema.safeParse(tooManyCharacters).success).toBe(false);

    const duplicateNames = {
      version: 1 as const,
      characters: [character("c-1", "Lin"), character("c-2", " lin ")],
      relationships: [],
    };
    expect(relationshipMapSchema.safeParse(duplicateNames).success).toBe(false);
  });

  it("round-trips a valid versioned map", () => {
    const map = {
      version: 1 as const,
      characters: [character("c-1", "父亲")],
      relationships: [],
    };
    expect(parseRelationshipMap(serializeRelationshipMap(map))).toEqual(map);
  });

  it("merges evidenced automatic facts as directed pairs", () => {
    const result = mergeAutomaticRelationshipAnalysis(
      emptyRelationshipMap(),
      analysis(),
      [],
      3,
      updatedAt,
    );
    expect(result.warnings).toEqual([]);
    expect(result.map.characters).toHaveLength(2);
    expect(result.map.relationships).toHaveLength(1);
    expect(result.map.relationships[0]?.speakerId).toBe(
      result.map.characters.find((item) => item.sourceName === "儿子")?.id,
    );
    expect(result.map.relationships[0]?.listenerId).toBe(
      result.map.characters.find((item) => item.sourceName === "父亲")?.id,
    );
  });

  it("keeps automatic replay byte-identical", () => {
    const initial = mergeAutomaticRelationshipAnalysis(
      emptyRelationshipMap(),
      analysis(),
      [],
      3,
      updatedAt,
    ).map;
    const replay = mergeAutomaticRelationshipAnalysis(
      initial,
      analysis(),
      [],
      3,
      "2026-01-02T00:00:00.000Z",
    ).map;

    expect(serializeRelationshipMap(replay)).toBe(serializeRelationshipMap(initial));
  });

  it("keeps the highest chapter after an earlier retranslation", () => {
    const initial = mergeAutomaticRelationshipAnalysis(
      emptyRelationshipMap(),
      analysis(),
      [],
      3,
      updatedAt,
    ).map;
    const earlier = mergeAutomaticRelationshipAnalysis(
      initial,
      analysis(),
      [],
      1,
      "2026-01-02T00:00:00.000Z",
    ).map;

    expect(earlier.characters.every((item) => item.lastSeenChapter === 3)).toBe(true);
    expect(earlier.relationships.every((item) => item.lastSeenChapter === 3)).toBe(true);
  });

  it("keeps locked and disabled entries against conflicting analysis", () => {
    const map = {
      version: 1 as const,
      characters: [
        character("father", "父亲", {
          gender: "male",
          locked: true,
          targetName: "พ่อ",
          evidence: "old evidence",
        }),
        character("son", "儿子", { locked: true }),
      ],
      relationships: [
        relationship("son-to-father", "son", "father", {
          selfPronoun: "ผม",
          enabled: false,
          locked: true,
          evidence: "manual evidence",
        }),
      ],
    };
    const result = mergeAutomaticRelationshipAnalysis(map, analysis(), [], 4, updatedAt);
    expect(result.map.characters[0]).toEqual(map.characters[0]);
    expect(result.map.relationships[0]).toEqual(map.relationships[0]);
  });

  it("lets approved glossary character targets win automatic output", () => {
    const result = mergeAutomaticRelationshipAnalysis(
      emptyRelationshipMap(),
      analysis(),
      [{ source: "父亲", target: "父親（ approved ）" }],
      1,
      updatedAt,
    );
    expect(result.map.characters.find((item) => item.sourceName === "父亲")?.targetName).toBe(
      "父親（ approved ）",
    );
  });

  it("keeps locked speech fields over current-scene overlays", () => {
    const map = {
      version: 1 as const,
      characters: [character("son", "儿子"), character("father", "父亲")],
      relationships: [
        relationship("pair", "son", "father", {
          locked: true,
          selfPronoun: "ผม",
          evidence: "manual",
        }),
      ],
    };
    const context = buildRelationshipPromptContext(map, [
      {
        speaker: "儿子",
        listener: "父亲",
        relationship: "current scene label",
        selfPronoun: "ฉัน",
      },
    ]);
    expect(context.activePairs).toHaveLength(1);
    expect(context.relationships[0]?.selfPronoun).toBe("ผม");
  });
});
