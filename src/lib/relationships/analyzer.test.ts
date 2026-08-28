import { describe, expect, it } from "vitest";

import type { AIProviderClient } from "@/lib/translation/translation.types";
import { analyzeRelationshipSourceChunk } from "./analyzer";
import { relationshipMapSchema } from "./schemas";

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

function mapWith(
  characters: ReturnType<typeof character>[],
  relationships: ReturnType<typeof relationship>[] = [],
) {
  return relationshipMapSchema.parse({ version: 1, characters, relationships });
}

function provider(response: unknown): AIProviderClient {
  return {
    provider: "openai",
    model: "main-model",
    fastModel: "fast-model",
    temperature: 0.7,
    baseUrl: "http://localhost",
    generateChatCompletion: async () => ({
      content: JSON.stringify(response) ?? "",
      usage: { promptTokens: 3, completionTokens: 2 },
    }),
  };
}

describe("relationship source analyzer", () => {
  it("canonicalizes aliases in returned active pairs", async () => {
    const map = mapWith([
      character("son", "儿子"),
      character("father", "父亲", { aliases: ["爸爸"] }),
    ]);
    const result = await analyzeRelationshipSourceChunk({
      pair: "zh->th",
      providerConfig: provider({
        characters: [],
        relationships: [],
        activePairs: [{ speaker: "儿子", listener: "爸爸", evidence: "爸爸" }],
      }),
      existingMap: map,
      approvedMappings: [],
      previousSourceTail: null,
      currentChunk: "儿子喊道：爸爸！",
      chapterNumber: 1,
    });

    expect(result.analysis?.activePairs).toEqual([
      { speaker: "儿子", listener: "父亲", evidence: "爸爸" },
    ]);
  });

  it("reuses a stored locked relationship when no replacement is analyzed", async () => {
    const map = mapWith(
      [character("son", "儿子"), character("father", "父亲")],
      [
        relationship("pair", "son", "father", {
          locked: true,
          selfPronoun: "ผม",
          relationship: "son",
        }),
      ],
    );
    const result = await analyzeRelationshipSourceChunk({
      pair: "zh->th",
      providerConfig: provider({
        characters: [],
        relationships: [],
        activePairs: [{ speaker: "儿子", listener: "父亲", evidence: "儿子" }],
      }),
      existingMap: map,
      approvedMappings: [],
      previousSourceTail: null,
      currentChunk: "儿子说。",
      chapterNumber: 1,
    });

    expect(result.context?.activePairs).toHaveLength(1);
    expect(result.context?.relationships[0]?.selfPronoun).toBe("ผม");
  });

  it("does not let unrelated stored evidence authorize a new pair", async () => {
    const map = mapWith(
      [character("a", "甲"), character("b", "乙"), character("c", "丙"), character("d", "丁")],
      [relationship("old", "c", "d", { evidence: "旧证据" })],
    );
    const result = await analyzeRelationshipSourceChunk({
      pair: "zh->th",
      providerConfig: provider({
        characters: [],
        relationships: [
          {
            speaker: "甲",
            listener: "乙",
            relationship: "new",
            evidence: "旧证据",
          },
        ],
        activePairs: [{ speaker: "甲", listener: "乙", evidence: "旧证据" }],
      }),
      existingMap: map,
      approvedMappings: [],
      previousSourceTail: null,
      currentChunk: "甲看见了乙。",
      chapterNumber: 1,
    });

    expect(result.map.relationships).toHaveLength(1);
    expect(result.analysis?.relationships).toEqual([]);
    expect(result.analysis?.activePairs).toEqual([]);
  });

  it("does not persist or activate evidence found only in the preceding tail", async () => {
    const map = mapWith([character("a", "甲"), character("b", "乙")]);
    const result = await analyzeRelationshipSourceChunk({
      pair: "zh->th",
      providerConfig: provider({
        characters: [],
        relationships: [
          {
            speaker: "甲",
            listener: "乙",
            relationship: "old",
            evidence: "甲看见了乙",
          },
        ],
        activePairs: [{ speaker: "甲", listener: "乙", evidence: "甲看见了乙" }],
      }),
      existingMap: map,
      approvedMappings: [],
      previousSourceTail: "甲看见了乙。",
      currentChunk: "丙走开了。",
      chapterNumber: 1,
    });

    expect(result.map.relationships).toEqual([]);
    expect(result.analysis?.relationships).toEqual([]);
    expect(result.analysis?.activePairs).toEqual([]);
  });
});
