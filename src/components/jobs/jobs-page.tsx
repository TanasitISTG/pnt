import { getRouteApi } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { ImportJobDetailsDialog } from "@/components/jobs/import-job-details-dialog";
import { JobHistoryTable } from "@/components/jobs/job-history-table";
import { JobLogsDialog } from "@/components/translation/job-logs-dialog";
import { Metric } from "@/components/jobs/metric";
import { Button } from "@/components/ui/button";
import {
  historyQueryOptions,
  JOB_HISTORY_QUERY_KEY,
  JOB_STATS_QUERY_KEY,
  statsQueryOptions,
} from "@/lib/job-dashboard/query";
import type { JobHistoryRow, JobHistorySearch, JobStats } from "@/lib/job-dashboard/contracts";
import { cancelTranslationJob, retryTranslationJob } from "@/lib/translation/api/mutations";
import { cancelImportJob, startImportJob } from "@/lib/scrape/functions";

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

async function handleCopyJobId(job: JobHistoryRow) {
  try {
    await navigator.clipboard.writeText(job.id);
    toast.success("Job ID copied");
  } catch {
    toast.error("Unable to copy job ID");
  }
}

export function JobsPage() {
  const search = jobsRoute.useSearch();
  const navigate = jobsRoute.useNavigate();
  const queryClient = useQueryClient();
  const historyQuery = useQuery(historyQueryOptions(search));
  const statsQuery = useQuery(statsQueryOptions());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [operation, setOperation] = useState<Operation>(null);
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);
  const [translationDetails, setTranslationDetails] = useState<{
    jobId: string;
    chapterId: string;
  } | null>(null);
  const [importDetailsJobId, setImportDetailsJobId] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

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
      const results = await Promise.allSettled([historyQuery.refetch(), statsQuery.refetch()]);
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
      queryClient.invalidateQueries({ queryKey: JOB_HISTORY_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: JOB_STATS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: ["chapters", job.novelId] }),
      queryClient.invalidateQueries({ queryKey: ["novels"] }),
      queryClient.invalidateQueries({ queryKey: ["costs", job.novelId] }),
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

  const handleViewDetails = (job: JobHistoryRow) => {
    if (job.type === "translation") {
      setTranslationDetails({ jobId: job.id, chapterId: job.chapterId });
    } else {
      setImportDetailsJobId(job.id);
    }
  };

  const stats = statsQuery.data ?? EMPTY_STATS;
  const totalTokens = Number(stats.promptTokens) + Number(stats.completionTokens);
  const compactTokenCount = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(totalTokens),
    [totalTokens],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-caption font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Operations
          </p>
          <h1 className="mt-1 text-display-alt font-semibold text-foreground">Job activity</h1>
          <p className="mt-1 max-w-2xl text-body-lg text-muted-foreground">
            Inspect every retained translation and import run, then act on failures without leaving
            the work queue.
          </p>
        </div>
        <Button variant="outline" onClick={handleRefresh} disabled={isRefreshing}>
          {isRefreshing ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Active jobs"
          value={stats.activeTranslationJobs + stats.activeImportJobs}
          detail={
            <>
              Translation {stats.activeTranslationJobs} · Import {stats.activeImportJobs}
            </>
          }
        />
        <Metric
          label="Failed jobs"
          value={stats.failedTranslationJobs + stats.failedImportJobs}
          detail={
            <>
              Translation {stats.failedTranslationJobs} · Import {stats.failedImportJobs}
            </>
          }
        />
        <Metric label="Avg chunk latency" value={formatDuration(stats.avgChunkLatencyMs)} />
        <Metric
          label="Tokens"
          value={mounted ? compactTokenCount : totalTokens}
          detail={
            <>
              Prompt {stats.promptTokens.toLocaleString()} · Completion{" "}
              {stats.completionTokens.toLocaleString()}
            </>
          }
        />
      </div>

      <JobHistoryTable
        history={historyQuery.data}
        search={search}
        isPending={historyQuery.isPending}
        isFetching={historyQuery.isFetching}
        isPlaceholderData={historyQuery.isPlaceholderData}
        isError={historyQuery.isError}
        error={historyQuery.error}
        onRetry={() => void historyQuery.refetch()}
        onSearchChange={updateSearch}
        pendingJobId={pendingJobId}
        actions={{
          onViewDetails: handleViewDetails,
          onOpenNovel: (novelId) => void navigate({ to: "/novels/$novelId", params: { novelId } }),
          onOpenChapter: (job) =>
            void navigate({
              to: "/novels/$novelId/chapters/$chapterId",
              params: { novelId: job.novelId, chapterId: job.chapterId },
            }),
          onCopyJobId: (job) => void handleCopyJobId(job),
          onCancel: (job) => setOperation({ kind: "cancel", job }),
          onRetry: (job) => setOperation({ kind: "retry", job }),
        }}
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

      <JobLogsDialog
        jobId={translationDetails?.jobId ?? null}
        chapterId={translationDetails?.chapterId ?? null}
        open={translationDetails !== null}
        onOpenChange={(open) => !open && setTranslationDetails(null)}
      />

      <ImportJobDetailsDialog
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
