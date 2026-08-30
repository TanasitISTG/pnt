import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/job-observability.functions", () => ({
  getJobActivity: vi.fn(),
  getJobStats: vi.fn(),
}));
import {
  activityQueryOptions,
  hydrateJobDashboardQueries,
  JOB_ACTIVITY_QUERY_KEY,
  JOB_STATS_QUERY_KEY,
  statsQueryOptions,
} from "./job-dashboard-query";

const dashboard = {
  activity: {
    summary: {
      activeTranslationJobs: 1,
      failedTranslationJobs: 2,
      activeImportJobs: 3,
      failedImportJobs: 4,
    },
    translationJobs: [],
    importJobs: [],
  },
  stats: {
    avgChunkLatencyMs: 25,
    promptTokens: 100,
    completionTokens: 200,
  },
};

describe("Jobs query contracts", () => {
  it("keeps activity and stats on independent cadences", () => {
    expect(activityQueryOptions()).toMatchObject({
      queryKey: JOB_ACTIVITY_QUERY_KEY,
      refetchInterval: 5_000,
    });
    expect(statsQueryOptions()).toMatchObject({
      queryKey: JOB_STATS_QUERY_KEY,
      refetchInterval: 60_000,
      staleTime: 60_000,
    });
  });

  it("hydrates both query entries with the dashboard loader result", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(JOB_ACTIVITY_QUERY_KEY, {
      ...dashboard.activity,
      summary: {
        activeTranslationJobs: 0,
        failedTranslationJobs: 0,
        activeImportJobs: 0,
        failedImportJobs: 0,
      },
    });
    queryClient.setQueryData(JOB_STATS_QUERY_KEY, {
      avgChunkLatencyMs: 0,
      promptTokens: 0,
      completionTokens: 0,
    });

    hydrateJobDashboardQueries(queryClient, dashboard);

    expect(queryClient.getQueryData(JOB_ACTIVITY_QUERY_KEY)).toEqual(dashboard.activity);
    expect(queryClient.getQueryData(JOB_STATS_QUERY_KEY)).toEqual(dashboard.stats);
  });
});
