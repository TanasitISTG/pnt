import { queryOptions, type QueryClient } from "@tanstack/react-query";

import type { JobActivitySummary, JobStats } from "@/lib/job-observability";
import { getJobActivity, getJobStats } from "@/lib/job-observability.functions";

export const JOB_ACTIVITY_QUERY_KEY = ["job-dashboard", "activity"] as const;
export const JOB_STATS_QUERY_KEY = ["job-dashboard", "stats"] as const;

export const activityQueryOptions = () =>
  queryOptions({
    queryKey: JOB_ACTIVITY_QUERY_KEY,
    queryFn: () => getJobActivity(),
    refetchInterval: 5_000,
  });

export const statsQueryOptions = () =>
  queryOptions({
    queryKey: JOB_STATS_QUERY_KEY,
    queryFn: () => getJobStats(),
    refetchInterval: 60_000,
    staleTime: 60_000,
  });

export type JobDashboardData = {
  activity: {
    summary: JobActivitySummary;
    translationJobs: unknown[];
    importJobs: unknown[];
  };
  stats: JobStats;
};

export function hydrateJobDashboardQueries(
  queryClient: Pick<QueryClient, "setQueryData">,
  dashboard: JobDashboardData,
) {
  queryClient.setQueryData(JOB_ACTIVITY_QUERY_KEY, dashboard.activity);
  queryClient.setQueryData(JOB_STATS_QUERY_KEY, dashboard.stats);
}
