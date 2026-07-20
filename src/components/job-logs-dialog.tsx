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
import {
  getTranslationJobStatus,
  type LogEntry,
  type ChunkProgress,
} from "@/lib/translation/translation.functions";
import { ChapterStatusBadge } from "./chapter-status-badge";
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

  if (!open || (!jobId && !chapterId)) return null;

  const logs: LogEntry[] = jobData?.logs || [];
  const chunks: ChunkProgress[] = jobData?.chunks || [];
  const usage = jobData?.usageJson ? JSON.parse(jobData.usageJson) : null;

  // Calculate live token counts from completed chunks if aggregate usage not finalized yet
  const livePromptTokens =
    usage?.totalPromptTokens ?? chunks.reduce((acc, c) => acc + (c.promptTokens || 0), 0);
  const liveCompletionTokens =
    usage?.totalCompletionTokens ?? chunks.reduce((acc, c) => acc + (c.completionTokens || 0), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl sm:max-w-4xl lg:max-w-5xl w-[92vw] h-[85vh] max-h-[90vh] flex flex-col gap-5 p-6 overflow-hidden">
        <DialogHeader className="flex flex-row items-center justify-between border-b border-border pb-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
              <Terminal className="size-5 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-section font-semibold tracking-tight">
                Translation Job Logs
              </DialogTitle>
              {jobData?.chapterTitle && (
                <p className="text-body text-muted-foreground mt-0.5 font-medium">
                  {jobData.chapterTitle}
                </p>
              )}
            </div>
          </div>
          {jobData && (
            <div className="flex items-center gap-2">
              <ChapterStatusBadge status={jobData.status as any} />
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
          <div className="flex flex-col gap-6 overflow-y-auto pr-2 flex-1">
            {/* Quick Metrics Bar */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
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
              <div className="bg-charcoal text-cream/90 font-mono text-xs rounded-xl p-4 h-64 overflow-y-auto flex flex-col gap-2 border border-border shadow-inner">
                {logs.length === 0 ? (
                  <span className="text-cream/40 italic">No logs recorded yet.</span>
                ) : (
                  logs.map((log, i) => (
                    <div key={i} className="flex items-start gap-2.5 leading-relaxed">
                      <span className="text-cream/40 shrink-0 font-mono">[{log.timestamp}]</span>
                      <span
                        className={
                          log.level === "error"
                            ? "text-red-400 font-semibold"
                            : log.level === "warn"
                              ? "text-amber-400 font-semibold"
                              : log.level === "success"
                                ? "text-emerald-400 font-semibold"
                                : "text-sky-300 font-medium"
                        }
                      >
                        [{log.level.toUpperCase()}]
                      </span>
                      <span className="wrap-break-word text-cream/90">{log.message}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Chunk Breakdown Table */}
            {chunks.length > 0 && (
              <div className="flex flex-col gap-2">
                <h4 className="text-caption font-semibold uppercase tracking-wider text-muted-foreground">
                  Chunk Details & Metrics
                </h4>
                <div className="rounded-xl border border-border overflow-hidden bg-card">
                  <Table>
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
                      {chunks.map((chunk, idx) => (
                        <TableRow key={idx} className="h-11">
                          <TableCell className="font-mono font-medium">{chunk.index + 1}</TableCell>
                          <TableCell className="font-mono text-muted-foreground">
                            {chunk.text.length.toLocaleString()} chars
                          </TableCell>
                          <TableCell>
                            {chunk.translation ? (
                              <Badge
                                variant="outline"
                                className="text-xs text-emerald-600 border-emerald-500/30 bg-emerald-500/10 font-medium"
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
