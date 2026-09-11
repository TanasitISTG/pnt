// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { toast } from "sonner";

import { useTranslationJob } from "./use-translation-job";
import * as translationFns from "@/lib/translation/api/mutations";

interface BulkCancellationResponse {
  cancelled: Array<{ chapterId: string; jobId: string }>;
  skipped: Array<{ chapterId: string; reason: "No active translation" }>;
}

vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/translation/api/mutations", async (importOriginal) => {
  const actual = await importOriginal<typeof translationFns>();
  return {
    ...actual,
    startTranslationJob: vi.fn(),
    startTranslationJobs: vi.fn(),
    cancelTranslationJobs: vi.fn(),
  };
});

vi.mock("@/lib/translation/api/queries", () => ({
  listActiveTranslationJobs: vi.fn().mockResolvedValue([]),
  getTranslationJobsTerminalStatus: vi.fn().mockResolvedValue([]),
}));

describe("useTranslationJob", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
  });

  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);

  it("single-chapter translation receives totalChunks and populates activeJobs", async () => {
    vi.mocked(translationFns.startTranslationJob).mockResolvedValueOnce({
      jobId: "job-101",
      totalChunks: 4,
    } as never);
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useTranslationJob("novel-1"), { wrapper });

    await act(async () => {
      await result.current.start("ch-1");
    });

    const active = result.current.activeJobs.get("ch-1");
    expect(active).toEqual({
      jobId: "job-101",
      chapterId: "ch-1",
      status: "pending",
      doneChunks: 0,
      totalChunks: 4,
    });
    expect(toast.info).toHaveBeenCalledWith("Translation queued");
    expect(toast.error).not.toHaveBeenCalled();
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["residualScripts", "novel-1"],
    });
  });

  it("batch response populates both jobs immediately with 0/totalChunks and triggers no error toast", async () => {
    vi.mocked(translationFns.startTranslationJobs).mockResolvedValueOnce({
      queued: [
        { chapterId: "ch-1", jobId: "job-1", totalChunks: 3 },
        { chapterId: "ch-2", jobId: "job-2", totalChunks: 5 },
      ],
      skipped: [],
    } as never);

    const { result } = renderHook(() => useTranslationJob("novel-1"), { wrapper });

    let count = 0;
    await act(async () => {
      count = await result.current.startMany(["ch-1", "ch-2"]);
    });

    expect(count).toBe(2);
    expect(result.current.activeJobs.get("ch-1")).toEqual({
      jobId: "job-1",
      chapterId: "ch-1",
      status: "pending",
      doneChunks: 0,
      totalChunks: 3,
    });
    expect(result.current.activeJobs.get("ch-2")).toEqual({
      jobId: "job-2",
      chapterId: "ch-2",
      status: "pending",
      doneChunks: 0,
      totalChunks: 5,
    });

    expect(toast.info).toHaveBeenCalledWith("Queued 2 chapters");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("cancels selected jobs in one response and reports partial results", async () => {
    vi.mocked(translationFns.startTranslationJobs).mockResolvedValueOnce({
      queued: [
        { chapterId: "ch-1", jobId: "job-1", totalChunks: 3 },
        { chapterId: "ch-2", jobId: "job-2", totalChunks: 5 },
      ],
      skipped: [],
    } as never);
    const { result } = renderHook(() => useTranslationJob("novel-1"), { wrapper });

    await act(async () => {
      await result.current.startMany(["ch-1", "ch-2"]);
    });
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    vi.mocked(translationFns.cancelTranslationJobs).mockResolvedValueOnce({
      cancelled: [{ chapterId: "ch-1", jobId: "job-1" }],
      skipped: [{ chapterId: "ch-2", reason: "No active translation" }],
    } as never);

    let response: { cancelledChapterIds: string[]; skippedChapterIds: string[] } | null = null;
    await act(async () => {
      response = await result.current.cancelMany(["ch-1", "ch-2"]);
    });

    expect(response).toEqual({
      cancelledChapterIds: ["ch-1"],
      skippedChapterIds: ["ch-2"],
    });
    expect(result.current.activeJobs.has("ch-1")).toBe(false);
    expect(result.current.activeJobs.has("ch-2")).toBe(true);
    expect(invalidateQueries).toHaveBeenCalledTimes(5);
    expect(invalidateQueries).toHaveBeenNthCalledWith(1, {
      queryKey: ["chapters", "novel-1"],
    });
    expect(invalidateQueries).toHaveBeenNthCalledWith(2, {
      queryKey: ["relationshipMap", "novel-1"],
    });
    expect(invalidateQueries).toHaveBeenNthCalledWith(3, { queryKey: ["novels"] });
    expect(invalidateQueries).toHaveBeenNthCalledWith(4, {
      queryKey: ["costs", "novel-1"],
    });
    expect(invalidateQueries).toHaveBeenNthCalledWith(5, {
      queryKey: ["residualScripts", "novel-1"],
    });
    expect(toast.info).toHaveBeenCalledWith("Cancellation requested for 1 translation");
    expect(toast.warning).toHaveBeenCalledWith("Skipped 1 chapter with no active translation");
  });

  it("preserves a replacement job that starts while cancellation is in flight", async () => {
    vi.mocked(translationFns.startTranslationJobs)
      .mockResolvedValueOnce({
        queued: [{ chapterId: "ch-1", jobId: "job-old", totalChunks: 3 }],
        skipped: [],
      } as never)
      .mockResolvedValueOnce({
        queued: [{ chapterId: "ch-1", jobId: "job-new", totalChunks: 4 }],
        skipped: [],
      } as never);
    const cancellation = Promise.withResolvers<BulkCancellationResponse>();
    vi.mocked(translationFns.cancelTranslationJobs).mockImplementationOnce(
      () => cancellation.promise as never,
    );
    const { result } = renderHook(() => useTranslationJob("novel-1"), { wrapper });

    await act(async () => {
      await result.current.startMany(["ch-1"]);
    });
    const cancellationPromise = result.current.cancelMany(["ch-1"]);
    await act(async () => {
      await result.current.startMany(["ch-1"]);
    });
    await act(async () => {
      cancellation.resolve({
        cancelled: [{ chapterId: "ch-1", jobId: "job-old" }],
        skipped: [],
      });
      await cancellationPromise;
    });

    expect(result.current.activeJobs.get("ch-1")?.jobId).toBe("job-new");
  });

  it("keeps state and caches unchanged when bulk cancellation fails", async () => {
    vi.mocked(translationFns.startTranslationJobs).mockResolvedValueOnce({
      queued: [{ chapterId: "ch-1", jobId: "job-1", totalChunks: 3 }],
      skipped: [],
    } as never);
    const { result } = renderHook(() => useTranslationJob("novel-1"), { wrapper });

    await act(async () => {
      await result.current.startMany(["ch-1"]);
    });
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    vi.mocked(translationFns.cancelTranslationJobs).mockRejectedValueOnce(
      new Error("Bulk stop unavailable"),
    );

    let response: { cancelledChapterIds: string[]; skippedChapterIds: string[] } | null = null;
    await act(async () => {
      response = await result.current.cancelMany(["ch-1"]);
    });

    expect(response).toBeNull();
    expect(result.current.activeJobs.has("ch-1")).toBe(true);
    expect(invalidateQueries).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Bulk stop unavailable");
  });
});

// Re-creates the title backfill mutation handlers from index.tsx
function createTitleBackfillHandlers() {
  return {
    onSuccess: ({ translated }: { translated: number }) => {
      toast.success(
        translated > 0 ? `Translated ${translated} chapter title(s)` : "No titles translated",
      );
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to translate titles");
    },
  };
}

// Re-creates the scrape handlers from index.tsx
function createScrapeHandlers(
  scrapeChapterFn: (url: string) => Promise<{ number: number; title: string }>,
  importChapterFn: (url: string) => Promise<{ created: boolean; number: number; title: string }>,
) {
  return {
    handleFetch: async (url: string) => {
      try {
        const r = await scrapeChapterFn(url);
        toast.success(`Fetched chapter ${r.number}: ${r.title}`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Fetch failed");
      }
    },
    handleAdd: async (url: string) => {
      try {
        const r = await importChapterFn(url);
        if (r.created) {
          toast.success(`Added chapter ${r.number}: ${r.title}`);
        } else {
          toast.info(`Chapter ${r.number} already exists — skipped`);
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Import failed");
      }
    },
  };
}

describe("title backfill and scrape handler integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exercises title backfill success and error callbacks", () => {
    const handlers = createTitleBackfillHandlers();

    handlers.onSuccess({ translated: 3 });
    expect(toast.success).toHaveBeenCalledWith("Translated 3 chapter title(s)");
    expect(toast.error).not.toHaveBeenCalled();

    handlers.onSuccess({ translated: 0 });
    expect(toast.success).toHaveBeenCalledWith("No titles translated");

    handlers.onError(new Error("Provider rate limit"));
    expect(toast.error).toHaveBeenCalledWith("Provider rate limit");
  });

  it("exercises scrape fetch and add handler success and error paths", async () => {
    const mockScrape = vi.fn().mockResolvedValue({ number: 5, title: "Fifth Chapter" });
    const mockImport = vi
      .fn()
      .mockResolvedValue({ created: true, number: 5, title: "Fifth Chapter" });

    const handlers = createScrapeHandlers(mockScrape, mockImport);

    await handlers.handleFetch("https://example.com/ch5");
    expect(toast.success).toHaveBeenCalledWith("Fetched chapter 5: Fifth Chapter");

    await handlers.handleAdd("https://example.com/ch5");
    expect(toast.success).toHaveBeenCalledWith("Added chapter 5: Fifth Chapter");

    // Test error path
    const mockScrapeErr = vi.fn().mockRejectedValue(new Error("Host not allowed"));
    const errorHandlers = createScrapeHandlers(mockScrapeErr, mockImport);

    await errorHandlers.handleFetch("https://disallowed.com/ch1");
    expect(toast.error).toHaveBeenCalledWith("Host not allowed");
  });
});
