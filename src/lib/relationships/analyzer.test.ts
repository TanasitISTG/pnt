import { beforeEach, describe, expect, it, vi } from "vitest";

import * as jobStore from "@/lib/translation/workflow/job-store";
import type { AIProviderClient } from "@/lib/translation/types/provider";
import {
  analyzeChunkRelationshipsForChunk,
  analyzeRelationshipSourceChunk,
  type ChunkRelationshipAnalysisInput,
} from "./analyzer";
import { relationshipMapSchema } from "./schemas";

vi.mock("@/lib/translation/workflow/job-store", () => ({
  applyRelationshipAnalysis: vi.fn(),
}));

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

function recordingProvider(response: unknown) {
  const generateChatCompletion = vi.fn(
    async (_request: { messages: Array<{ role: string; content: string }> }) => ({
      content: JSON.stringify(response) ?? "",
      usage: { promptTokens: 3, completionTokens: 2 },
    }),
  );
  const client = {
    provider: "openai",
    model: "main-model",
    fastModel: "fast-model",
    temperature: 0.7,
    baseUrl: "http://localhost",
    generateChatCompletion,
  } as unknown as AIProviderClient;
  return { client, generateChatCompletion };
}

beforeEach(() => {
  vi.resetAllMocks();
});

const baseNovel = {
  id: "novel-1",
  sourceLang: "zh",
  targetLang: "th",
  contextTailLength: 500,
  relationshipMapJson: null as string | null,
  storySummary: null as string | null,
};

function analysisInput(
  overrides: Partial<ChunkRelationshipAnalysisInput> = {},
): ChunkRelationshipAnalysisInput {
  return {
    jobId: "job-1",
    generation: 3,
    novel: baseNovel,
    chapter: { number: "1" },
    chunk: { index: 0, sourceText: "甲走进房间。" },
    previousChunk: null,
    approvedTerms: [],
    previousChapter: null,
    providerConfig: null,
    providerFailure: null,
    ...overrides,
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
  it("retains semantic pairs while discarding legacy automatic speech fields", async () => {
    const map = mapWith(
      [character("speaker", "甲"), character("listener", "乙")],
      [
        relationship("pair", "speaker", "listener", {
          selfPronoun: "我",
          addresseeTerm: "你",
          sentenceParticles: "吧",
        }),
      ],
    );
    const result = await analyzeRelationshipSourceChunk({
      pair: "zh->th",
      providerConfig: provider({
        characters: [],
        relationships: [
          {
            speaker: "甲",
            listener: "乙",
            relationship: "friend",
            speakerStatus: "peer",
            familiarity: "close",
            selfPronoun: "我",
            addresseeTerm: "你",
            sentenceParticles: "吧",
            evidence: "甲对乙说",
          },
        ],
        activePairs: [{ speaker: "甲", listener: "乙", evidence: "甲对乙说" }],
      }),
      existingMap: map,
      approvedMappings: [],
      previousSourceTail: null,
      currentChunk: "甲对乙说：我知道吧。",
      chapterNumber: 1,
    });

    expect(result.analysis?.relationships[0]).toEqual({
      speaker: "甲",
      listener: "乙",
      relationship: "friend",
      speakerStatus: "peer",
      familiarity: "close",
      register: null,
      notes: null,
      evidence: "甲对乙说",
    });
    expect(result.analysis?.relationships[0]).not.toHaveProperty("selfPronoun");
    expect(result.analysis?.relationships[0]).not.toHaveProperty("addresseeTerm");
    expect(result.analysis?.relationships[0]).not.toHaveProperty("sentenceParticles");
    expect(result.map.relationships[0]).toMatchObject({
      selfPronoun: null,
      addresseeTerm: null,
      sentenceParticles: null,
    });
    expect(result.context?.relationships[0]).toMatchObject({
      selfPronoun: null,
      addresseeTerm: null,
      sentenceParticles: null,
    });
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
  it("retries invalid relationship output through the fourth attempt", async () => {
    const generateChatCompletion = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary provider failure"))
      .mockResolvedValueOnce({
        content: "not json",
        usage: { promptTokens: 3, completionTokens: 2 },
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({ unexpected: [] }),
        usage: { promptTokens: 3, completionTokens: 2 },
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({ characters: [], relationships: [], activePairs: [] }),
        usage: { promptTokens: 3, completionTokens: 2 },
      });
    const providerConfig = { ...provider(null), generateChatCompletion } as AIProviderClient;

    const result = await analyzeRelationshipSourceChunk({
      pair: "zh->th",
      providerConfig,
      existingMap: mapWith([]),
      approvedMappings: [],
      previousSourceTail: null,
      currentChunk: "甲走进房间。",
      chapterNumber: 1,
    });

    expect(generateChatCompletion).toHaveBeenCalledTimes(4);
    expect(result.analysis).toEqual({ characters: [], relationships: [], activePairs: [] });
    expect(result.warning).toBeNull();
    expect(result.promptTokens).toBe(9);
    expect(result.completionTokens).toBe(6);
  });
  it("keeps stored relationship context after retry exhaustion", async () => {
    const map = mapWith(
      [character("a", "甲"), character("b", "乙")],
      [relationship("pair", "a", "b")],
    );
    const generateChatCompletion = vi.fn().mockRejectedValue(new Error("provider unavailable"));
    const providerConfig = { ...provider(null), generateChatCompletion } as AIProviderClient;

    const result = await analyzeRelationshipSourceChunk({
      pair: "zh->th",
      providerConfig,
      existingMap: map,
      approvedMappings: [],
      previousSourceTail: null,
      currentChunk: "甲和乙一起走。",
      chapterNumber: 1,
    });

    expect(generateChatCompletion).toHaveBeenCalledTimes(4);
    expect(result.analysis).toBeNull();
    expect(result.context?.activePairs).toEqual([
      { speakerId: "a", listenerId: "b", relationshipId: "pair" },
    ]);
    expect(result.warning).toBe("Relationship analysis failed: provider unavailable.");
    expect(result.promptTokens).toBe(0);
    expect(result.completionTokens).toBe(0);
  });
});

describe("chunk relationship analysis", () => {
  it.each(["en->th", "zh->en", "zh->th"] as const)(
    "runs automatic analysis for %s",
    async (pair) => {
      const [sourceLang, targetLang] = pair.split("->");
      const providerConfig = provider({
        characters: [],
        relationships: [],
        activePairs: [],
      });

      const result = await analyzeChunkRelationshipsForChunk(
        analysisInput({
          novel: { ...baseNovel, sourceLang: sourceLang!, targetLang: targetLang! },
          providerConfig,
        }),
      );

      expect(result.warning).toBeNull();
      expect(result.promptTokens).toBe(3);
      expect(result.completionTokens).toBe(2);
      expect(result.context).toEqual(null);
    },
  );

  it("silently skips unsupported pairs before calling the provider", async () => {
    const { client, generateChatCompletion } = recordingProvider({
      characters: [],
      relationships: [],
      activePairs: [],
    });

    const result = await analyzeChunkRelationshipsForChunk(
      analysisInput({
        novel: { ...baseNovel, sourceLang: "en", targetLang: "en" },
        providerConfig: client,
      }),
    );

    expect(generateChatCompletion).not.toHaveBeenCalled();
    expect(result).toEqual({
      context: null,
      warning: null,
      promptTokens: 0,
      completionTokens: 0,
    });
  });

  it("returns stored context when the provider is unavailable", async () => {
    const storedMap = mapWith(
      [character("a", "甲"), character("b", "乙")],
      [relationship("pair", "a", "b")],
    );

    const result = await analyzeChunkRelationshipsForChunk(
      analysisInput({
        novel: { ...baseNovel, relationshipMapJson: JSON.stringify(storedMap) },
        chunk: { index: 0, sourceText: "甲和乙一起走。" },
        providerConfig: null,
        providerFailure: "provider unavailable",
      }),
    );

    expect(result.context?.activePairs).toEqual([
      { speakerId: "a", listenerId: "b", relationshipId: "pair" },
    ]);
    expect(result.warning).toBe("Relationship analysis unavailable: provider unavailable.");
    expect(result.promptTokens).toBe(0);
    expect(result.completionTokens).toBe(0);
  });

  it("feeds the preceding source tail into the analysis prompt", async () => {
    const { client, generateChatCompletion } = recordingProvider({
      characters: [],
      relationships: [],
      activePairs: [],
    });

    await analyzeChunkRelationshipsForChunk(
      analysisInput({
        chunk: { index: 1, sourceText: "甲走进房间。" },
        previousChunk: { sourceText: "前一段的原文" },
        providerConfig: client,
      }),
    );

    const request = generateChatCompletion.mock.calls[0]?.[0];
    expect(request.messages.some((message) => message.content.includes("前一段的原文"))).toBe(true);
  });

  it("falls back to the previous chapter raw tail for the first chunk", async () => {
    const { client, generateChatCompletion } = recordingProvider({
      characters: [],
      relationships: [],
      activePairs: [],
    });

    await analyzeChunkRelationshipsForChunk(
      analysisInput({
        previousChapter: {
          summary: "上一章概要",
          rawTail: "上一章的原文尾巴",
          translatedTail: "prev translated",
        },
        providerConfig: client,
      }),
    );

    const request = generateChatCompletion.mock.calls[0]?.[0];
    expect(request.messages.some((message) => message.content.includes("上一章的原文尾巴"))).toBe(
      true,
    );
  });

  it("persists source-evidenced facts through the guarded job-owned write", async () => {
    const storedMap = mapWith([character("a", "甲"), character("b", "乙")]);
    const { client } = recordingProvider({
      characters: [],
      relationships: [
        {
          speaker: "甲",
          listener: "乙",
          relationship: "friend",
          speakerStatus: "peer",
          familiarity: "close",
          selfPronoun: null,
          addresseeTerm: null,
          sentenceParticles: null,
          evidence: "甲和乙",
        },
      ],
      activePairs: [{ speaker: "甲", listener: "乙", evidence: "甲和乙" }],
    });
    vi.mocked(jobStore.applyRelationshipAnalysis).mockResolvedValue({
      applied: true,
      map: null,
      warnings: [],
    } as never);

    await analyzeChunkRelationshipsForChunk(
      analysisInput({
        novel: { ...baseNovel, relationshipMapJson: JSON.stringify(storedMap) },
        chunk: { index: 2, sourceText: "甲和乙一起走。" },
        providerConfig: client,
      }),
    );

    expect(jobStore.applyRelationshipAnalysis).toHaveBeenCalledWith(
      "job-1",
      3,
      2,
      expect.objectContaining({
        activePairs: [expect.objectContaining({ speaker: "甲", listener: "乙" })],
      }),
    );
  });
});
