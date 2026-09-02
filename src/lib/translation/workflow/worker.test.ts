import { beforeEach, describe, expect, it, vi } from "vitest";

import { failJob, finalizeJob, initJob, translateChunk } from "./worker";
import * as finalizeGlossaryModule from "./finalize-glossary";
import * as finalizeSummaryModule from "./finalize-summary";
import * as jobStore from "./job-store";
import * as providerClientModule from "../providers/provider-client";

import { buildRelationshipPromptContextForText } from "@/lib/relationships/map";
import { relationshipMapSchema } from "@/lib/relationships/schemas";
vi.mock("./job-store", () => ({
  beginJob: vi.fn(),
  completeChunk: vi.fn(),
  completeJob: vi.fn(),
  failActiveJob: vi.fn(),
  loadJob: vi.fn(),
  loadJobChunk: vi.fn(),
  loadJobChunks: vi.fn(),
  saveChunkFailure: vi.fn(),
  loadApprovedTermsForContext: vi.fn().mockResolvedValue([]),
  loadPrevChapterForContext: vi.fn().mockResolvedValue(null),
  loadTermSourcesForExclusion: vi.fn().mockResolvedValue({
    approvedTerms: [],
    existingSources: [],
  }),
}));

vi.mock("../providers/provider-client", () => ({ createProviderClient: vi.fn() }));
vi.mock("./finalize-summary", () => ({ generateSummaryArtifacts: vi.fn() }));
vi.mock("./finalize-glossary", () => ({ suggestAndReviewTerms: vi.fn() }));

describe("translation worker guarded state transitions", () => {
  const generation = 3;
  const mockNovel = {
    id: "novel-1",
    userId: "user-1",
    sourceLang: "zh",
    targetLang: "th",
    customPrompt: null,
    contextTailLength: 500,
    storySummary: "Old story summary",
  };
  const mockChapter = {
    id: "chapter-1",
    novelId: "novel-1",
    number: "1",
    title: "Chapter 1",
    rawContent: "Test raw content",
    translatedTitle: null,
    summary: null,
    activeTranslationJobId: "job-1",
    translationGeneration: generation,
    sourceRevision: 7,
  };
  const mockJob = {
    id: "job-1",
    chapterId: "chapter-1",
    status: "running",
    generation,
    sourceRevision: 7,
    doneChunks: 0,
    totalChunks: 2,
    logsJson: "[]",
  };
  const row = { job: mockJob, chapter: mockChapter, novel: mockNovel };
  const chunks = [
    { jobId: "job-1", index: 0, sourceText: "Chunk 1 text", textLength: 12 },
    { jobId: "job-1", index: 1, sourceText: "Chunk 2 text", textLength: 12 },
  ];
  const provider = { generateChatCompletion: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(jobStore.loadApprovedTermsForContext).mockResolvedValue([]);
    vi.mocked(jobStore.loadPrevChapterForContext).mockResolvedValue(null as never);
    vi.mocked(jobStore.loadTermSourcesForExclusion).mockResolvedValue({
      approvedTerms: [],
      existingSources: [],
    });
    vi.mocked(jobStore.completeChunk).mockResolvedValue(true);
    vi.mocked(jobStore.saveChunkFailure).mockResolvedValue(true);
    vi.mocked(jobStore.completeJob).mockResolvedValue(true);
    vi.mocked(jobStore.failActiveJob).mockResolvedValue(true);
    vi.mocked(providerClientModule.createProviderClient).mockResolvedValue(provider as never);
    vi.mocked(finalizeSummaryModule.generateSummaryArtifacts).mockResolvedValue({
      translatedTitle: "Translated Title",
      freshSummary: "Chapter summary",
      updatedStorySummary: "Updated story",
      promptTokens: 5,
      completionTokens: 10,
    });
    vi.mocked(finalizeGlossaryModule.suggestAndReviewTerms).mockResolvedValue({
      approvedCount: 0,
      pendingCount: 0,
      rejectedCount: 0,
      conflictCount: 0,
      promptTokens: 5,
      completionTokens: 10,
      rowsToInsert: [],
    });
  });

  it("initializes only through the generation-aware transaction", async () => {
    vi.mocked(jobStore.beginJob).mockResolvedValue(row as never);

    await expect(initJob("job-1", generation)).resolves.toEqual({
      skip: false,
      doneChunks: 0,
      totalChunks: 2,
    });
    expect(jobStore.beginJob).toHaveBeenCalledWith("job-1", generation);
  });

  it("skips when ownership was lost before initialization", async () => {
    vi.mocked(jobStore.beginJob).mockResolvedValue(null);
    await expect(initJob("job-1", generation)).resolves.toEqual({
      skip: true,
      doneChunks: 0,
      totalChunks: 0,
    });
  });

  it("writes translated progress with generation and expected cursor", async () => {
    vi.mocked(jobStore.loadJobChunk).mockResolvedValue({
      ...row,
      chunk: chunks[0],
      previousChunk: null,
    } as never);
    provider.generateChatCompletion.mockResolvedValueOnce({
      content: "แปลแล้ว ชิ้นหนึ่ง",
      usage: { promptTokens: 10, completionTokens: 20 },
    });

    await translateChunk("job-1", 0, generation);

    expect(jobStore.completeChunk).toHaveBeenCalledWith(
      "job-1",
      generation,
      0,
      expect.objectContaining({ translation: "แปลแล้ว ชิ้นหนึ่ง" }),
    );
  });
  it("repairs short residual spans with all translation context", async () => {
    provider.generateChatCompletion.mockReset();
    const relationshipContext = buildRelationshipPromptContextForText(
      relationshipMapSchema.parse({
        version: 1,
        characters: [
          {
            id: "hero",
            sourceName: "许野",
            targetName: "สวี่เหยี่ย",
            aliases: [],
            gender: "male",
            role: "protagonist",
            notes: null,
            enabled: true,
            locked: false,
            evidence: null,
            lastSeenChapter: null,
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
          {
            id: "friend",
            sourceName: "林月",
            targetName: "หลินเยว่",
            aliases: [],
            gender: "female",
            role: null,
            notes: null,
            enabled: true,
            locked: false,
            evidence: null,
            lastSeenChapter: null,
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        relationships: [
          {
            id: "hero-to-friend",
            speakerId: "hero",
            listenerId: "friend",
            relationship: "friend",
            speakerStatus: "peer",
            familiarity: "close",
            selfPronoun: null,
            addresseeTerm: null,
            sentenceParticles: null,
            register: null,
            notes: null,
            enabled: true,
            locked: false,
            evidence: null,
            lastSeenChapter: null,
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
      "许野 林月",
    )!;
    vi.mocked(jobStore.loadApprovedTermsForContext).mockResolvedValue([
      { source: "许野", target: "สวี่เหยี่ย", category: "character", note: null },
    ] as never);
    vi.mocked(jobStore.loadJobChunk).mockResolvedValue({
      ...row,
      novel: { ...mockNovel, customPrompt: "Keep names consistent." },
      chunk: { ...chunks[0], sourceText: "许野 text", textLength: 7 },
      previousChunk: null,
    } as never);
    provider.generateChatCompletion
      .mockResolvedValueOnce({
        content: "แปลแล้ว 许野",
        usage: { promptTokens: 10, completionTokens: 20 },
      })
      .mockRejectedValueOnce(new Error("temporary span failure"))
      .mockResolvedValueOnce({
        content: "not json",
        usage: { promptTokens: 1, completionTokens: 1 },
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({ translations: [] }),
        usage: { promptTokens: 1, completionTokens: 1 },
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({ translations: ["สวี่เหยี่ย"] }),
        usage: { promptTokens: 1, completionTokens: 1 },
      });

    await translateChunk("job-1", 0, generation, {
      context: relationshipContext,
      warning: null,
      promptTokens: 0,
      completionTokens: 0,
    });

    expect(provider.generateChatCompletion).toHaveBeenCalledTimes(5);
    const spanRepairRequest = provider.generateChatCompletion.mock.calls[1]?.[0] as {
      messages: Array<{ content?: string }>;
      responseFormat?: unknown;
    };
    const repairPrompt = spanRepairRequest.messages[0]?.content as string;
    expect(repairPrompt).toContain("## Terminology & Glossary");
    expect(repairPrompt).toContain("许野 -> สวี่เหยี่ย");
    expect(repairPrompt).toContain("Old story summary");
    expect(repairPrompt).toContain("## Character & Relationship Context");
    expect(repairPrompt).toContain('"id":"hero-to-friend"');
    expect(repairPrompt).toContain("## Custom Instructions");
    expect(repairPrompt).toContain("Keep names consistent.");
    expect(repairPrompt).toContain('{"translations":["..."]}');
    expect(repairPrompt.indexOf("## Terminology & Glossary")).toBeLessThan(
      repairPrompt.indexOf("## Character & Relationship Context"),
    );
    expect(repairPrompt.indexOf("## Character & Relationship Context")).toBeLessThan(
      repairPrompt.indexOf("## Custom Instructions"),
    );
    expect(repairPrompt.indexOf("## Custom Instructions")).toBeLessThan(
      repairPrompt.indexOf("## Output Contract"),
    );
    expect(repairPrompt.slice(repairPrompt.indexOf("## Output Contract"))).not.toContain("\n## ");
    expect(spanRepairRequest.responseFormat).toEqual({ type: "json_object" });
    expect(jobStore.completeChunk).toHaveBeenCalledWith(
      "job-1",
      generation,
      0,
      expect.objectContaining({ translation: "แปลแล้ว สวี่เหยี่ย" }),
    );
  });
  it("repairs mixed foreign scripts in a Thai translation", async () => {
    provider.generateChatCompletion.mockReset();
    vi.mocked(jobStore.loadJobChunk).mockResolvedValue({
      ...row,
      chunk: { ...chunks[0], sourceText: "原文", textLength: 2 },
      previousChunk: null,
    } as never);
    provider.generateChatCompletion
      .mockResolvedValueOnce({
        content: "เนื้อหา Hello مرحبا мир จบ",
        usage: { promptTokens: 10, completionTokens: 20 },
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({ translations: ["แปลแล้ว"] }),
        usage: { promptTokens: 1, completionTokens: 1 },
      });

    await translateChunk("job-1", 0, generation);

    expect(provider.generateChatCompletion).toHaveBeenCalledTimes(2);
    expect(jobStore.completeChunk).toHaveBeenCalledWith(
      "job-1",
      generation,
      0,
      expect.objectContaining({ translation: "เนื้อหา แปลแล้ว จบ" }),
    );
    const repairRequest = provider.generateChatCompletion.mock.calls[1]?.[0] as {
      messages: Array<{ content?: string }>;
    };
    expect(repairRequest.messages[1]?.content).toContain("Hello مرحبا мир");
  });

  it("rejects a residual replacement that remains off-script before retrying", async () => {
    provider.generateChatCompletion.mockReset();
    vi.mocked(jobStore.loadJobChunk).mockResolvedValue({
      ...row,
      chunk: { ...chunks[0], sourceText: "原文", textLength: 2 },
      previousChunk: null,
    } as never);
    provider.generateChatCompletion
      .mockResolvedValueOnce({
        content: "เนื้อหา Hello จบ",
        usage: { promptTokens: 10, completionTokens: 20 },
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({ translations: ["still English"] }),
        usage: { promptTokens: 1, completionTokens: 1 },
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({ translations: ["แปลแล้ว"] }),
        usage: { promptTokens: 1, completionTokens: 1 },
      });

    await translateChunk("job-1", 0, generation);

    expect(provider.generateChatCompletion).toHaveBeenCalledTimes(3);
    expect(jobStore.completeChunk).toHaveBeenCalledWith(
      "job-1",
      generation,
      0,
      expect.objectContaining({ translation: "เนื้อหา แปลแล้ว จบ" }),
    );
  });

  it("protects approved glossary targets and exact source tags", async () => {
    provider.generateChatCompletion.mockReset();
    vi.mocked(jobStore.loadApprovedTermsForContext).mockResolvedValue([
      { source: "OpenAI", target: "OpenAI", category: "other", note: null },
    ] as never);
    vi.mocked(jobStore.loadJobChunk).mockResolvedValue({
      ...row,
      chunk: { ...chunks[0], sourceText: "<em>OpenAI</em>", textLength: 15 },
      previousChunk: null,
    } as never);
    provider.generateChatCompletion.mockResolvedValueOnce({
      content: "<em>OpenAI</em>",
      usage: { promptTokens: 10, completionTokens: 20 },
    });

    await translateChunk("job-1", 0, generation);

    expect(provider.generateChatCompletion).toHaveBeenCalledTimes(1);
    expect(jobStore.completeChunk).toHaveBeenCalledWith(
      "job-1",
      generation,
      0,
      expect.objectContaining({ translation: "<em>OpenAI</em>" }),
    );
  });

  it("retries long residual passages before surgical cleanup", async () => {
    provider.generateChatCompletion.mockReset();
    vi.mocked(jobStore.loadJobChunk).mockResolvedValue({
      ...row,
      chunk: chunks[0],
      previousChunk: null,
    } as never);
    provider.generateChatCompletion
      .mockResolvedValueOnce({
        content: `แปลแล้ว ${"许".repeat(201)}`,
        usage: { promptTokens: 10, completionTokens: 20 },
      })
      .mockRejectedValueOnce(new Error("temporary passage failure"))
      .mockRejectedValueOnce(new Error("temporary passage failure"))
      .mockRejectedValueOnce(new Error("temporary passage failure"))
      .mockResolvedValueOnce({
        content: "แปลแล้ว 许野",
        usage: { promptTokens: 1, completionTokens: 1 },
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({ translations: ["สวี่เหยี่ย"] }),
        usage: { promptTokens: 1, completionTokens: 1 },
      });

    await translateChunk("job-1", 0, generation);

    expect(provider.generateChatCompletion).toHaveBeenCalledTimes(6);
    expect(jobStore.completeChunk).toHaveBeenCalledWith(
      "job-1",
      generation,
      0,
      expect.objectContaining({ translation: "แปลแล้ว สวี่เหยี่ย" }),
    );
  });
  it("rejects whole-chunk repairs that change markers, tags, or protected terms", async () => {
    provider.generateChatCompletion.mockReset();
    vi.mocked(jobStore.loadApprovedTermsForContext).mockResolvedValue([
      { source: "术语", target: "OpenAI", category: "other", note: null },
    ] as never);
    vi.mocked(jobStore.loadJobChunk).mockResolvedValue({
      ...row,
      chunk: {
        ...chunks[0],
        sourceText: "<em>术语</em>\n\n下一段",
        textLength: 18,
      },
      previousChunk: null,
    } as never);
    provider.generateChatCompletion
      .mockResolvedValueOnce({
        content: `<em>OpenAI</em> ${"许".repeat(201)}\n||¶||\nจบ`,
        usage: { promptTokens: 10, completionTokens: 20 },
      })
      .mockResolvedValueOnce({
        content: "<em>แปลแล้ว</em>\n||¶||\nจบ",
        usage: { promptTokens: 1, completionTokens: 1 },
      })
      .mockResolvedValueOnce({
        content: "แปลแล้ว OpenAI",
        usage: { promptTokens: 1, completionTokens: 1 },
      })
      .mockResolvedValueOnce({
        content: "<em>OpenAI แปลแล้ว</em>\n||¶||\nจบ",
        usage: { promptTokens: 1, completionTokens: 1 },
      });

    await translateChunk("job-1", 0, generation);

    expect(provider.generateChatCompletion).toHaveBeenCalledTimes(4);
    expect(jobStore.completeChunk).toHaveBeenCalledWith(
      "job-1",
      generation,
      0,
      expect.objectContaining({
        translation: "<em>OpenAI แปลแล้ว</em>\n\nจบ",
      }),
    );
  });

  it("keeps the pre-repair translation after repair retries are exhausted", async () => {
    provider.generateChatCompletion.mockReset();
    vi.mocked(jobStore.loadJobChunk).mockResolvedValue({
      ...row,
      chunk: chunks[0],
      previousChunk: null,
    } as never);
    provider.generateChatCompletion
      .mockResolvedValueOnce({
        content: "แปลแล้ว 许野",
        usage: { promptTokens: 10, completionTokens: 20 },
      })
      .mockRejectedValue(new Error("span repair unavailable"));

    await translateChunk("job-1", 0, generation);

    expect(provider.generateChatCompletion).toHaveBeenCalledTimes(5);
    expect(jobStore.completeChunk).toHaveBeenCalledWith(
      "job-1",
      generation,
      0,
      expect.objectContaining({ translation: "แปลแล้ว 许野" }),
    );
  });

  it("does not call the provider for a stale event generation", async () => {
    vi.mocked(jobStore.loadJobChunk).mockResolvedValue({
      ...row,
      chunk: chunks[0],
      previousChunk: null,
    } as never);
    await translateChunk("job-1", 0, generation - 1);
    expect(provider.generateChatCompletion).not.toHaveBeenCalled();
    expect(jobStore.completeChunk).not.toHaveBeenCalled();
  });

  it("does not replay a completed chunk", async () => {
    vi.mocked(jobStore.loadJobChunk).mockResolvedValue({
      ...row,
      job: { ...mockJob, doneChunks: 1 },
      chunk: chunks[0],
      previousChunk: null,
    } as never);
    await translateChunk("job-1", 0, generation);
    expect(provider.generateChatCompletion).not.toHaveBeenCalled();
  });

  it("records a provider error without advancing the cursor", async () => {
    vi.mocked(jobStore.loadJobChunk).mockResolvedValue({
      ...row,
      chunk: chunks[0],
      previousChunk: null,
    } as never);
    provider.generateChatCompletion.mockRejectedValue(new Error("API Error: 500"));

    await expect(translateChunk("job-1", 0, generation)).rejects.toThrow("API Error: 500");
    expect(jobStore.saveChunkFailure).toHaveBeenCalledWith(
      "job-1",
      generation,
      0,
      "API Error: 500",
      expect.stringContaining("API Error: 500"),
    );
  });

  it("commits all final artifacts through one guarded transaction", async () => {
    vi.mocked(jobStore.loadJob).mockResolvedValue({
      ...row,
      job: {
        ...mockJob,
        doneChunks: 2,
      },
    } as never);
    vi.mocked(jobStore.loadJobChunks).mockResolvedValue([
      {
        ...chunks[0],
        sourceText: "c1",
        translation: "Translated 1",
        promptTokens: 10,
        completionTokens: 20,
      },
      {
        ...chunks[1],
        sourceText: "c2",
        translation: "Translated 2",
        promptTokens: 10,
        completionTokens: 20,
      },
    ] as never);
    const glossaryRows = [
      {
        id: "term-1",
        novelId: "novel-1",
        source: "许野",
        target: "สวี่เหยี่ย",
        category: "character" as const,
        note: null,
        status: "approved" as const,
      },
    ];
    const approvedTerms = [{ source: "许野", target: "สวี่เหยี่ย", category: "character", note: null }];
    vi.mocked(jobStore.loadApprovedTermsForContext).mockResolvedValue(approvedTerms as never);
    vi.mocked(finalizeGlossaryModule.suggestAndReviewTerms).mockResolvedValue({
      approvedCount: 1,
      pendingCount: 0,
      rejectedCount: 0,
      conflictCount: 0,
      promptTokens: 5,
      completionTokens: 10,
      rowsToInsert: glossaryRows,
    });

    await finalizeJob("job-1", generation);
    expect(finalizeSummaryModule.generateSummaryArtifacts).toHaveBeenCalledWith(
      expect.objectContaining({ approvedTerms }),
    );

    expect(jobStore.completeJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        generation,
        fullTranslation: "Translated 1\n\nTranslated 2",
        translatedTitle: "Translated Title",
        chapterSummary: "Chapter summary",
        storySummary: "Updated story",
        glossaryRows,
        usageJson: JSON.stringify({ totalPromptTokens: 30, totalCompletionTokens: 60 }),
      }),
    );
    expect(jobStore.completeJob).toHaveBeenCalledTimes(1);
    expect(jobStore.loadJobChunks).toHaveBeenCalledWith("job-1");
  });

  it("skips finalization after chapter ownership moves", async () => {
    vi.mocked(jobStore.loadJob).mockResolvedValue({
      ...row,
      chapter: { ...mockChapter, activeTranslationJobId: "job-2" },
    } as never);
    await finalizeJob("job-1", generation);
    expect(finalizeSummaryModule.generateSummaryArtifacts).not.toHaveBeenCalled();
    expect(jobStore.completeJob).not.toHaveBeenCalled();
  });

  it("marks failure only through the guarded failure transaction", async () => {
    vi.mocked(jobStore.loadJob).mockResolvedValue(row as never);
    await failJob("job-1", generation, "LLM API Failure");
    expect(jobStore.failActiveJob).toHaveBeenCalledWith(
      "job-1",
      generation,
      "LLM API Failure",
      expect.stringContaining("LLM API Failure"),
    );
  });
});
