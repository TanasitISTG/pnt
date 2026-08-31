import { keepPreviousData, queryOptions, type QueryClient } from "@tanstack/react-query";

import type { JobHistoryPage, JobHistorySearch, JobStats } from "@/lib/job-dashboard/contracts";
import { getJobHistory, getJobStats } from "@/lib/job-dashboard/functions";

export const JOB_HISTORY_QUERY_KEY = ["job-dashboard", "history"] as const;
export const JOB_STATS_QUERY_KEY = ["job-dashboard", "stats"] as const;

export const historyQueryOptions = (search: JobHistorySearch) =>
  queryOptions({
    queryKey: [...JOB_HISTORY_QUERY_KEY, search] as const,
    queryFn: () => getJobHistory({ data: search }),
    placeholderData: keepPreviousData,
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
  history: JobHistoryPage;
  stats: JobStats;
};

export function hydrateJobDashboardQueries(
  queryClient: Pick<QueryClient, "setQueryData">,
  search: JobHistorySearch,
  dashboard: JobDashboardData,
) {
  queryClient.setQueryData(historyQueryOptions(search).queryKey, dashboard.history);
  queryClient.setQueryData(JOB_STATS_QUERY_KEY, dashboard.stats);
}
