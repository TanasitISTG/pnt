import { beforeEach, describe, expect, it, vi } from "vitest";

import * as jobStore from "@/lib/translation/workflow/job-store";
import * as providerClientModule from "@/lib/translation/providers/provider-client";
import type { AIProviderClient } from "@/lib/translation/types/provider";
import { analyzeChunkRelationships, analyzeRelationshipSourceChunk } from "./analyzer";
import { relationshipMapSchema } from "./schemas";

vi.mock("@/lib/translation/workflow/job-store", () => ({
  applyRelationshipAnalysis: vi.fn(),
  loadApprovedTermsForContext: vi.fn(),
  loadJobChunk: vi.fn(),
  loadPrevChapterForContext: vi.fn(),
}));
vi.mock("@/lib/translation/providers/provider-client", () => ({ createProviderClient: vi.fn() }));

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

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(jobStore.loadApprovedTermsForContext).mockResolvedValue([]);
  vi.mocked(jobStore.loadPrevChapterForContext).mockResolvedValue(null as never);
});
const runnableChunkRow = {
  job: {
    id: "job-1",
    status: "running",
    generation: 3,
    sourceRevision: 7,
    doneChunks: 0,
  },
  chapter: {
    number: "1",
    activeTranslationJobId: "job-1",
    translationGeneration: 3,
    sourceRevision: 7,
  },
  novel: {
    id: "novel-1",
    userId: "user-1",
    sourceLang: "zh",
    targetLang: "th",
    contextTailLength: 500,
    relationshipMapJson: null,
    storySummary: null,
  },
  chunk: { sourceText: "甲走进房间。" },
  previousChunk: null,
};

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

describe("chunk relationship provider setup", () => {
  it("uses the provider created on the fourth attempt", async () => {
    const providerConfig = provider({
      characters: [],
      relationships: [],
      activePairs: [],
    });
    vi.mocked(jobStore.loadJobChunk).mockResolvedValue(runnableChunkRow as never);
    vi.mocked(providerClientModule.createProviderClient)
      .mockRejectedValueOnce(new Error("provider unavailable"))
      .mockRejectedValueOnce(new Error("provider unavailable"))
      .mockRejectedValueOnce(new Error("provider unavailable"))
      .mockResolvedValueOnce(providerConfig);

    const result = await analyzeChunkRelationships("job-1", 0, 3);

    expect(providerClientModule.createProviderClient).toHaveBeenCalledTimes(4);
    expect(providerClientModule.createProviderClient).toHaveBeenCalledWith("user-1");
    expect(result.warning).toBeNull();
    expect(result.promptTokens).toBe(3);
    expect(result.completionTokens).toBe(2);
  });

  it("returns stored context when provider creation exhausts its retries", async () => {
    const storedMap = mapWith(
      [character("a", "甲"), character("b", "乙")],
      [relationship("pair", "a", "b")],
    );
    vi.mocked(jobStore.loadJobChunk).mockResolvedValue({
      ...runnableChunkRow,
      novel: {
        ...runnableChunkRow.novel,
        relationshipMapJson: JSON.stringify(storedMap),
      },
      chunk: { sourceText: "甲和乙一起走。" },
    } as never);
    vi.mocked(providerClientModule.createProviderClient).mockRejectedValue(
      new Error("provider unavailable"),
    );

    const result = await analyzeChunkRelationships("job-1", 0, 3);

    expect(providerClientModule.createProviderClient).toHaveBeenCalledTimes(4);
    expect(result.context?.activePairs).toEqual([
      { speakerId: "a", listenerId: "b", relationshipId: "pair" },
    ]);
    expect(result.warning).toBe("Relationship analysis unavailable: provider unavailable.");
    expect(result.promptTokens).toBe(0);
    expect(result.completionTokens).toBe(0);
  });
});
