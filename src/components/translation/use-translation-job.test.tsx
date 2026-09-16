// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, act, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { toast } from "sonner";

import { useTranslationJob } from "./use-translation-job";
import * as translationFns from "@/lib/translation/api/mutations";
import * as translationQueries from "@/lib/translation/api/queries";

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
    cancelTranslationJob: vi.fn(),
    cancelTranslationJobs: vi.fn(),
    retryTranslationJob: vi.fn(),
  };
});

vi.mock("@/lib/translation/api/queries", () => ({
  listActiveTranslationJobs: vi.fn().mockResolvedValue([]),
  getTranslationJobsTerminalStatus: vi.fn(async ({ data }: { data: { jobIds: string[] } }) =>
    data.jobIds.map((id) => ({ id, chapterId: "", status: "pending", error: null })),
  ),
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

    const { result } = renderHook(() => useTranslationJob("novel-1"), { wrapper });

    await act(async () => {
      await result.current.start("ch-1", "missing");
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
  });
  it("resolves jobs completed before the first active poll", async () => {
    vi.mocked(translationFns.startTranslationJob).mockResolvedValueOnce({
      jobId: "job-race",
      totalChunks: 1,
    } as never);
    vi.mocked(translationQueries.getTranslationJobsTerminalStatus).mockResolvedValueOnce([
      { id: "job-race", chapterId: "ch-race", status: "done", error: null },
    ] as never);

    const { result } = renderHook(() => useTranslationJob("novel-1"), { wrapper });

    await act(async () => {
      await result.current.start("ch-race", "missing");
    });
    await act(async () => {
      await result.current.refetchActiveJobs();
    });
    await waitFor(() => {
      expect(result.current.activeJobs.has("ch-race")).toBe(false);
    });
    expect(toast.success).toHaveBeenCalledWith("Translation: 1 completed");
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
      count = await result.current.startMany(["ch-1", "ch-2"], "missing");
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
      await result.current.startMany(["ch-1", "ch-2"], "missing");
    });
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
      await result.current.startMany(["ch-1"], "missing");
    });
    const cancellationPromise = result.current.cancelMany(["ch-1"]);
    await act(async () => {
      await result.current.startMany(["ch-1"], "missing");
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
      await result.current.startMany(["ch-1"], "missing");
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
  it("does not let a stale active-job query overwrite a replacement job", async () => {
    vi.mocked(translationQueries.listActiveTranslationJobs).mockResolvedValueOnce([
      {
        id: "job-old",
        chapterId: "ch-replaced",
        status: "running",
        doneChunks: 1,
        totalChunks: 3,
        error: null,
      },
    ] as never);
    vi.mocked(translationFns.startTranslationJob).mockResolvedValueOnce({
      jobId: "job-new",
      totalChunks: 4,
    } as never);
    const { result } = renderHook(() => useTranslationJob("novel-1"), { wrapper });
    await waitFor(() =>
      expect(result.current.activeJobs.get("ch-replaced")?.jobId).toBe("job-old"),
    );

    await act(async () => {
      await result.current.start("ch-replaced", "overwrite");
    });
    await waitFor(() =>
      expect(result.current.activeJobs.get("ch-replaced")?.jobId).toBe("job-new"),
    );
  });
  it("keeps a replacement visible after a stale pre-populated active-query response", async () => {
    const staleJob = {
      id: "job-stale",
      chapterId: "ch-stale",
      status: "running",
      doneChunks: 1,
      totalChunks: 3,
      error: null,
    } as const;
    queryClient.setQueryData(["translationJobs", "novel-1"], [staleJob], {
      updatedAt: 0,
    });
    vi.mocked(translationQueries.listActiveTranslationJobs).mockResolvedValueOnce([
      staleJob,
    ] as never);
    vi.mocked(translationFns.startTranslationJob).mockResolvedValueOnce({
      jobId: "job-current",
      totalChunks: 4,
    } as never);

    const { result } = renderHook(() => useTranslationJob("novel-1"), { wrapper });
    await waitFor(() => expect(result.current.activeJobs.get("ch-stale")?.jobId).toBe("job-stale"));

    await act(async () => {
      await result.current.start("ch-stale", "overwrite");
    });
    await act(async () => {
      queryClient.setQueryData(["translationJobs", "novel-1"], [staleJob]);
    });

    await waitFor(() =>
      expect(result.current.activeJobs.get("ch-stale")?.jobId).toBe("job-current"),
    );
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("does not remove a replacement when an older single cancellation resolves", async () => {
    vi.mocked(translationFns.startTranslationJob)
      .mockResolvedValueOnce({
        jobId: "job-old",
        totalChunks: 3,
      } as never)
      .mockResolvedValueOnce({
        jobId: "job-new",
        totalChunks: 4,
      } as never);
    const cancellation = Promise.withResolvers<{ success: true }>();
    vi.mocked(translationFns.cancelTranslationJob).mockImplementationOnce(
      () => cancellation.promise as never,
    );
    const { result } = renderHook(() => useTranslationJob("novel-1"), { wrapper });

    await act(async () => {
      await result.current.start("ch-single", "missing");
    });
    const cancellationPromise = result.current.cancel("job-old", "ch-single");
    await act(async () => {
      await result.current.start("ch-single", "missing");
    });
    await act(async () => {
      cancellation.resolve({ success: true });
      await cancellationPromise;
    });

    expect(result.current.activeJobs.get("ch-single")?.jobId).toBe("job-new");
    expect(toast.info).not.toHaveBeenCalledWith("Translation cancelled");
  });

  it("forgets an active job whose chapter and terminal row were deleted", async () => {
    const terminalLookup = Promise.withResolvers<[]>();
    const terminalStarted = Promise.withResolvers<void>();
    vi.mocked(translationQueries.getTranslationJobsTerminalStatus).mockImplementationOnce(() => {
      terminalStarted.resolve();
      return terminalLookup.promise as never;
    });
    queryClient.setQueryData(
      ["translationJobs", "novel-1"],
      [
        {
          id: "job-deleted",
          chapterId: "ch-deleted",
          status: "running",
          doneChunks: 1,
          totalChunks: 2,
          error: null,
        },
      ],
      { updatedAt: 0 },
    );
    const { result } = renderHook(() => useTranslationJob("novel-1"), { wrapper });

    await act(async () => {
      await result.current.refetchActiveJobs();
    });
    await act(async () => {
      await terminalStarted.promise;
    });
    queryClient.setQueryData(["chapters", "novel-1"], [{ id: "ch-deleted" }]);
    queryClient.setQueryData(["readerChapterManifest", "novel-1"], [{ id: "ch-deleted" }]);
    await act(async () => {
      terminalLookup.resolve([]);
      await terminalLookup.promise;
    });

    await waitFor(() => {
      expect(result.current.activeJobs.has("ch-deleted")).toBe(false);
    });
    await waitFor(() => {
      expect(queryClient.getQueryState(["chapters", "novel-1"])?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(["readerChapterManifest", "novel-1"])?.isInvalidated).toBe(
        true,
      );
    });
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalledWith("Translation: 1 completed");
    expect(toast.info).not.toHaveBeenCalledWith("Translation: 1 cancelled");
  });
  it("invalidates only progress keys while sibling jobs are still running", async () => {
    const runningJob = {
      id: "job-running",
      chapterId: "ch-running",
      status: "running",
      doneChunks: 1,
      totalChunks: 3,
      error: null,
    } as const;
    const finishedJob = {
      id: "job-finished",
      chapterId: "ch-finished",
      status: "running",
      doneChunks: 2,
      totalChunks: 2,
      error: null,
    } as const;
    queryClient.setQueryData(["translationJobs", "novel-1"], [runningJob, finishedJob], {
      updatedAt: 0,
    });
    queryClient.setQueryData(["chapters", "novel-1"], [{ id: "ch-finished" }]);
    queryClient.setQueryData(["readerChapterManifest", "novel-1"], [{ id: "ch-finished" }]);
    vi.mocked(translationQueries.getTranslationJobsTerminalStatus).mockResolvedValueOnce([
      { id: "job-finished", chapterId: "ch-finished", status: "done", error: null },
      { id: "job-running", chapterId: "ch-running", status: "running", error: null },
    ] as never);

    const { result } = renderHook(() => useTranslationJob("novel-1"), { wrapper });

    await act(async () => {
      await result.current.refetchActiveJobs();
    });
    await waitFor(() => {
      expect(result.current.activeJobs.has("ch-finished")).toBe(false);
    });

    expect(queryClient.getQueryState(["chapters", "novel-1"])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(["readerChapterManifest", "novel-1"])?.isInvalidated).toBe(
      false,
    );
  });
  it("ignores a terminal lookup that resolves after the consumer unmounts", async () => {
    vi.mocked(translationFns.startTranslationJob).mockResolvedValueOnce({
      jobId: "job-unmounted",
      totalChunks: 1,
    } as never);
    const terminalLookup =
      Promise.withResolvers<
        Array<{ id: string; chapterId: string; status: "done"; error: null }>
      >();
    const terminalStarted = Promise.withResolvers<void>();
    vi.mocked(translationQueries.getTranslationJobsTerminalStatus).mockImplementationOnce(() => {
      terminalStarted.resolve();
      return terminalLookup.promise as never;
    });
    const { result, unmount } = renderHook(() => useTranslationJob("novel-1"), { wrapper });

    await act(async () => {
      await result.current.start("ch-unmounted", "missing");
    });
    await act(async () => {
      await result.current.refetchActiveJobs();
      await terminalStarted.promise;
    });

    unmount();
    await act(async () => {
      terminalLookup.resolve([
        { id: "job-unmounted", chapterId: "ch-unmounted", status: "done", error: null },
      ]);
      await terminalLookup.promise;
    });

    expect(toast.success).not.toHaveBeenCalled();
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
