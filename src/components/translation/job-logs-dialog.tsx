import { useEffect, useState } from "react";
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
import { getTranslationJobStatus } from "@/lib/translation/translation.functions";
import { formatLocalDateTime, formatLocalTime, parseDateTime } from "@/lib/date-time";
import type { LogEntry, SlimChunkProgress } from "@/lib/translation/translation.types";
import { ChapterStatusBadge } from "@/components/chapters/chapter-status-badge";
import type { ChapterStatus } from "@/components/chapters/types";
import { Loader2, Terminal, Cpu, Zap, XCircle } from "lucide-react";

interface JobLogsDialogProps {
  jobId?: string | null;
  chapterId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function JobLogsDialog({ jobId, chapterId, open, onOpenChange }: JobLogsDialogProps) {
  const { data: jobData, isLoading } = useQuery({
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
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

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
        <DialogHeader className="flex shrink-0 flex-col items-start gap-3 border-b border-border pb-4 pr-8 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="size-9 shrink-0 rounded-lg border border-primary/20 bg-primary/10 flex items-center justify-center">
              <Terminal className="size-5 text-primary" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-body-lg font-semibold tracking-tight sm:text-section">
                Translation Job Logs
              </DialogTitle>
              {jobData?.chapterTitle && (
                <p className="mt-0.5 break-words text-body font-medium text-muted-foreground">
                  {jobData.chapterTitle}
                </p>
              )}
            </div>
          </div>
          {jobData && (
            <div className="flex shrink-0 items-center gap-2">
              <ChapterStatusBadge status={jobData.status as ChapterStatus} />
              {(jobData.status === "running" || jobData.status === "pending") && (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              )}
            </div>
          )}
        </DialogHeader>

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
            {/* Quick Metrics Bar */}
            <div className="grid shrink-0 grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
              <div className="bg-muted/30 border border-border rounded-xl p-4 flex flex-col gap-1 min-w-0">
                <span className="text-caption text-muted-foreground font-medium flex items-center gap-1.5 whitespace-nowrap">
                  <Cpu className="size-4 text-muted-foreground" /> Model
                </span>
                <span
                  className="text-body-lg font-semibold text-foreground truncate"
                  title={jobData.model}
                >
                  {jobData.model}
                </span>
              </div>

              <div className="bg-muted/30 border border-border rounded-xl p-4 flex flex-col gap-1 min-w-0">
                <span className="text-caption text-muted-foreground font-medium flex items-center gap-1.5 whitespace-nowrap">
                  <Zap className="size-4 text-muted-foreground" /> Progress
                </span>
                <span className="text-body-lg font-semibold text-foreground">
                  {jobData.doneChunks} / {jobData.totalChunks} chunks
                </span>
              </div>

              <div className="bg-muted/30 border border-border rounded-xl p-4 flex flex-col gap-1 min-w-0">
                <span className="text-caption text-muted-foreground font-medium whitespace-nowrap">
                  Prompt Tokens
                </span>
                <span className="text-body-lg font-semibold text-foreground">
                  {livePromptTokens ? livePromptTokens.toLocaleString() : "—"}
                </span>
              </div>

              <div className="bg-muted/30 border border-border rounded-xl p-4 flex flex-col gap-1 min-w-0">
                <span className="text-caption text-muted-foreground font-medium whitespace-nowrap">
                  Completion Tokens
                </span>
                <span className="text-body-lg font-semibold text-foreground">
                  {liveCompletionTokens ? liveCompletionTokens.toLocaleString() : "—"}
                </span>
              </div>
            </div>

            {/* Error banner if errored */}
            {jobData.error && (
              <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4 text-destructive text-body font-medium flex items-start gap-3 shrink-0">
                <XCircle className="size-5 shrink-0 mt-0.5" />
                <span className="break-all">{jobData.error}</span>
              </div>
            )}

            {/* Terminal Log Console */}
            <div className="flex flex-col gap-2 shrink-0">
              <h4 className="text-caption font-semibold uppercase tracking-wider text-muted-foreground">
                Live Execution Console
              </h4>
              <div className="flex h-64 flex-col gap-3 overflow-y-auto rounded-xl border border-border bg-charcoal p-3 font-mono text-xs text-cream/90 shadow-inner sm:gap-2 sm:p-4">
                {logs.length === 0 ? (
                  <span className="text-cream/40 italic">No logs recorded yet.</span>
                ) : (
                  logs.map((log) => {
                    const timestamp = parseDateTime(log.timestamp);
                    const timestampLabel =
                      timestamp && mounted
                        ? formatLocalTime(timestamp)
                        : timestamp
                          ? "—"
                          : log.timestamp;

                    return (
                      <div
                        key={log.id}
                        className="grid grid-cols-[auto_1fr] items-start gap-x-2.5 gap-y-1 leading-relaxed sm:grid-cols-[auto_auto_minmax(0,1fr)]"
                      >
                        <time
                          className="shrink-0 font-mono text-cream/40"
                          dateTime={timestamp?.toISOString()}
                          title={timestamp && mounted ? formatLocalDateTime(timestamp) : undefined}
                        >
                          [{timestampLabel}]
                        </time>
                        <span
                          className={
                            log.level === "error"
                              ? "font-semibold text-red-400"
                              : log.level === "warn"
                                ? "font-semibold text-amber-400"
                                : log.level === "success"
                                  ? "font-semibold text-emerald-400"
                                  : "font-medium text-sky-300"
                          }
                        >
                          [{log.level.toUpperCase()}]
                        </span>
                        <span className="col-span-2 min-w-0 whitespace-pre-wrap break-words text-cream/90 sm:col-span-1">
                          {log.message}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Chunk Breakdown Table */}
            {chunks.length > 0 && (
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
                            {chunk.promptTokens !== undefined &&
                            chunk.completionTokens !== undefined
                              ? `${(chunk.promptTokens + chunk.completionTokens).toLocaleString()} (${chunk.promptTokens} + ${chunk.completionTokens})`
                              : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
