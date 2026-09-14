import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import type { JobHistorySearch } from "@/lib/job-dashboard/contracts";

vi.mock("@/lib/job-dashboard/functions", () => ({
  getJobActivity: vi.fn(),
  getJobHistory: vi.fn(),
  getJobStats: vi.fn(),
}));
import {
  activityQueryOptions,
  historyQueryOptions,
  hydrateJobDashboardQueries,
  JOB_ACTIVITY_QUERY_KEY,
  JOB_HISTORY_QUERY_KEY,
  JOB_STATS_QUERY_KEY,
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

describe("Jobs query contracts", () => {
  it("keys history by the complete normalized search state", () => {
    expect(historyQueryOptions(search).queryKey).toEqual([...JOB_HISTORY_QUERY_KEY, search]);
    expect(historyQueryOptions({ ...search, page: 2 }).queryKey).not.toEqual(
      historyQueryOptions(search).queryKey,
    );
  });

  it("polls only active activity and leaves retained queries focus-driven", () => {
    expect(historyQueryOptions(search).placeholderData).toEqual(expect.any(Function));
    expect(historyQueryOptions(search).refetchInterval).toBeUndefined();
    expect(statsQueryOptions().refetchInterval).toBeUndefined();
    expect(statsQueryOptions().staleTime).toBe(60_000);
    expect(activityQueryOptions().queryKey).toEqual(JOB_ACTIVITY_QUERY_KEY);
    expect(typeof activityQueryOptions().refetchInterval).toBe("function");
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
