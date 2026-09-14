import { keepPreviousData, queryOptions, type QueryClient } from "@tanstack/react-query";

import type {
  JobActivity,
  JobHistoryPage,
  JobHistorySearch,
  JobStats,
} from "@/lib/job-dashboard/contracts";
import { getJobActivity, getJobHistory, getJobStats } from "@/lib/job-dashboard/functions";

export const JOB_HISTORY_QUERY_KEY = ["job-dashboard", "history"] as const;
export const JOB_STATS_QUERY_KEY = ["job-dashboard", "stats"] as const;
export const JOB_ACTIVITY_QUERY_KEY = ["job-dashboard", "activity"] as const;

export const historyQueryOptions = (search: JobHistorySearch) =>
  queryOptions({
    queryKey: [...JOB_HISTORY_QUERY_KEY, search] as const,
    queryFn: () => getJobHistory({ data: search }),
    placeholderData: keepPreviousData,
  });

export const statsQueryOptions = () =>
  queryOptions({
    queryKey: JOB_STATS_QUERY_KEY,
    queryFn: () => getJobStats(),
    staleTime: 60_000,
  });

export const activityQueryOptions = () =>
  queryOptions({
    queryKey: JOB_ACTIVITY_QUERY_KEY,
    queryFn: () => getJobActivity(),
    staleTime: 1_000,
    refetchInterval: (query) => (query.state.data && query.state.data.length > 0 ? 5_000 : false),
    refetchIntervalInBackground: false,
  });

export type JobDashboardData = {
  history: JobHistoryPage;
  stats: JobStats;
};

export function mergeJobActivityIntoHistory(
  history: JobHistoryPage,
  activities: readonly JobActivity[],
): JobHistoryPage {
  if (activities.length === 0) return history;
  const activityById = new Map(activities.map((activity) => [activity.id, activity]));
  return {
    ...history,
    rows: history.rows.map((row) => {
      const activity = activityById.get(row.id);
      if (!activity || activity.type !== row.type) return row;
      const common = {
        status: activity.status,
        error: activity.error,
        updatedAt: activity.updatedAt,
        progress: activity.progress,
        canCancel: true,
        canRetry: false,
      };
      if (row.type === "translation") {
        return {
          ...row,
          ...common,
          doneChunks: activity.doneChunks ?? row.doneChunks,
          totalChunks: activity.totalChunks ?? row.totalChunks,
        };
      }
      if (row.type === "scrape") {
        return {
          ...row,
          ...common,
          added: activity.added ?? row.added,
          skipped: activity.skipped ?? row.skipped,
          failed: activity.failed ?? row.failed,
          completedWithFailures: false,
        };
      }
      return { ...row, ...common };
    }),
  };
}

export function hydrateJobDashboardQueries(
  queryClient: Pick<QueryClient, "setQueryData">,
  search: JobHistorySearch,
  dashboard: JobDashboardData,
) {
  queryClient.setQueryData(historyQueryOptions(search).queryKey, dashboard.history);
  queryClient.setQueryData(JOB_STATS_QUERY_KEY, dashboard.stats);
}
