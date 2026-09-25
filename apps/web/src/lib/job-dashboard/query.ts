import { keepPreviousData, queryOptions, type QueryClient } from "@tanstack/react-query";

import type {
  JobActivity,
  JobActivityIdentity,
  JobHistoryPage,
  JobHistorySearch,
  JobStats,
} from "@/lib/job-dashboard/contracts";
import { normalizeJobActivityInput } from "@/lib/job-dashboard/contracts";
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

/**
 * Projects the identities the caller currently renders; global active counts
 * keep polling alive even when the requested page contains no active row.
 */
export const activityQueryOptions = (jobs: readonly JobActivityIdentity[]) => {
  const requestedJobs = normalizeJobActivityInput(jobs);
  return queryOptions({
    queryKey: [...JOB_ACTIVITY_QUERY_KEY, requestedJobs] as const,
    queryFn: () => getJobActivity({ data: { jobs: requestedJobs } }),
    staleTime: 1_000,
    refetchInterval: (query) => {
      const snapshot = query.state.data;
      if (!snapshot) return false;
      return snapshot.activeTranslationJobs + snapshot.activeImportJobs > 0 ? 5_000 : false;
    },
    refetchIntervalInBackground: false,
  });
};

export function invalidateJobDashboard(queryClient: QueryClient): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: JOB_HISTORY_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: JOB_STATS_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: JOB_ACTIVITY_QUERY_KEY }),
  ]).then(() => undefined);
}

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
        canCancel: activity.status === "pending" || activity.status === "running",
        canRetry: false,
      };
      if (row.type === "translation") {
        return {
          ...row,
          ...common,
          doneChunks: activity.doneChunks ?? row.doneChunks,
          totalChunks: activity.totalChunks ?? row.totalChunks,
          canRetry: activity.status === "error" || activity.status === "cancelled",
        };
      }
      if (row.type === "scrape") {
        const added = activity.added ?? row.added;
        const skipped = activity.skipped ?? row.skipped;
        const failed = activity.failed ?? row.failed;
        const completedWithFailures = activity.status === "done" && failed > 0;
        return {
          ...row,
          ...common,
          added,
          skipped,
          failed,
          completedWithFailures,
          canRetry:
            (activity.status === "error" ||
              activity.status === "cancelled" ||
              completedWithFailures) &&
            Boolean(row.baseUrl) &&
            row.scrapeProvider !== null,
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
