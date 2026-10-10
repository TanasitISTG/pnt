import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import type {
  JobActivity,
  JobActivitySnapshot,
  JobHistoryPage,
  JobHistorySearch,
  JobHistoryScrapeRow,
  JobHistoryTranslationRow,
} from "@/lib/job-dashboard/contracts";

vi.mock("@/lib/job-dashboard/functions", () => ({
  getJobActivity: vi.fn(),
  getJobHistory: vi.fn(),
  getJobStats: vi.fn(),
}));
import {
  activityQueryOptions,
  historyQueryOptions,
  hydrateJobDashboardQueries,
  invalidateJobDashboard,
  JOB_ACTIVITY_QUERY_KEY,
  JOB_HISTORY_QUERY_KEY,
  JOB_STATS_QUERY_KEY,
  mergeJobActivityIntoHistory,
  statsQueryOptions,
} from "./query";

const search: JobHistorySearch = {
  q: "",
  type: "all",
  status: "all",
  sort: "updatedAt",
  dir: "desc",
  page: 1,
  pageSize: 25,
};
const dashboard = {
  history: {
    rows: [],
    rowCount: 0,
    page: 1,
    pageSize: 25 as const,
  },
  stats: {
    avgChunkLatencyMs: 25,
    promptTokens: 100,
    completionTokens: 200,
    activeTranslationJobs: 1,
    failedTranslationJobs: 2,
    activeImportJobs: 3,
    failedImportJobs: 4,
  },
};

const idleSnapshot: JobActivitySnapshot = {
  activities: [],
  activeTranslationJobs: 0,
  activeImportJobs: 0,
  revision: "[[],null,[],null]",
};

function activityInterval(snapshot: JobActivitySnapshot | undefined) {
  const refetchInterval = activityQueryOptions([]).refetchInterval;
  if (typeof refetchInterval !== "function") throw new Error("activity polling must be dynamic");
  return refetchInterval({ state: { data: snapshot } } as never);
}

const runningTranslationRow: JobHistoryTranslationRow = {
  id: "translation-1",
  type: "translation",
  status: "running",
  novelId: "novel-1",
  novelTitle: "Novel",
  error: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:01:00.000Z",
  chapterId: "chapter-1",
  chapterNumber: "1",
  chapterTitle: "One",
  totalChunks: 4,
  doneChunks: 1,
  provider: "openai",
  model: "gpt-5.6-luna",
  isLegacyProviderFallback: false,
  progress: { completed: 1, total: 4, percent: 25, preparing: false },
  canCancel: true,
  canRetry: false,
};

const runningScrapeRow: JobHistoryScrapeRow = {
  id: "scrape-1",
  type: "scrape",
  status: "running",
  novelId: "novel-1",
  novelTitle: "Novel",
  error: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:01:00.000Z",
  baseUrl: "https://example.test/novel",
  scrapeProvider: "direct",
  fromNumber: 1,
  toNumber: 10,
  nextNumber: 5,
  added: 4,
  skipped: 0,
  failed: 0,
  completedWithFailures: false,
  progress: { completed: 4, total: 10, percent: 40, preparing: false },
  canCancel: true,
  canRetry: false,
};

describe("Jobs query contracts", () => {
  it("keys history by the complete normalized search state", () => {
    expect(historyQueryOptions(search).queryKey).toEqual([...JOB_HISTORY_QUERY_KEY, search]);
    expect(historyQueryOptions({ ...search, page: 2 }).queryKey).not.toEqual(
      historyQueryOptions(search).queryKey,
    );
  });

  it("keys activity by the normalized requested identities", () => {
    expect(
      activityQueryOptions([
        { id: "b", type: "translation" },
        { id: "a", type: "scrape" },
        { id: "b", type: "translation" },
      ]).queryKey,
    ).toEqual([
      ...JOB_ACTIVITY_QUERY_KEY,
      [
        { id: "a", type: "scrape" },
        { id: "b", type: "translation" },
      ],
    ]);
    expect(activityQueryOptions([]).queryKey).toEqual([...JOB_ACTIVITY_QUERY_KEY, []]);
  });

  it("polls only while the global snapshot reports active work", () => {
    expect(historyQueryOptions(search).placeholderData).toEqual(expect.any(Function));
    expect(historyQueryOptions(search).refetchInterval).toBeUndefined();
    expect(statsQueryOptions().refetchInterval).toBeUndefined();
    expect(statsQueryOptions().staleTime).toBe(60_000);

    expect(activityInterval(undefined)).toBe(false);
    expect(activityInterval(idleSnapshot)).toBe(false);
    expect(activityInterval({ ...idleSnapshot, activeTranslationJobs: 1, activities: [] })).toBe(
      5_000,
    );
    expect(activityInterval({ ...idleSnapshot, activeImportJobs: 2, activities: [] })).toBe(5_000);
  });

  it("invalidates the dashboard prefixes through one helper", async () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    await invalidateJobDashboard(queryClient);

    expect(invalidate).toHaveBeenCalledWith({ queryKey: JOB_HISTORY_QUERY_KEY });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: JOB_STATS_QUERY_KEY });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: JOB_ACTIVITY_QUERY_KEY });
  });

  it("hydrates the exact history page and stats cache entries", () => {
    const queryClient = new QueryClient();

    hydrateJobDashboardQueries(queryClient, search, dashboard);

    expect(queryClient.getQueryData(historyQueryOptions(search).queryKey)).toEqual(
      dashboard.history,
    );
    expect(queryClient.getQueryData(JOB_STATS_QUERY_KEY)).toEqual(dashboard.stats);
  });
});

describe("mergeJobActivityIntoHistory", () => {
  const page: JobHistoryPage = {
    rows: [runningTranslationRow, runningScrapeRow],
    rowCount: 2,
    page: 1,
    pageSize: 25,
  };

  it("applies actual terminal status and the existing capability rules", () => {
    const completedTranslation: JobActivity = {
      id: "translation-1",
      type: "translation",
      status: "done",
      novelId: "novel-1",
      error: null,
      updatedAt: "2026-01-01T00:05:00.000Z",
      progress: { completed: 4, total: 4, percent: 100, preparing: false },
      doneChunks: 4,
      totalChunks: 4,
    };
    const failedScrape: JobActivity = {
      id: "scrape-1",
      type: "scrape",
      status: "done",
      novelId: "novel-1",
      error: null,
      updatedAt: "2026-01-01T00:06:00.000Z",
      progress: { completed: 10, total: 10, percent: 100, preparing: false },
      added: 8,
      skipped: 0,
      failed: 2,
    };

    const merged = mergeJobActivityIntoHistory(page, [completedTranslation, failedScrape]);

    expect(merged.rows[0]).toMatchObject({
      id: "translation-1",
      status: "done",
      canCancel: false,
      canRetry: false,
      doneChunks: 4,
      totalChunks: 4,
    });
    expect(merged.rows[1]).toMatchObject({
      id: "scrape-1",
      status: "done",
      canCancel: false,
      canRetry: true,
      failed: 2,
      completedWithFailures: true,
    });
  });

  it("keeps retry available for failed work and cancel for active work", () => {
    const erroredTranslation: JobActivity = {
      id: "translation-1",
      type: "translation",
      status: "error",
      novelId: "novel-1",
      error: "Provider timed out",
      updatedAt: "2026-01-01T00:05:00.000Z",
      progress: { completed: 1, total: 4, percent: 25, preparing: false },
      doneChunks: 1,
      totalChunks: 4,
    };
    const stillRunningScrape: JobActivity = {
      id: "scrape-1",
      type: "scrape",
      status: "running",
      novelId: "novel-1",
      error: null,
      updatedAt: "2026-01-01T00:06:00.000Z",
      progress: { completed: 6, total: 10, percent: 60, preparing: false },
      added: 6,
      skipped: 0,
      failed: 0,
    };

    const merged = mergeJobActivityIntoHistory(page, [erroredTranslation, stillRunningScrape]);

    expect(merged.rows[0]).toMatchObject({
      status: "error",
      canCancel: false,
      canRetry: true,
      error: "Provider timed out",
    });
    expect(merged.rows[1]).toMatchObject({ status: "running", canCancel: true, canRetry: false });
  });

  it("leaves unknown or mismatched activity rows untouched", () => {
    const mismatched: JobActivity = {
      id: "translation-1",
      type: "scrape",
      status: "done",
      novelId: "novel-1",
      error: null,
      updatedAt: "2026-01-01T00:05:00.000Z",
      progress: { completed: 4, total: 4, percent: 100, preparing: false },
    };

    expect(mergeJobActivityIntoHistory(page, [])).toBe(page);
    expect(mergeJobActivityIntoHistory(page, [mismatched]).rows[0]).toBe(runningTranslationRow);
  });
});
