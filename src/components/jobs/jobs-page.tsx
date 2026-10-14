import { getRouteApi } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { ActivityAttention } from "@/components/jobs/activity-attention";
import { ActivityLiveRuns } from "@/components/jobs/activity-live-runs";
import { ImportJobDrawer } from "@/components/jobs/import-job-drawer";
import { JobHistoryTable } from "@/components/jobs/job-history-table";
import { Metric } from "@/components/jobs/metric";
import { JobLogDrawer } from "@/components/translation/job/job-log-drawer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InlineNotice } from "@/components/ui/inline-notice";
import {
  activityQueryOptions,
  historyQueryOptions,
  invalidateJobDashboard,
  mergeJobActivityIntoHistory,
  statsQueryOptions,
} from "@/lib/job-dashboard/query";
import type {
  JobHistoryRow,
  JobHistorySearch,
  JobHistoryTranslationRow,
  JobStats,
} from "@/lib/job-dashboard/contracts";
import { cancelTranslationJob, retryTranslationJob } from "@/lib/translation/api/mutations";
import { cancelImportJob, startImportJob } from "@/lib/scrape/functions";
import { useHydrated } from "@/lib/use-hydrated";

type Operation = {
  kind: "cancel" | "retry";
  job: JobHistoryRow;
} | null;

const jobsRoute = getRouteApi("/_protected/jobs");

const EMPTY_STATS: JobStats = {
  avgChunkLatencyMs: 0,
  promptTokens: 0,
  completionTokens: 0,
  activeTranslationJobs: 0,
  failedTranslationJobs: 0,
  activeImportJobs: 0,
  failedImportJobs: 0,
};

const EMPTY_ROWS: JobHistoryRow[] = [];

async function handleCopyJobId(job: JobHistoryRow) {
  try {
    await navigator.clipboard.writeText(job.id);
    toast.success("Job ID copied");
  } catch {
    toast.error("Unable to copy job ID");
  }
}

/**
 * The activity console.
 *
 * It leads with what needs a decision — a run in flight, a run that failed — and only
 * then shows the retained history, which is what the page used to be: a strip of four
 * detached metric cards over a table. The two numbers that describe the whole queue
 * (latency, tokens) stay as a compact pair above the table, because they answer "how is
 * it going?" rather than "what should I do now?".
 */
export function JobsPage() {
  const search = jobsRoute.useSearch();
  const navigate = jobsRoute.useNavigate();
  const queryClient = useQueryClient();
  const historyQuery = useQuery(historyQueryOptions(search));
  const statsQuery = useQuery(statsQueryOptions());
  const activityQuery = useQuery(
    activityQueryOptions(historyQuery.data?.rows.map(({ id, type }) => ({ id, type })) ?? []),
  );
  // The revision fingerprint covers every retained owned job, so equal-count
  // start/completion replacements refresh exactly like an ending job does.
  const activityRevisionRef = useRef<string | null>(null);
  useEffect(() => {
    const snapshot = activityQuery.data;
    if (!snapshot) return;
    const previousRevision = activityRevisionRef.current;
    activityRevisionRef.current = snapshot.revision;
    if (previousRevision === null || previousRevision === snapshot.revision) return;
    void invalidateJobDashboard(queryClient);
  }, [activityQuery.data, queryClient]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [operation, setOperation] = useState<Operation>(null);
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);
  const [translationDetails, setTranslationDetails] = useState<{
    jobId: string;
    chapterId: string;
  } | null>(null);
  const [importDetailsJobId, setImportDetailsJobId] = useState<string | null>(null);
  const mounted = useHydrated();

  const updateSearch = useCallback(
    (changes: Partial<JobHistorySearch>, replace = true) => {
      navigate({
        search: (previous) => ({ ...previous, ...changes }),
        replace,
      });
    },
    [navigate],
  );

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const results = await Promise.allSettled([
        historyQuery.refetch(),
        statsQuery.refetch(),
        activityQuery.refetch(),
      ]);
      const failed = results.some(
        (result) =>
          result.status === "rejected" || (result.status === "fulfilled" && result.value.isError),
      );
      if (failed) toast.error("Some job dashboard data could not be refreshed");
    } finally {
      setIsRefreshing(false);
    }
  };

  const invalidateAffectedQueries = async (job: JobHistoryRow) => {
    await Promise.all([
      invalidateJobDashboard(queryClient),
      queryClient.invalidateQueries({ queryKey: ["novels"] }),
      queryClient.invalidateQueries({ queryKey: ["chapters", job.novelId] }),
      queryClient.invalidateQueries({ queryKey: ["readerChapterManifest", job.novelId] }),
      queryClient.invalidateQueries({ queryKey: ["adminNovelDetailMetrics", job.novelId] }),
    ]);
  };

  const handleConfirmOperation = async () => {
    if (!operation) return;
    const { job } = operation;
    setPendingJobId(job.id);
    try {
      if (operation.kind === "cancel") {
        if (job.type === "translation") {
          await cancelTranslationJob({ data: { jobId: job.id } });
        } else {
          await cancelImportJob({ data: { jobId: job.id } });
        }
        toast.success("Job cancellation requested");
      } else if (job.type === "translation") {
        await retryTranslationJob({ data: { jobId: job.id } });
        toast.success("Translation retry queued");
      } else if (job.type === "scrape" && job.scrapeProvider) {
        await startImportJob({
          data: {
            novelId: job.novelId,
            baseUrl: job.baseUrl,
            from: job.fromNumber,
            to: job.toNumber,
            provider: job.scrapeProvider,
          },
        });
        toast.success("New scrape job queued");
      } else {
        throw new Error("This job cannot be retried");
      }
      await invalidateAffectedQueries(job);
      setOperation(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Job operation failed");
    } finally {
      setPendingJobId(null);
    }
  };

  const handleViewDetails = useCallback((job: JobHistoryRow) => {
    if (job.type === "translation") {
      setTranslationDetails({ jobId: job.id, chapterId: job.chapterId });
    } else {
      setImportDetailsJobId(job.id);
    }
  }, []);

  const handleOpenNovel = useCallback(
    (novelId: string) => {
      void navigate({ to: "/novels/$novelId", params: { novelId } });
    },
    [navigate],
  );

  const handleOpenChapter = useCallback(
    (job: JobHistoryTranslationRow) => {
      void navigate({
        to: "/novels/$novelId/chapters/$chapterId",
        params: { novelId: job.novelId, chapterId: job.chapterId },
      });
    },
    [navigate],
  );

  const handleCancelJob = useCallback(
    (job: JobHistoryRow) => setOperation({ kind: "cancel", job }),
    [],
  );
  const handleRetryJob = useCallback(
    (job: JobHistoryRow) => setOperation({ kind: "retry", job }),
    [],
  );
  const jobHistoryActions = useMemo(
    () => ({
      onViewDetails: handleViewDetails,
      onOpenNovel: handleOpenNovel,
      onOpenChapter: handleOpenChapter,
      onCopyJobId: (job: JobHistoryRow) => void handleCopyJobId(job),
      onCancel: handleCancelJob,
      onRetry: handleRetryJob,
    }),
    [handleCancelJob, handleOpenChapter, handleOpenNovel, handleRetryJob, handleViewDetails],
  );

  const stats = statsQuery.data ?? EMPTY_STATS;
  const history = useMemo(
    () =>
      historyQuery.data
        ? mergeJobActivityIntoHistory(historyQuery.data, activityQuery.data?.activities ?? [])
        : undefined,
    [activityQuery.data, historyQuery.data],
  );
  // The snapshot summary is the last known global count; stats remain the
  // fallback until the first snapshot arrives.
  const activeTranslationJobs =
    activityQuery.data?.activeTranslationJobs ?? stats.activeTranslationJobs;
  const activeImportJobs = activityQuery.data?.activeImportJobs ?? stats.activeImportJobs;
  const totalTokens = Number(stats.promptTokens) + Number(stats.completionTokens);
  const compactTokenCount = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(totalTokens),
    [totalTokens],
  );

  const rows = history?.rows ?? EMPTY_ROWS;
  const liveJobs = useMemo(
    () => rows.filter((row) => row.status === "running" || row.status === "pending"),
    [rows],
  );
  const failedJobs = useMemo(() => rows.filter((row) => row.status === "error"), [rows]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-caption font-semibold tracking-overline text-muted-foreground uppercase">
            Operations
          </p>
          <h1 className="mt-1 text-section font-semibold text-foreground">Activity</h1>
          <p className="mt-1 max-w-2xl text-body-lg text-muted-foreground">
            Translation and import runs for your account. What is running and what failed lead; the
            retained history follows.
          </p>
        </div>
        <Button variant="outline" onClick={handleRefresh} disabled={isRefreshing}>
          {isRefreshing ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      {activityQuery.isError ? (
        <InlineNotice
          tone="warning"
          title="Live progress is unavailable"
          action={
            <Button size="sm" variant="outline" onClick={() => void activityQuery.refetch()}>
              Retry
            </Button>
          }
        >
          Retained history is still shown below.
        </InlineNotice>
      ) : null}

      <ActivityLiveRuns
        jobs={liveJobs}
        activeTranslationJobs={activeTranslationJobs}
        activeImportJobs={activeImportJobs}
        pendingJobId={pendingJobId}
        onCancel={handleCancelJob}
        onViewDetails={handleViewDetails}
        onOpenNovel={handleOpenNovel}
      />

      <ActivityAttention
        jobs={failedJobs}
        failedTranslationJobs={stats.failedTranslationJobs}
        failedImportJobs={stats.failedImportJobs}
        pendingJobId={pendingJobId}
        onRetry={handleRetryJob}
        onViewDetails={handleViewDetails}
        onOpenNovel={handleOpenNovel}
      />

      <Card size="sm">
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Metric
            framed={false}
            label="Avg chunk latency"
            value={formatDuration(stats.avgChunkLatencyMs)}
          />
          <Metric
            framed={false}
            label="Tokens"
            value={mounted ? compactTokenCount : totalTokens}
            detail={
              <>
                Prompt {stats.promptTokens.toLocaleString()} · Completion{" "}
                {stats.completionTokens.toLocaleString()}
              </>
            }
          />
        </CardContent>
      </Card>

      <JobHistoryTable
        search={search}
        query={{
          page: history,
          isPending: historyQuery.isPending,
          isFetching: historyQuery.isFetching,
          isPlaceholderData: historyQuery.isPlaceholderData,
          isError: historyQuery.isError,
          error: historyQuery.error,
        }}
        onRetry={() => void historyQuery.refetch()}
        onSearchChange={updateSearch}
        pendingJobId={pendingJobId}
        actions={jobHistoryActions}
      />

      <ConfirmDialog
        open={operation !== null}
        onOpenChange={(open) => !open && setOperation(null)}
        title={operation ? getOperationTitle(operation) : "Confirm job operation"}
        description={operation ? getOperationDescription(operation) : ""}
        confirmText={
          pendingJobId ? "Working…" : operation?.kind === "cancel" ? "Cancel job" : "Retry job"
        }
        variant={operation?.kind === "cancel" ? "destructive" : "default"}
        pending={pendingJobId !== null}
        onConfirm={() => void handleConfirmOperation()}
      />

      <JobLogDrawer
        jobId={translationDetails?.jobId ?? null}
        chapterId={translationDetails?.chapterId ?? null}
        open={translationDetails !== null}
        onOpenChange={(open) => !open && setTranslationDetails(null)}
      />

      <ImportJobDrawer
        jobId={importDetailsJobId}
        open={importDetailsJobId !== null}
        onOpenChange={(open) => !open && setImportDetailsJobId(null)}
      />
    </div>
  );
}

function getOperationTitle(operation: Exclude<Operation, null>) {
  return operation.kind === "cancel" ? "Cancel this job?" : "Retry this job?";
}

function getOperationDescription(operation: Exclude<Operation, null>) {
  const { job } = operation;
  const target = `${job.novelTitle} (${job.id})`;
  if (operation.kind === "cancel") {
    return `Cancel ${target}? The worker will stop before its next step.`;
  }
  if (job.type === "translation") {
    return `Retry ${target}? Completed chunks will be resumed, and a newer active translation for this chapter may be cancelled.`;
  }
  return `Retry ${target}? This creates a new history row and cancels any active import for the novel.`;
}

function formatDuration(value: number) {
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(value < 10000 ? 1 : 0)}s`;
}
