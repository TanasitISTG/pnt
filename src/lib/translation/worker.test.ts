import { describe, it, expect, vi, beforeEach } from "vitest";

import { initJob, translateChunk, finalizeJob, failJob } from "./worker";
import * as jobStore from "./job-store";
import * as providerClientModule from "./provider-client";
import * as finalizeSummaryModule from "./finalize-summary";
import * as finalizeGlossaryModule from "./finalize-glossary";

vi.mock("./job-store", () => ({
  loadJob: vi.fn(),
  saveJob: vi.fn(),
  markChapterTranslating: vi.fn(),
  loadApprovedTermsForContext: vi.fn().mockResolvedValue([]),
  loadPrevChapterForContext: vi.fn().mockResolvedValue(null),
  markChapterTranslated: vi.fn(),
  setChapterTranslatedTitle: vi.fn(),
  setChapterSummary: vi.fn(),
  setNovelStorySummary: vi.fn(),
  loadTermSourcesForExclusion: vi.fn().mockResolvedValue({ approvedTerms: [], rejectedTerms: [] }),
  findExistingTermSources: vi.fn().mockResolvedValue(new Set()),
  insertGlossaryTerms: vi.fn(),
  markChapterError: vi.fn(),
}));

vi.mock("./provider-client", () => ({
  createProviderClient: vi.fn(),
}));

vi.mock("./finalize-summary", () => ({
  generateSummaryArtifacts: vi.fn(),
}));

vi.mock("./finalize-glossary", () => ({
  suggestAndReviewTerms: vi.fn(),
}));

describe("translation worker steps", () => {
  const mockNovel = {
    id: "novel-1",
    userId: "user-1",
    sourceLang: "ZH",
    targetLang: "TH",
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
  };

  const mockJob = {
    id: "job-1",
    chapterId: "chapter-1",
    status: "running",
    doneChunks: 0,
    chunksJson: JSON.stringify([{ text: "Chunk 1 text" }, { text: "Chunk 2 text" }]),
    logsJson: "[]",
  };

  const mockProviderClient = {
    userId: "user-1",
    generateChatCompletion: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(providerClientModule.createProviderClient).mockResolvedValue(
      mockProviderClient as never,
    );
  });

  it("initJob marks job running and returns chunk counts", async () => {
    vi.mocked(jobStore.loadJob).mockResolvedValue({
      job: { ...mockJob, status: "pending", doneChunks: 0 },
      chapter: mockChapter,
      novel: mockNovel,
    } as never);

    const res = await initJob("job-1");

    expect(res).toEqual({ skip: false, doneChunks: 0, totalChunks: 2 });
    expect(jobStore.saveJob).toHaveBeenCalledWith("job-1", { status: "running" });
    expect(jobStore.markChapterTranslating).toHaveBeenCalledWith("chapter-1");
  });

  it("1. translateChunk standard execution updates doneChunks, chunksJson, and job", async () => {
    vi.mocked(jobStore.loadJob).mockResolvedValue({
      job: { ...mockJob, doneChunks: 0 },
      chapter: mockChapter,
      novel: mockNovel,
    } as never);

    mockProviderClient.generateChatCompletion.mockResolvedValueOnce({
      content: "Translated Chunk 1",
      usage: { promptTokens: 10, completionTokens: 20 },
    });

    await translateChunk("job-1", 0);

    expect(mockProviderClient.generateChatCompletion).toHaveBeenCalledTimes(1);
    expect(jobStore.saveJob).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({
        doneChunks: 1,
      }),
    );
  });

  it("2. translateChunk idempotent skip when doneChunks >= chunkIndex + 1", async () => {
    vi.mocked(jobStore.loadJob).mockResolvedValue({
      job: { ...mockJob, doneChunks: 1 },
      chapter: mockChapter,
      novel: mockNovel,
    } as never);

    await translateChunk("job-1", 0);

    expect(mockProviderClient.generateChatCompletion).not.toHaveBeenCalled();
    expect(jobStore.saveJob).not.toHaveBeenCalled();
  });

  it("3. translateChunk cancelled status aborts early without calling provider LLM", async () => {
    vi.mocked(jobStore.loadJob).mockResolvedValue({
      job: { ...mockJob, status: "cancelled", doneChunks: 0 },
      chapter: mockChapter,
      novel: mockNovel,
    } as never);

    await translateChunk("job-1", 0);

    expect(mockProviderClient.generateChatCompletion).not.toHaveBeenCalled();
    expect(jobStore.saveJob).not.toHaveBeenCalled();
  });

  it("4. translateChunk triggers auto-split fallback on timeout", async () => {
    const longText = "Paragraph line text.\n\n".repeat(70); // >1200 chars
    vi.mocked(jobStore.loadJob).mockResolvedValue({
      job: {
        ...mockJob,
        doneChunks: 0,
        chunksJson: JSON.stringify([{ text: longText }]),
      },
      chapter: mockChapter,
      novel: mockNovel,
    } as never);

    // First call times out
    mockProviderClient.generateChatCompletion
      .mockRejectedValueOnce(new Error("Request timed out"))
      .mockResolvedValue({
        content: "Half translation ||¶||",
        usage: { promptTokens: 5, completionTokens: 10 },
      });

    await translateChunk("job-1", 0);

    expect(mockProviderClient.generateChatCompletion).toHaveBeenCalledTimes(5);
    expect(jobStore.saveJob).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({
        doneChunks: 1,
      }),
    );
  });

  it("5. translateChunk provider error saves chunk.error then rethrows for Inngest retry", async () => {
    vi.mocked(jobStore.loadJob).mockResolvedValue({
      job: { ...mockJob, doneChunks: 0 },
      chapter: mockChapter,
      novel: mockNovel,
    } as never);

    mockProviderClient.generateChatCompletion.mockRejectedValue(new Error("API Error: 500"));

    await expect(translateChunk("job-1", 0)).rejects.toThrow("API Error: 500");

    expect(jobStore.saveJob).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({
        chunksJson: expect.stringContaining("API Error: 500"),
      }),
    );
    // doneChunks must NOT advance on failure
    const savedPatch = vi.mocked(jobStore.saveJob).mock.calls[0][1];
    expect(savedPatch).not.toHaveProperty("doneChunks");
  });

  it("6. finalizeJob throws when called before all chunks are done", async () => {
    vi.mocked(jobStore.loadJob).mockResolvedValue({
      job: { ...mockJob, status: "running", doneChunks: 1 }, // totalChunks = 2
      chapter: mockChapter,
      novel: mockNovel,
    } as never);

    await expect(finalizeJob("job-1")).rejects.toThrow("1/2");
    expect(jobStore.markChapterTranslated).not.toHaveBeenCalled();
  });

  it("7. finalizeJob standard success calls summary & glossary phases and sets chapter translated", async () => {
    vi.mocked(jobStore.loadJob).mockResolvedValue({
      job: {
        ...mockJob,
        status: "running",
        doneChunks: 2,
        chunksJson: JSON.stringify([
          { text: "c1", translation: "Translated 1", promptTokens: 10, completionTokens: 20 },
          { text: "c2", translation: "Translated 2", promptTokens: 10, completionTokens: 20 },
        ]),
      },
      chapter: mockChapter,
      novel: mockNovel,
    } as never);

    vi.mocked(finalizeSummaryModule.generateSummaryArtifacts).mockResolvedValue({
      translatedTitle: "Translated Title",
      freshSummary: "Chapter summary text",
      promptTokens: 5,
      completionTokens: 10,
    });

    vi.mocked(finalizeGlossaryModule.suggestAndReviewTerms).mockResolvedValue({
      approvedCount: 1,
      pendingCount: 0,
      rejectedCount: 0,
      conflictCount: 0,
      promptTokens: 5,
      completionTokens: 10,
    });

    await finalizeJob("job-1");

    expect(jobStore.markChapterTranslated).toHaveBeenCalledWith(
      "chapter-1",
      "Translated 1\n\nTranslated 2",
    );
    expect(finalizeSummaryModule.generateSummaryArtifacts).toHaveBeenCalledTimes(1);
    expect(finalizeGlossaryModule.suggestAndReviewTerms).toHaveBeenCalledTimes(1);
    expect(jobStore.saveJob).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({
        status: "done",
      }),
    );
  });

  it("8. finalizeJob cancelled status skips finalization", async () => {
    vi.mocked(jobStore.loadJob).mockResolvedValue({
      job: { ...mockJob, status: "cancelled", doneChunks: 2 },
      chapter: mockChapter,
      novel: mockNovel,
    } as never);

    await finalizeJob("job-1");

    expect(jobStore.markChapterTranslated).not.toHaveBeenCalled();
    expect(finalizeSummaryModule.generateSummaryArtifacts).not.toHaveBeenCalled();
  });

  it("9. finalizeJob no-op if status is errored or already done", async () => {
    vi.mocked(jobStore.loadJob).mockResolvedValue({
      job: { ...mockJob, status: "done", doneChunks: 2 },
      chapter: mockChapter,
      novel: mockNovel,
    } as never);

    await finalizeJob("job-1");

    expect(jobStore.markChapterTranslated).not.toHaveBeenCalled();
    expect(finalizeSummaryModule.generateSummaryArtifacts).not.toHaveBeenCalled();
  });

  it("10. finalizeJob updates story summary and token usage metrics via phase modules", async () => {
    vi.mocked(jobStore.loadJob).mockResolvedValue({
      job: {
        ...mockJob,
        status: "running",
        doneChunks: 1,
        chunksJson: JSON.stringify([
          { text: "c1", translation: "T1", promptTokens: 10, completionTokens: 10 },
        ]),
      },
      chapter: mockChapter,
      novel: mockNovel,
    } as never);

    vi.mocked(finalizeSummaryModule.generateSummaryArtifacts).mockResolvedValue({
      freshSummary: "New summary",
      promptTokens: 10,
      completionTokens: 10,
    });

    vi.mocked(finalizeGlossaryModule.suggestAndReviewTerms).mockResolvedValue({
      approvedCount: 0,
      pendingCount: 0,
      rejectedCount: 0,
      conflictCount: 0,
      promptTokens: 5,
      completionTokens: 5,
    });

    await finalizeJob("job-1");

    expect(jobStore.saveJob).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({
        status: "done",
        usageJson: JSON.stringify({ totalPromptTokens: 25, totalCompletionTokens: 25 }),
      }),
    );
  });

  it("11. failJob updates job and chapter status to errored", async () => {
    vi.mocked(jobStore.loadJob).mockResolvedValue({
      job: { ...mockJob, status: "running" },
      chapter: mockChapter,
      novel: mockNovel,
    } as never);

    await failJob("job-1", "LLM API Failure");

    expect(jobStore.saveJob).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({
        status: "error",
        error: "LLM API Failure",
      }),
    );
    expect(jobStore.markChapterError).toHaveBeenCalledWith("chapter-1");
  });
});
