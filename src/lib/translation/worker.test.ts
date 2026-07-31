import { beforeEach, describe, expect, it, vi } from "vitest";

import { failJob, finalizeJob, initJob, translateChunk } from "./worker";
import * as finalizeGlossaryModule from "./finalize-glossary";
import * as finalizeSummaryModule from "./finalize-summary";
import * as jobStore from "./job-store";
import * as providerClientModule from "./provider-client";

vi.mock("./job-store", () => ({
  beginJob: vi.fn(),
  completeJob: vi.fn(),
  failActiveJob: vi.fn(),
  loadJob: vi.fn(),
  saveJobProgress: vi.fn(),
  loadApprovedTermsForContext: vi.fn().mockResolvedValue([]),
  loadPrevChapterForContext: vi.fn().mockResolvedValue(null),
  loadTermSourcesForExclusion: vi.fn().mockResolvedValue({
    approvedTerms: [],
    rejectedTerms: [],
  }),
  findExistingTermSources: vi.fn().mockResolvedValue(new Set()),
}));

vi.mock("./provider-client", () => ({ createProviderClient: vi.fn() }));
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
    chunksJson: JSON.stringify([
      { index: 0, text: "Chunk 1 text" },
      { index: 1, text: "Chunk 2 text" },
    ]),
    logsJson: "[]",
  };
  const row = { job: mockJob, chapter: mockChapter, novel: mockNovel };
  const provider = { generateChatCompletion: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(jobStore.saveJobProgress).mockResolvedValue(true);
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
    vi.mocked(jobStore.loadJob).mockResolvedValue(row as never);
    provider.generateChatCompletion.mockResolvedValueOnce({
      content: "Translated Chunk 1",
      usage: { promptTokens: 10, completionTokens: 20 },
    });

    await translateChunk("job-1", 0, generation);

    expect(jobStore.saveJobProgress).toHaveBeenCalledWith(
      "job-1",
      generation,
      0,
      expect.objectContaining({ doneChunks: 1 }),
    );
  });

  it("does not call the provider for a stale event generation", async () => {
    vi.mocked(jobStore.loadJob).mockResolvedValue(row as never);
    await translateChunk("job-1", 0, generation - 1);
    expect(provider.generateChatCompletion).not.toHaveBeenCalled();
    expect(jobStore.saveJobProgress).not.toHaveBeenCalled();
  });

  it("does not replay a completed chunk", async () => {
    vi.mocked(jobStore.loadJob).mockResolvedValue({
      ...row,
      job: { ...mockJob, doneChunks: 1 },
    } as never);
    await translateChunk("job-1", 0, generation);
    expect(provider.generateChatCompletion).not.toHaveBeenCalled();
  });

  it("records a provider error without advancing the cursor", async () => {
    vi.mocked(jobStore.loadJob).mockResolvedValue(row as never);
    provider.generateChatCompletion.mockRejectedValue(new Error("API Error: 500"));

    await expect(translateChunk("job-1", 0, generation)).rejects.toThrow("API Error: 500");
    expect(jobStore.saveJobProgress).toHaveBeenCalledWith(
      "job-1",
      generation,
      0,
      expect.not.objectContaining({ doneChunks: expect.anything() }),
    );
  });

  it("commits all final artifacts through one guarded transaction", async () => {
    vi.mocked(jobStore.loadJob).mockResolvedValue({
      ...row,
      job: {
        ...mockJob,
        doneChunks: 2,
        chunksJson: JSON.stringify([
          {
            index: 0,
            text: "c1",
            translation: "Translated 1",
            promptTokens: 10,
            completionTokens: 20,
          },
          {
            index: 1,
            text: "c2",
            translation: "Translated 2",
            promptTokens: 10,
            completionTokens: 20,
          },
        ]),
      },
    } as never);

    await finalizeJob("job-1", generation);

    expect(jobStore.completeJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        generation,
        fullTranslation: "Translated 1\n\nTranslated 2",
        translatedTitle: "Translated Title",
        chapterSummary: "Chapter summary",
        storySummary: "Updated story",
        glossaryRows: [],
        usageJson: JSON.stringify({ totalPromptTokens: 30, totalCompletionTokens: 60 }),
      }),
    );
    const chunks = JSON.parse(vi.mocked(jobStore.completeJob).mock.calls[0][0].chunksJson);
    expect(chunks[0]).not.toHaveProperty("text");
    expect(chunks[0]).not.toHaveProperty("translation");
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
