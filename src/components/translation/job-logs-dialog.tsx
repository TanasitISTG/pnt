import { useHydrated } from "@/lib/use-hydrated";
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Spinner } from "@/components/ui/spinner";
import { getTranslationJobDetails, getTranslationJobProgress } from "@/lib/translation/api/queries";
import { QueryErrorState } from "@/components/query-error-state";
import type { LogEntry } from "@/lib/translation/types/workflow";
import type {
  SlimChunkProgress,
  TranslationJobDetails,
  TranslationJobProgress,
} from "@/lib/translation/types/api";
import { ChapterStatusBadge } from "@/components/chapters/chapter-status-badge";
import type { ChapterStatus } from "@/components/chapters/types";
import { formatLocalDateTime, formatLocalTime, parseDateTime } from "@/lib/date-time";
import { Cpu, Terminal, XCircle, Zap } from "lucide-react";

function isRunningStatus(status: string | undefined): boolean {
  return status === "running" || status === "pending";
}

function useJobLogsQueries(
  jobId: string | null | undefined,
  chapterId: string | null | undefined,
  open: boolean,
) {
  const lookup = jobId ? { jobId } : chapterId ? { chapterId } : {};
  const queryKey = jobId || chapterId;
  const progressQuery = useQuery({
    queryKey: ["translationJobProgress", queryKey],
    queryFn: () => getTranslationJobProgress({ data: lookup }),
    enabled: open && !!queryKey,
    staleTime: 500,
    refetchInterval: (query) => (isRunningStatus(query.state.data?.status) ? 1_500 : false),
    refetchIntervalInBackground: false,
  });
  const detailsQuery = useQuery({
    queryKey: ["translationJobDetails", queryKey],
    queryFn: () => getTranslationJobDetails({ data: lookup }),
    enabled: open && !!queryKey,
    staleTime: 10_000,
    refetchInterval: (query) => (isRunningStatus(query.state.data?.status) ? 10_000 : false),
    refetchIntervalInBackground: false,
  });
  const previousStatusRef = useRef<string | undefined>(undefined);
  const refetchDetails = detailsQuery.refetch;

  useEffect(() => {
    const status = progressQuery.data?.status;
    const previousStatus = previousStatusRef.current;
    previousStatusRef.current = status;
    if (status && previousStatus && isRunningStatus(previousStatus) && !isRunningStatus(status)) {
      void refetchDetails();
    }
  }, [progressQuery.data?.status, refetchDetails]);

  return { progressQuery, detailsQuery };
}

type JobUsage = {
  totalPromptTokens: number;
  totalCompletionTokens: number;
};

function parseJobUsage(value: string | null | undefined): JobUsage | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const totalPromptTokens = record.totalPromptTokens;
    const totalCompletionTokens = record.totalCompletionTokens;
    if (
      typeof totalPromptTokens !== "number" ||
      !Number.isFinite(totalPromptTokens) ||
      typeof totalCompletionTokens !== "number" ||
      !Number.isFinite(totalCompletionTokens)
    ) {
      return null;
    }
    return { totalPromptTokens, totalCompletionTokens };
  } catch {
    return null;
  }
}

interface JobLogsDialogHeaderProps {
  jobData: TranslationJobDetails | null | undefined;
  status: TranslationJobProgress["status"] | undefined;
}

function JobLogsDialogHeader({ jobData, status }: JobLogsDialogHeaderProps) {
  const running = isRunningStatus(status);
  return (
    <DialogHeader className="flex shrink-0 flex-col items-start gap-3 border-b border-border pb-4 pr-8 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10">
          <Terminal className="size-5 text-primary" />
        </div>
        <div className="min-w-0">
          <DialogTitle className="text-body-lg font-semibold tracking-tight sm:text-section">
            Translation Job Logs
          </DialogTitle>
          {jobData?.chapterTitle ? (
            <p className="mt-0.5 break-words text-body font-medium text-muted-foreground">
              {jobData.chapterTitle}
            </p>
          ) : null}
        </div>
      </div>
      {status ? (
        <div className="flex shrink-0 items-center gap-2">
          <ChapterStatusBadge status={status as ChapterStatus} />
          {running ? <Spinner className="size-4 text-muted-foreground" /> : null}
        </div>
      ) : null}
    </DialogHeader>
  );
}

interface JobLogsDialogProps {
  jobId?: string | null;
  chapterId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function getLogLevelClassName(level: string) {
  switch (level) {
    case "error":
      return "font-semibold text-red-400";
    case "warn":
      return "font-semibold text-amber-400";
    case "success":
      return "font-semibold text-emerald-400";
    default:
      return "font-medium text-sky-300";
  }
}

function LogEntryRow({ log, mounted }: { log: LogEntry; mounted: boolean }) {
  const timestamp = parseDateTime(log.timestamp);
  const timestampLabel =
    timestamp && mounted ? formatLocalTime(timestamp) : timestamp ? "—" : log.timestamp;
  return (
    <div className="grid grid-cols-[auto_1fr] items-start gap-x-2.5 gap-y-1 leading-relaxed sm:grid-cols-[auto_auto_minmax(0,1fr)]">
      <time
        className="shrink-0 font-mono text-cream/40"
        dateTime={timestamp?.toISOString()}
        title={timestamp && mounted ? formatLocalDateTime(timestamp) : undefined}
      >
        [{timestampLabel}]
      </time>
      <span className={getLogLevelClassName(log.level)}>[{log.level.toUpperCase()}]</span>
      <span className="col-span-2 min-w-0 whitespace-pre-wrap break-words text-cream/90 sm:col-span-1">
        {log.message}
      </span>
    </div>
  );
}

function LogConsole({ logs, mounted }: { logs: LogEntry[]; mounted: boolean }) {
  return (
    <div className="flex flex-col gap-2 shrink-0">
      <h4 className="text-caption font-semibold uppercase tracking-wider text-muted-foreground">
        Live Execution Console
      </h4>
      <div className="flex h-64 flex-col gap-3 overflow-y-auto rounded-xl border border-border bg-charcoal p-3 font-mono text-xs text-cream/90 shadow-inner sm:gap-2 sm:p-4">
        {logs.length === 0 ? (
          <span className="text-cream/40 italic">No logs recorded yet.</span>
        ) : (
          logs.map((log) => <LogEntryRow key={log.id} log={log} mounted={mounted} />)
        )}
      </div>
    </div>
  );
}

function ChunkMetricsTable({ chunks }: { chunks: SlimChunkProgress[] }) {
  if (chunks.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-caption font-semibold uppercase tracking-wider text-muted-foreground">
        Chunk Details & Metrics
      </h4>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <Table className="min-w-[680px]">
          <TableHeader>
            <TableRow className="h-10 bg-muted/20">
              <TableHead className="w-16 h-10 font-semibold">Chunk #</TableHead>
              <TableHead className="h-10 font-semibold">Raw Content Size</TableHead>
              <TableHead className="h-10 font-semibold">Status</TableHead>
              <TableHead className="h-10 font-semibold">Latency</TableHead>
              <TableHead className="h-10 font-semibold text-right">
                Tokens (Prompt + Completion)
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {chunks.map((chunk) => (
              <TableRow key={chunk.index} className="h-11">
                <TableCell className="font-mono font-medium">{chunk.index + 1}</TableCell>
                <TableCell className="font-mono text-muted-foreground">
                  {chunk.textLength.toLocaleString()} chars
                </TableCell>
                <TableCell>
                  {chunk.hasTranslation ? (
                    <Badge
                      variant="outline"
                      className="text-xs text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/10 font-medium"
                    >
                      Completed
                    </Badge>
                  ) : chunk.error ? (
                    <Badge variant="destructive" className="text-xs font-medium">
                      Failed
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-xs font-medium">
                      Pending
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="font-mono text-muted-foreground">
                  {chunk.latencyMs ? `${(chunk.latencyMs / 1000).toFixed(1)}s` : "—"}
                </TableCell>
                <TableCell className="text-right font-mono font-medium text-foreground">
                  {chunk.promptTokens !== undefined && chunk.completionTokens !== undefined
                    ? `${(chunk.promptTokens + chunk.completionTokens).toLocaleString()} (${chunk.promptTokens} + ${chunk.completionTokens})`
                    : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

interface JobMetricsBarProps {
  provider: string | null;
  model: string;
  isLegacyProviderFallback: boolean;
  doneChunks: number;
  totalChunks: number;
  promptTokens: number;
  completionTokens: number;
}

function JobMetricsBar({
  provider,
  model,
  isLegacyProviderFallback,
  doneChunks,
  totalChunks,
  promptTokens,
  completionTokens,
}: JobMetricsBarProps) {
  return (
    <div className="grid shrink-0 grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
      <div className="bg-muted/30 border border-border rounded-xl p-4 flex flex-col gap-1 min-w-0">
        <span className="text-caption text-muted-foreground font-medium flex items-center gap-1.5 whitespace-nowrap">
          <Cpu className="size-4 text-muted-foreground" /> Model
        </span>
        <span className="truncate text-body-lg font-semibold text-foreground" title={model}>
          {model}
        </span>
        <span className="truncate text-caption text-muted-foreground" title={provider ?? undefined}>
          {provider ?? "Current provider settings"}
          {isLegacyProviderFallback ? " · legacy fallback" : ""}
        </span>
      </div>
      <div className="bg-muted/30 border border-border rounded-xl p-4 flex flex-col gap-1 min-w-0">
        <span className="text-caption text-muted-foreground font-medium flex items-center gap-1.5 whitespace-nowrap">
          <Zap className="size-4 text-muted-foreground" /> Progress
        </span>
        <span className="text-body-lg font-semibold text-foreground">
          {doneChunks} / {totalChunks} chunks
        </span>
      </div>
      <div className="bg-muted/30 border border-border rounded-xl p-4 flex flex-col gap-1 min-w-0">
        <span className="text-caption text-muted-foreground font-medium whitespace-nowrap">
          Prompt Tokens
        </span>
        <span className="text-body-lg font-semibold text-foreground">
          {promptTokens ? promptTokens.toLocaleString() : "—"}
        </span>
      </div>
      <div className="bg-muted/30 border border-border rounded-xl p-4 flex flex-col gap-1 min-w-0">
        <span className="text-caption text-muted-foreground font-medium whitespace-nowrap">
          Completion Tokens
        </span>
        <span className="text-body-lg font-semibold text-foreground">
          {completionTokens ? completionTokens.toLocaleString() : "—"}
        </span>
      </div>
    </div>
  );
}

export function JobLogsDialog({ jobId, chapterId, open, onOpenChange }: JobLogsDialogProps) {
  const { progressQuery, detailsQuery } = useJobLogsQueries(jobId, chapterId, open);
  const mounted = useHydrated();
  const progress = progressQuery.data;
  const jobData = detailsQuery.data;
  const status = progress?.status ?? jobData?.status;
  const queryError = progressQuery.isError ? progressQuery.error : detailsQuery.error;

  if (!open || (!jobId && !chapterId)) return null;

  const logs: LogEntry[] = (jobData?.logs || []).map((log, index) =>
    log.id ? log : { ...log, id: `legacy-${index}` },
  );
  const chunks: SlimChunkProgress[] = jobData?.chunks || [];
  const usage = parseJobUsage(jobData?.usageJson);
  const livePromptTokens =
    usage?.totalPromptTokens ?? chunks.reduce((sum, chunk) => sum + (chunk.promptTokens || 0), 0);
  const liveCompletionTokens =
    usage?.totalCompletionTokens ??
    chunks.reduce((sum, chunk) => sum + (chunk.completionTokens || 0), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-4xl flex-col gap-4 overflow-hidden p-4 sm:h-[85vh] sm:max-h-[90vh] sm:w-[92vw] sm:max-w-4xl sm:gap-5 sm:p-6 lg:max-w-5xl">
        <JobLogsDialogHeader jobData={jobData} status={status} />

        {queryError && !jobData ? (
          <QueryErrorState
            title="Unable to load job details"
            error={queryError}
            onRetry={() => void Promise.all([progressQuery.refetch(), detailsQuery.refetch()])}
            className="my-8"
          />
        ) : progressQuery.isPending && !progress && !jobData ? (
          <div className="flex flex-1 flex-col items-center justify-center py-16 text-muted-foreground">
            <Spinner className="mb-3 size-8 text-primary" />
            <p className="text-body">Loading job progress…</p>
          </div>
        ) : detailsQuery.isPending && !jobData ? (
          <div className="flex flex-1 flex-col items-center justify-center py-16 text-muted-foreground">
            <Spinner className="mb-3 size-8 text-primary" />
            <p className="text-body">Loading job details and logs…</p>
          </div>
        ) : detailsQuery.data === null ? (
          <div className="flex-1 py-16 text-center text-muted-foreground">
            Job details not found.
          </div>
        ) : jobData ? (
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto sm:gap-6 sm:pr-2">
            {detailsQuery.isError ? (
              <QueryErrorState
                title="Unable to refresh job details"
                error={detailsQuery.error}
                onRetry={() => void detailsQuery.refetch()}
                className="my-0 min-h-0 shrink-0 rounded-xl border border-destructive/20 p-3"
              />
            ) : null}
            {progressQuery.isError ? (
              <QueryErrorState
                title="Unable to refresh job progress"
                error={progressQuery.error}
                onRetry={() => void progressQuery.refetch()}
                className="my-0 min-h-0 shrink-0 rounded-xl border border-destructive/20 p-3"
              />
            ) : null}
            <JobMetricsBar
              provider={jobData.provider}
              model={jobData.model}
              isLegacyProviderFallback={jobData.isLegacyProviderFallback}
              doneChunks={progress?.doneChunks ?? jobData.doneChunks}
              totalChunks={progress?.totalChunks ?? jobData.totalChunks}
              promptTokens={livePromptTokens}
              completionTokens={liveCompletionTokens}
            />
            {jobData.error ? (
              <div className="flex shrink-0 items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-body font-medium text-destructive">
                <XCircle className="mt-0.5 size-5 shrink-0" />
                <span className="break-all">{jobData.error}</span>
              </div>
            ) : null}
            <LogConsole logs={logs} mounted={mounted} />
            <ChunkMetricsTable chunks={chunks} />
          </div>
        ) : (
          <div className="flex-1 py-16 text-center text-muted-foreground">
            Job details are still loading.
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
