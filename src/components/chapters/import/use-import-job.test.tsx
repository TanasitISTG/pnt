// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cancelImportJob,
  getActiveImportJob,
  getImportJobStatus,
  getLatestImportJob,
  startImportJob,
} from "@/lib/scrape/functions";
import { useImportJob, type ImportJobState } from "./use-import-job";

vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/scrape/functions", () => ({
  cancelImportJob: vi.fn(),
  getActiveImportJob: vi.fn(),
  getImportJobStatus: vi.fn(),
  getLatestImportJob: vi.fn(),
  startImportJob: vi.fn(),
}));
const activeJob: ImportJobState = {
  id: "scrape-job-1",
  kind: "scrape",
  status: "running",
  sourceFileName: null,
  fromNumber: 1,
  toNumber: 5,
  nextNumber: 3,
  added: 2,
  skipped: 0,
  failed: 0,
  error: null,
};
const doneJob: ImportJobState = {
  ...activeJob,
  status: "done",
};

const epubFailedJob: ImportJobState = {
  ...activeJob,
  id: "epub-job-1",
  kind: "epub",
  status: "error",
  sourceFileName: "novel.epub",
  error: "Import failed",
};

function deferred<T>() {
  return Promise.withResolvers<T>();
}

describe("useImportJob", () => {
  let queryClient: QueryClient;
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.mocked(getActiveImportJob).mockResolvedValue(null as never);
    vi.mocked(getLatestImportJob).mockResolvedValue(null as never);
    vi.mocked(getImportJobStatus).mockResolvedValue(activeJob as never);
    vi.mocked(cancelImportJob).mockResolvedValue({ success: true } as never);
    vi.mocked(startImportJob).mockResolvedValue({ jobId: "started-job" } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("recovers an initial active-job lookup failure and resumes polling", async () => {
    vi.mocked(getActiveImportJob).mockRejectedValueOnce(new Error("Status unavailable"));
    const { result } = renderHook(() => useImportJob("novel-1", vi.fn(), "scrape"), { wrapper });

    await waitFor(() =>
      expect(result.current.importStatusError?.message).toBe("Status unavailable"),
    );
    expect(result.current.importJob).toBeNull();

    vi.useFakeTimers();
    vi.mocked(getActiveImportJob).mockResolvedValueOnce(activeJob as never);
    await act(async () => {
      await result.current.retryImportStatus();
    });

    expect(result.current.importStatusError).toBeNull();
    expect(result.current.importJob).toEqual(activeJob);
    expect(result.current.importActive).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(getImportJobStatus).toHaveBeenCalledWith({ data: { jobId: "scrape-job-1" } });
  });

  it("does not let a stale initial lookup erase a locally attached job", async () => {
    const discovery = deferred<ImportJobState | null>();
    vi.mocked(getActiveImportJob).mockReturnValueOnce(discovery.promise as never);
    const { result } = renderHook(() => useImportJob("novel-1", vi.fn(), "scrape"), { wrapper });

    act(() => result.current.attachJob("attached-job", "novel.epub"));
    expect(result.current.initialStatusLoading).toBe(true);
    await act(async () => {
      discovery.resolve(null);
      await discovery.promise;
    });
    await waitFor(() => expect(result.current.initialStatusLoading).toBe(false));

    expect(result.current.importJob?.id).toBe("attached-job");
    expect(result.current.importJob?.sourceFileName).toBe("novel.epub");
  });

  it("guards rapid duplicate starts synchronously", async () => {
    const start = deferred<{ jobId: string }>();
    vi.mocked(startImportJob).mockReturnValueOnce(start.promise as never);
    const { result } = renderHook(() => useImportJob("novel-1", vi.fn(), "scrape"), { wrapper });
    await waitFor(() => expect(result.current.initialStatusLoading).toBe(false));

    act(() => {
      void result.current.startImport("https://example.test/novel", 1, 2, "auto");
      void result.current.startImport("https://example.test/novel", 1, 2, "auto");
    });

    expect(startImportJob).toHaveBeenCalledTimes(1);
    expect(result.current.startPending).toBe(true);

    await act(async () => {
      start.resolve({ jobId: "started-job" });
      await start.promise;
    });
    expect(result.current.importJob?.id).toBe("started-job");
  });

  it("serializes polling and stops after a terminal response", async () => {
    const firstStatus = deferred<ImportJobState>();
    vi.mocked(getImportJobStatus).mockReturnValueOnce(firstStatus.promise as never);
    const { result } = renderHook(() => useImportJob("novel-1", vi.fn(), "scrape"), { wrapper });
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    await waitFor(() => expect(result.current.initialStatusLoading).toBe(false));
    vi.useFakeTimers();
    act(() => result.current.attachJob("poll-job"));

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(getImportJobStatus).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(getImportJobStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstStatus.resolve({ ...doneJob, id: "poll-job" });
      await firstStatus.promise;
    });
    expect(result.current.importJob?.status).toBe("done");
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["job-dashboard", "history"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["job-dashboard", "stats"] });

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(getImportJobStatus).toHaveBeenCalledTimes(1);
  });

  it("ignores an out-of-date poll after a replacement job is attached", async () => {
    const staleStatus = deferred<ImportJobState>();
    vi.mocked(getImportJobStatus).mockReturnValueOnce(staleStatus.promise as never);
    const { result } = renderHook(() => useImportJob("novel-1", vi.fn(), "scrape"), { wrapper });
    await waitFor(() => expect(result.current.initialStatusLoading).toBe(false));
    vi.useFakeTimers();
    act(() => result.current.attachJob("old-job"));

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(getImportJobStatus).toHaveBeenCalledTimes(1);

    act(() => result.current.attachJob("new-job"));
    await act(async () => {
      staleStatus.resolve(doneJob);
      await staleStatus.promise;
    });

    expect(result.current.importJob?.id).toBe("new-job");
    expect(result.current.importJob?.status).toBe("pending");
  });

  it("recovers the latest failed EPUB job but not an older failure behind a newer done job", async () => {
    vi.mocked(getLatestImportJob).mockResolvedValueOnce(epubFailedJob as never);
    const failed = renderHook(() => useImportJob("novel-1", vi.fn(), "epub"), { wrapper });
    await waitFor(() => expect(failed.result.current.importJob?.id).toBe("epub-job-1"));
    expect(failed.result.current.importJob?.status).toBe("error");
    failed.unmount();

    vi.mocked(getLatestImportJob).mockResolvedValueOnce({
      ...epubFailedJob,
      id: "epub-done",
      status: "done",
    } as never);
    const done = renderHook(() => useImportJob("novel-1", vi.fn(), "epub"), { wrapper });
    await waitFor(() => expect(done.result.current.initialStatusLoading).toBe(false));
    expect(done.result.current.importJob).toBeNull();
  });
});
