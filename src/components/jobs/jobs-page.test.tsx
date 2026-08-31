// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  historyQueryOptions,
  JOB_HISTORY_QUERY_KEY,
  JOB_STATS_QUERY_KEY,
} from "@/lib/job-dashboard/query";
import { JobHistoryTable } from "@/components/jobs/job-history-table";
import type {
  JobHistoryEpubRow,
  JobHistoryPage,
  JobHistoryScrapeRow,
  JobHistorySearch,
  JobHistoryTranslationRow,
  JobStats,
} from "@/lib/job-dashboard/contracts";

const defaultSearch: JobHistorySearch = {
  q: "",
  type: "all",
  status: "all",
  sort: "updatedAt",
  dir: "desc",
  page: 1,
  pageSize: 25,
};

const routerState = vi.hoisted(() => ({
  search: {
    q: "",
    type: "all",
    status: "all",
    sort: "updatedAt",
    dir: "desc",
    page: 1,
    pageSize: 25,
  } as JobHistorySearch,
  navigate: vi.fn(),
}));

const serverFunctions = vi.hoisted(() => ({
  getJobHistory: vi.fn(),
  getJobStats: vi.fn(),
}));

const mutationFunctions = vi.hoisted(() => ({
  cancelTranslationJob: vi.fn(),
  retryTranslationJob: vi.fn(),
}));

const scrapeFunctions = vi.hoisted(() => ({
  cancelImportJob: vi.fn(),
  startImportJob: vi.fn(),
}));

const detailMocks = vi.hoisted(() => ({
  JobLogsDialog: ({ open }: { open: boolean }) => (open ? "Translation details" : null),
  ImportJobDetailsDialog: ({ open }: { open: boolean }) => (open ? "Import details" : null),
}));
vi.mock("@tanstack/react-router", () => ({
  getRouteApi: () => ({
    useSearch: () => routerState.search,
    useNavigate: () => routerState.navigate,
  }),
}));
vi.mock("@/lib/job-dashboard/functions", () => serverFunctions);
vi.mock("@/lib/translation/api/mutations", () => mutationFunctions);
vi.mock("@/lib/scrape/functions", () => scrapeFunctions);
vi.mock("@/components/translation/job-logs-dialog", () => detailMocks);
vi.mock("@/components/jobs/import-job-details-dialog", () => detailMocks);

import { JobsPage } from "@/components/jobs/jobs-page";

const stats: JobStats = {
  avgChunkLatencyMs: 1_250,
  promptTokens: 1_200,
  completionTokens: 800,
  activeTranslationJobs: 1,
  failedTranslationJobs: 1,
  activeImportJobs: 1,
  failedImportJobs: 1,
};

const translationRow: JobHistoryTranslationRow = {
  id: "translation-1",
  type: "translation",
  status: "error",
  novelId: "novel-translation",
  novelTitle: "Translation Novel",
  error: "Provider timed out",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:01:00.000Z",
  chapterId: "chapter-1",
  chapterNumber: "12",
  chapterTitle: "The Long Night",
  totalChunks: 4,
  doneChunks: 2,
  progress: { completed: 2, total: 4, percent: 50, preparing: false },
  canCancel: false,
  canRetry: true,
};

const scrapeRow: JobHistoryScrapeRow = {
  id: "scrape-1",
  type: "scrape",
  status: "running",
  novelId: "novel-scrape",
  novelTitle: "Scrape Novel",
  error: null,
  createdAt: "2026-01-01T00:02:00.000Z",
  updatedAt: "2026-01-01T00:03:00.000Z",
  baseUrl: "https://example.test/novel",
  scrapeProvider: "direct",
  fromNumber: 13,
  toNumber: 20,
  nextNumber: 17,
  added: 3,
  skipped: 1,
  failed: 0,
  progress: { completed: 4, total: 8, percent: 50, preparing: false },
  canCancel: true,
  canRetry: false,
};

const epubRow: JobHistoryEpubRow = {
  id: "epub-1",
  type: "epub",
  status: "error",
  novelId: "novel-epub",
  novelTitle: "EPUB Novel",
  error: "Invalid chapter",
  createdAt: "2026-01-01T00:04:00.000Z",
  updatedAt: "2026-01-01T00:05:00.000Z",
  sourceFileName: "book.epub",
  fromNumber: 1,
  toNumber: 3,
  nextNumber: 3,
  added: 1,
  skipped: 1,
  failed: 1,
  progress: { completed: 3, total: 3, percent: 100, preparing: false },
  canCancel: false,
  canRetry: false,
};

const retryScrapeRow: JobHistoryScrapeRow = {
  ...scrapeRow,
  id: "scrape-retry",
  novelId: "novel-scrape-retry",
  novelTitle: "Retry Scrape Novel",
  status: "error",
  error: "Previous scrape failed",
  canCancel: false,
  canRetry: true,
};

const history: JobHistoryPage = {
  rows: [translationRow, scrapeRow, epubRow, retryScrapeRow],
  rowCount: 4,
  page: 1,
  pageSize: 25,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function renderJobsPage(page: JobHistoryPage = history, search: JobHistorySearch = defaultSearch) {
  routerState.search = search;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  queryClient.setQueryData(historyQueryOptions(search).queryKey, page);
  queryClient.setQueryData(JOB_STATS_QUERY_KEY, stats);

  render(
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={<p>Loading</p>}>
        <JobsPage />
      </Suspense>
    </QueryClientProvider>,
  );
  return queryClient;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
  routerState.search = defaultSearch;
});

describe("JobsPage dashboard", () => {
  it("consolidates health metrics and renders mixed history in one table", () => {
    renderJobsPage();

    expect(screen.getByText("Active jobs")).toBeTruthy();
    expect(screen.getByText("Failed jobs")).toBeTruthy();
    expect(screen.getByText("Avg chunk latency")).toBeTruthy();
    expect(screen.getByText("Tokens")).toBeTruthy();
    expect(screen.getAllByText("Translation 1 · Import 1")).toHaveLength(2);
    expect(screen.getByText("Prompt 1,200 · Completion 800")).toBeTruthy();
    expect(screen.getByText("Translation Novel")).toBeTruthy();
    expect(screen.getByText("Scrape Novel")).toBeTruthy();
    expect(screen.getByText("1–4 of 4 jobs")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Filter by type" }).textContent).toContain(
      "All types",
    );
    expect(screen.getByRole("combobox", { name: "Filter by status" }).textContent).toContain(
      "All statuses",
    );
  });

  it("shows a loading banner while a new server page is fetching", () => {
    render(
      <JobHistoryTable
        history={history}
        search={defaultSearch}
        isPending={false}
        isFetching
        isPlaceholderData
        isError={false}
        error={null}
        onRetry={vi.fn()}
        onSearchChange={vi.fn()}
        actions={{
          onViewDetails: vi.fn(),
          onOpenNovel: vi.fn(),
          onOpenChapter: vi.fn(),
          onCopyJobId: vi.fn(),
          onCancel: vi.fn(),
          onRetry: vi.fn(),
        }}
        pendingJobId={null}
      />,
    );

    expect(screen.getByText("Loading job page…")).toBeTruthy();
    expect(screen.getByText("Translation Novel")).toBeTruthy();
  });

  it("keeps stale rows visible with retry when a page request fails", () => {
    const onRetry = vi.fn();
    render(
      <JobHistoryTable
        history={history}
        search={{ ...defaultSearch, type: "epub" }}
        isPending={false}
        isFetching={false}
        isPlaceholderData
        isError
        error={new Error("Network down")}
        onRetry={onRetry}
        onSearchChange={vi.fn()}
        actions={{
          onViewDetails: vi.fn(),
          onOpenNovel: vi.fn(),
          onOpenChapter: vi.fn(),
          onCopyJobId: vi.fn(),
          onCancel: vi.fn(),
          onRetry: vi.fn(),
        }}
        pendingJobId={null}
      />,
    );

    expect(screen.getByText("Unable to update job history")).toBeTruthy();
    expect(screen.getByText("Translation Novel")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("keeps Refresh enabled during automatic history polling", async () => {
    vi.useFakeTimers();
    const refresh = deferred<JobHistoryPage>();
    serverFunctions.getJobHistory.mockReturnValueOnce(refresh.promise);
    renderJobsPage();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(serverFunctions.getJobHistory).toHaveBeenCalledOnce();
    expect((screen.getByRole("button", { name: "Refresh" }) as HTMLButtonElement).disabled).toBe(
      false,
    );

    refresh.resolve(history);
    await act(async () => {
      await Promise.resolve();
    });
  });

  it("waits for both requests during manual Refresh", async () => {
    const historyRefresh = deferred<JobHistoryPage>();
    const statsRefresh = deferred<JobStats>();
    serverFunctions.getJobHistory.mockReturnValueOnce(historyRefresh.promise);
    serverFunctions.getJobStats.mockReturnValueOnce(statsRefresh.promise);
    renderJobsPage();

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      expect(serverFunctions.getJobHistory).toHaveBeenCalledOnce();
      expect(serverFunctions.getJobStats).toHaveBeenCalledOnce();
    });
    expect(
      (screen.getByRole("button", { name: "Refreshing…" }) as HTMLButtonElement).disabled,
    ).toBe(true);

    statsRefresh.resolve(stats);
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      (screen.getByRole("button", { name: "Refreshing…" }) as HTMLButtonElement).disabled,
    ).toBe(true);

    historyRefresh.resolve(history);
    await waitFor(() => {
      expect((screen.getByRole("button", { name: "Refresh" }) as HTMLButtonElement).disabled).toBe(
        false,
      );
    });
  });

  it("writes debounced query, filter, sort, and page-size state to the URL", async () => {
    vi.useFakeTimers();
    renderJobsPage();

    fireEvent.change(screen.getByRole("textbox", { name: "Search job history" }), {
      target: { value: "older" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    let navigation = routerState.navigate.mock.calls.at(-1)?.[0];
    expect(navigation.replace).toBe(true);
    expect(navigation.search(defaultSearch)).toMatchObject({ q: "older", page: 1 });

    fireEvent.click(screen.getByRole("combobox", { name: "Filter by type" }));
    fireEvent.pointerDown(screen.getByRole("option", { name: "Scrapes" }), {
      pointerType: "mouse",
    });
    fireEvent.click(screen.getByRole("option", { name: "Scrapes" }));
    navigation = routerState.navigate.mock.calls.at(-1)?.[0];
    expect(navigation.search(defaultSearch)).toMatchObject({ type: "scrape", page: 1 });

    fireEvent.click(screen.getByRole("button", { name: "Sort by Updated" }));
    navigation = routerState.navigate.mock.calls.at(-1)?.[0];
    expect(navigation.search(defaultSearch)).toMatchObject({ sort: "updatedAt", dir: "asc" });

    fireEvent.click(screen.getByRole("combobox", { name: "Rows per page" }));
    fireEvent.pointerDown(screen.getByRole("option", { name: "50" }), {
      pointerType: "mouse",
    });
    fireEvent.click(screen.getByRole("option", { name: "50" }));
    navigation = routerState.navigate.mock.calls.at(-1)?.[0];
    expect(navigation.search(defaultSearch)).toMatchObject({ pageSize: 50, page: 1 });
  });

  it("uses server rowCount for pagination and keeps explicit page navigation history", () => {
    const pagedHistory = { ...history, rows: [translationRow], rowCount: 31 };
    renderJobsPage(pagedHistory);

    expect(screen.getByText("1–1 of 31 jobs")).toBeTruthy();
    const next = screen.getByRole("button", { name: "Next page" });
    expect((next as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(next);

    const navigation = routerState.navigate.mock.calls.at(-1)?.[0];
    expect(navigation.replace).toBe(false);
    expect(navigation.search(defaultSearch)).toMatchObject({ page: 2 });
  });

  it("distinguishes global and filtered empty history", () => {
    const empty: JobHistoryPage = { rows: [], rowCount: 0, page: 1, pageSize: 25 };
    renderJobsPage(empty);
    expect(screen.getByText("No jobs yet")).toBeTruthy();

    cleanup();
    const filteredSearch = { ...defaultSearch, q: "missing" };
    renderJobsPage(empty, filteredSearch);
    expect(screen.getByText("No jobs match these filters")).toBeTruthy();
  });

  it("renders a retry state when history loading fails", async () => {
    serverFunctions.getJobHistory.mockRejectedValueOnce(new Error("Network down"));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(JOB_STATS_QUERY_KEY, stats);
    render(
      <QueryClientProvider client={queryClient}>
        <JobsPage />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(serverFunctions.getJobHistory).toHaveBeenCalledTimes(2));
  });
});

describe("JobsPage job actions", () => {
  it("opens details, copies IDs, and omits retry for failed EPUB rows", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    renderJobsPage();

    fireEvent.click(screen.getByRole("button", { name: "Actions for Translation Novel" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "View details" }));
    expect(screen.getByText("Translation details")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Actions for Translation Novel" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy job ID" }));
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("translation-1"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Actions for EPUB Novel" }));

    expect(screen.queryByRole("menuitem", { name: "Retry job" })).toBeNull();
  });

  it("opens import details and keeps EPUB retry unavailable", () => {
    renderJobsPage();

    fireEvent.click(screen.getByRole("button", { name: "Actions for EPUB Novel" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "View details" }));
    expect(screen.getByText("Import details")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Actions for EPUB Novel" }));
    expect(screen.queryByRole("menuitem", { name: "Retry job" })).toBeNull();
  });

  it("disables destructive controls for the pending row only", () => {
    render(
      <JobHistoryTable
        history={history}
        search={defaultSearch}
        isPending={false}
        isFetching={false}
        isPlaceholderData={false}
        isError={false}
        error={null}
        onRetry={vi.fn()}
        onSearchChange={vi.fn()}
        actions={{
          onViewDetails: vi.fn(),
          onOpenNovel: vi.fn(),
          onOpenChapter: vi.fn(),
          onCopyJobId: vi.fn(),
          onCancel: vi.fn(),
          onRetry: vi.fn(),
        }}
        pendingJobId="scrape-1"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Actions for Scrape Novel" }));
    expect(
      screen.getByRole("menuitem", { name: "Working…" }).getAttribute("data-disabled"),
    ).not.toBe(null);
  });

  it("confirms translation retry and invalidates affected caches", async () => {
    const queryClient = renderJobsPage();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    mutationFunctions.retryTranslationJob.mockResolvedValueOnce({ success: true });

    fireEvent.click(screen.getByRole("button", { name: "Actions for Translation Novel" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Retry job" }));
    expect(screen.getByRole("dialog").textContent).toContain("Completed chunks will be resumed");
    fireEvent.click(screen.getByRole("button", { name: "Retry job" }));

    await waitFor(() =>
      expect(mutationFunctions.retryTranslationJob).toHaveBeenCalledWith({
        data: { jobId: "translation-1" },
      }),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: JOB_HISTORY_QUERY_KEY });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: JOB_STATS_QUERY_KEY });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["chapters", "novel-translation"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["costs", "novel-translation"] });
  });

  it("confirms import cancel and forwards scrape retry inputs", async () => {
    const queryClient = renderJobsPage();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    scrapeFunctions.cancelImportJob.mockResolvedValueOnce({ success: true });
    scrapeFunctions.startImportJob.mockResolvedValueOnce({ jobId: "scrape-2" });

    fireEvent.click(screen.getByRole("button", { name: "Actions for Scrape Novel" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Cancel job" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel job" }));
    await waitFor(() =>
      expect(scrapeFunctions.cancelImportJob).toHaveBeenCalledWith({
        data: { jobId: "scrape-1" },
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Actions for Retry Scrape Novel" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Retry job" }));
    fireEvent.click(screen.getByRole("button", { name: "Retry job" }));
    await waitFor(() =>
      expect(scrapeFunctions.startImportJob).toHaveBeenCalledWith({
        data: {
          novelId: "novel-scrape-retry",
          baseUrl: "https://example.test/novel",
          from: 13,
          to: 20,
          provider: "direct",
        },
      }),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: JOB_HISTORY_QUERY_KEY });
  });
});
