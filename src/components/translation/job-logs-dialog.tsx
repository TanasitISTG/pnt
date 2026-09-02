import { useHydrated } from "@/lib/use-hydrated";
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
import { getTranslationJobStatus } from "@/lib/translation/api/queries";
import { formatLocalDateTime, formatLocalTime, parseDateTime } from "@/lib/date-time";
import type { LogEntry } from "@/lib/translation/types/workflow";
import type { SlimChunkProgress } from "@/lib/translation/types/api";
import { ChapterStatusBadge } from "@/components/chapters/chapter-status-badge";
import type { ChapterStatus } from "@/components/chapters/types";
import { Loader2, Terminal, Cpu, Zap, XCircle } from "lucide-react";
function useJobLogsQuery(
  jobId: string | null | undefined,
  chapterId: string | null | undefined,
  open: boolean,
) {
  return useQuery({
    queryKey: ["jobLogs", jobId || chapterId],
    queryFn: () =>
      jobId
        ? getTranslationJobStatus({ data: { jobId } })
        : chapterId
          ? getTranslationJobStatus({ data: { chapterId } })
          : null,
    enabled: open && (!!jobId || !!chapterId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "running" || status === "pending" ? 1500 : false;
    },
  });
}

interface JobLogsDialogHeaderProps {
  jobData: Awaited<ReturnType<typeof getTranslationJobStatus>> | null | undefined;
}

function JobLogsDialogHeader({ jobData }: JobLogsDialogHeaderProps) {
  const running = jobData?.status === "running" || jobData?.status === "pending";
  return (
    <DialogHeader className="flex shrink-0 flex-col items-start gap-3 border-b border-border pb-4 pr-8 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <div className="size-9 shrink-0 rounded-lg border border-primary/20 bg-primary/10 flex items-center justify-center">
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
      {jobData ? (
        <div className="flex shrink-0 items-center gap-2">
          <ChapterStatusBadge status={jobData.status as ChapterStatus} />
          {running ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
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
  model: string;
  doneChunks: number;
  totalChunks: number;
  promptTokens: number;
  completionTokens: number;
}

function JobMetricsBar({
  model,
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
        <span className="text-body-lg font-semibold text-foreground truncate" title={model}>
          {model}
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
  const { data: jobData, isLoading } = useJobLogsQuery(jobId, chapterId, open);
  const mounted = useHydrated();

  if (!open || (!jobId && !chapterId)) return null;

  // Rows written before LogEntry.id existed get a positional fallback id.
  const logs: LogEntry[] = (jobData?.logs || []).map((l, i) =>
    l.id ? l : { ...l, id: `legacy-${i}` },
  );
  const chunks: SlimChunkProgress[] = jobData?.chunks || [];
  const usage = jobData?.usageJson ? JSON.parse(jobData.usageJson) : null;

  // Calculate live token counts from completed chunks if aggregate usage not finalized yet
  const livePromptTokens =
    usage?.totalPromptTokens ?? chunks.reduce((acc, c) => acc + (c.promptTokens || 0), 0);
  const liveCompletionTokens =
    usage?.totalCompletionTokens ?? chunks.reduce((acc, c) => acc + (c.completionTokens || 0), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-4xl flex-col gap-4 overflow-hidden p-4 sm:h-[85vh] sm:max-h-[90vh] sm:w-[92vw] sm:max-w-4xl sm:gap-5 sm:p-6 lg:max-w-5xl">
        <JobLogsDialogHeader jobData={jobData} />

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground flex-1">
            <Loader2 className="size-8 animate-spin mb-3 text-primary" />
            <p className="text-body">Loading job details & logs...</p>
          </div>
        ) : !jobData ? (
          <div className="text-center py-16 text-muted-foreground flex-1">
            Job details not found.
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto sm:gap-6 sm:pr-2">
            <JobMetricsBar
              model={jobData.model}
              doneChunks={jobData.doneChunks}
              totalChunks={jobData.totalChunks}
              promptTokens={livePromptTokens}
              completionTokens={liveCompletionTokens}
            />
            {jobData.error ? (
              <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4 text-destructive text-body font-medium flex items-start gap-3 shrink-0">
                <XCircle className="size-5 shrink-0 mt-0.5" />
                <span className="break-all">{jobData.error}</span>
              </div>
            ) : null}
            <LogConsole logs={logs} mounted={mounted} />
            <ChunkMetricsTable chunks={chunks} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
