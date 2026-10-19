import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Cpu, Terminal, XCircle, Zap } from "lucide-react";
import { useLocale, useTranslations } from "use-intl";

import { ChapterStatusBadge } from "@/components/chapters/table/chapter-status-badge";
import type { ChapterStatus } from "@/components/chapters/types";
import { JobErrorText } from "@/components/jobs/job-error-text";
import { QueryErrorState } from "@/components/query-error-state";
import { Badge } from "@/components/ui/badge";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useHydrated } from "@/lib/use-hydrated";
import { useIsDesktop } from "@/lib/use-media-query";
import { getTranslationJobDetails, getTranslationJobProgress } from "@/lib/translation/api/queries";
import type {
  SlimChunkProgress,
  TranslationJobDetails,
  TranslationJobProgress,
} from "@/lib/translation/types/api";
import type { LogEntry } from "@/lib/translation/types/workflow";
import { formatDateTime, formatNumber, formatTime, parseDateTime } from "@/lib/i18n/format";
import { translateMessage } from "@/lib/i18n/server-error";

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

interface JobLogHeaderProps {
  jobData: TranslationJobDetails | null | undefined;
  status: TranslationJobProgress["status"] | undefined;
}

function JobLogHeader({ jobData, status }: JobLogHeaderProps) {
  const t = useTranslations("job");
  const running = isRunningStatus(status);
  return (
    <DrawerHeader>
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border-strong bg-surface-inset">
          <Terminal className="size-4 text-muted-foreground" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <DrawerTitle>{t("title")}</DrawerTitle>
          {jobData?.chapterTitle ? (
            <p className="mt-0.5 break-words text-caption text-muted-foreground">
              {jobData.chapterTitle}
            </p>
          ) : null}
        </div>
      </div>
      {status ? (
        <div className="flex items-center gap-2">
          <ChapterStatusBadge status={status as ChapterStatus} />
          {running ? <Spinner variant="muted" className="size-4" /> : null}
        </div>
      ) : null}
    </DrawerHeader>
  );
}

export interface JobLogDrawerProps {
  jobId?: string | null;
  chapterId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function getLogLevelClassName(level: string) {
  switch (level) {
    case "error":
      return "font-semibold text-foreground";
    case "warn":
      return "font-semibold text-warning";
    case "success":
      return "font-semibold text-success";
    default:
      return "font-medium text-info";
  }
}

function LogEntryRow({ log, mounted }: { log: LogEntry; mounted: boolean }) {
  const t = useTranslations();
  const locale = useLocale();
  const timestamp = parseDateTime(log.timestamp);
  const timestampLabel =
    timestamp && mounted ? formatTime(timestamp, locale) : timestamp ? "—" : log.timestamp;
  return (
    <div className="grid grid-cols-[auto_1fr] items-start gap-x-2.5 gap-y-1 leading-relaxed sm:grid-cols-[auto_auto_minmax(0,1fr)]">
      <time
        className="shrink-0 font-mono text-muted-foreground"
        dateTime={timestamp?.toISOString()}
        title={timestamp && mounted ? formatDateTime(timestamp, locale) : undefined}
      >
        [{timestampLabel}]
      </time>
      <span className={getLogLevelClassName(log.level)}>[{log.level.toUpperCase()}]</span>
      <span className="col-span-2 min-w-0 break-words whitespace-pre-wrap text-foreground sm:col-span-1">
        {/* A row written by a previous release holds a sentence, not a code, and reads as what
            was stored. */}
        {translateMessage(log.message, t) ?? log.message}
      </span>
    </div>
  );
}

function LogConsole({ logs, mounted }: { logs: LogEntry[]; mounted: boolean }) {
  const t = useTranslations("job");
  return (
    <div className="flex shrink-0 flex-col gap-2">
      <h4 className="text-caption font-semibold tracking-wider text-muted-foreground uppercase">
        {t("logTitle")}
      </h4>
      <div className="flex h-64 flex-col gap-3 overflow-y-auto rounded-xl border border-border bg-surface-2 p-3 font-mono text-xs text-foreground sm:gap-2 sm:p-4">
        {logs.length === 0 ? (
          <span className="text-muted-foreground italic">{t("logEmpty")}</span>
        ) : (
          logs.map((log) => <LogEntryRow key={log.id} log={log} mounted={mounted} />)
        )}
      </div>
    </div>
  );
}

function ChunkMetricsTable({ chunks }: { chunks: SlimChunkProgress[] }) {
  const t = useTranslations("job");
  const locale = useLocale();
  if (chunks.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-caption font-semibold tracking-wider text-muted-foreground uppercase">
        {t("chunksTitle")}
      </h4>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <Table className="min-w-[620px]">
          <TableHeader>
            <TableRow className="h-10 bg-muted/20">
              <TableHead className="h-10 w-16 font-semibold">{t("chunkColumn")}</TableHead>
              <TableHead className="h-10 font-semibold">{t("rawSizeColumn")}</TableHead>
              <TableHead className="h-10 font-semibold">{t("statusColumn")}</TableHead>
              <TableHead className="h-10 font-semibold">{t("latencyColumn")}</TableHead>
              <TableHead className="h-10 text-right font-semibold">{t("tokensColumn")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {chunks.map((chunk) => (
              <TableRow key={chunk.index} className="h-11">
                <TableCell className="font-mono font-medium">{chunk.index + 1}</TableCell>
                <TableCell className="font-mono text-muted-foreground">
                  {t("chunkSize", { count: chunk.textLength })}
                </TableCell>
                <TableCell>
                  {chunk.hasTranslation ? (
                    <Badge variant="success">{t("chunkStatusCompleted")}</Badge>
                  ) : chunk.error ? (
                    <Badge variant="destructive">{t("chunkStatusFailed")}</Badge>
                  ) : (
                    <Badge variant="secondary">{t("chunkStatusPending")}</Badge>
                  )}
                </TableCell>
                <TableCell className="font-mono text-muted-foreground">
                  {chunk.latencyMs
                    ? t("chunkLatencySeconds", { seconds: (chunk.latencyMs / 1000).toFixed(1) })
                    : "—"}
                </TableCell>
                <TableCell className="text-right font-mono font-medium text-foreground">
                  {chunk.promptTokens !== undefined && chunk.completionTokens !== undefined
                    ? formatNumber(chunk.promptTokens + chunk.completionTokens, locale)
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

interface JobMetricsProps {
  provider: string | null;
  model: string;
  isLegacyProviderFallback: boolean;
  doneChunks: number;
  totalChunks: number;
  promptTokens: number;
  completionTokens: number;
}

function JobMetrics({
  provider,
  model,
  isLegacyProviderFallback,
  doneChunks,
  totalChunks,
  promptTokens,
  completionTokens,
}: JobMetricsProps) {
  const t = useTranslations("job");
  const locale = useLocale();
  return (
    <dl className="grid shrink-0 grid-cols-2 gap-3">
      <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-border bg-surface-inset p-3">
        <dt className="flex items-center gap-1.5 text-caption text-muted-foreground">
          <Cpu className="size-3.5" aria-hidden="true" /> {t("modelLabel")}
        </dt>
        <dd className="min-w-0">
          <span className="block truncate text-caption font-semibold text-foreground" title={model}>
            {model}
          </span>
          <span
            className="block truncate text-micro text-muted-foreground"
            title={provider ?? undefined}
          >
            {provider ?? t("providerCurrent")}
            {isLegacyProviderFallback ? ` · ${t("providerLegacyFallback")}` : ""}
          </span>
        </dd>
      </div>
      <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-border bg-surface-inset p-3">
        <dt className="flex items-center gap-1.5 text-caption text-muted-foreground">
          <Zap className="size-3.5" aria-hidden="true" /> {t("progressLabel")}
        </dt>
        <dd className="text-caption font-semibold tabular-nums text-foreground">
          {t("progressChunks", { done: doneChunks, total: totalChunks })}
        </dd>
      </div>
      <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-border bg-surface-inset p-3">
        <dt className="text-caption text-muted-foreground">{t("promptTokensLabel")}</dt>
        <dd className="text-caption font-semibold tabular-nums text-foreground">
          {promptTokens ? formatNumber(promptTokens, locale) : "—"}
        </dd>
      </div>
      <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-border bg-surface-inset p-3">
        <dt className="text-caption text-muted-foreground">{t("completionTokensLabel")}</dt>
        <dd className="text-caption font-semibold tabular-nums text-foreground">
          {completionTokens ? formatNumber(completionTokens, locale) : "—"}
        </dd>
      </div>
    </dl>
  );
}

/**
 * One translation run's detail, as a drawer.
 *
 * It was a centred modal, which put the console behind a scrim: the point of opening a
 * run is to compare it against the queue it came from. The panel travels from the right
 * on a pointer screen and from the bottom under a thumb, and the queue stays visible
 * beside it. Nothing about the content moved — the live log, the chunk table and the
 * usage figures are the ones the modal rendered.
 */
export function JobLogDrawer({ jobId, chapterId, open, onOpenChange }: JobLogDrawerProps) {
  const t = useTranslations("job");
  const { progressQuery, detailsQuery } = useJobLogsQueries(jobId, chapterId, open);
  const mounted = useHydrated();
  const isDesktop = useIsDesktop();
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
    <Drawer open={open} onOpenChange={onOpenChange} swipeDirection={isDesktop ? "right" : "down"}>
      <DrawerContent side={isDesktop ? "end" : "bottom"}>
        <JobLogHeader jobData={jobData} status={status} />
        <DrawerBody>
          <div className="flex min-h-full flex-col gap-4">
            {queryError && !jobData ? (
              <QueryErrorState
                title={t("loadFailedTitle")}
                error={queryError}
                onRetry={() => void Promise.all([progressQuery.refetch(), detailsQuery.refetch()])}
                className="my-0"
              />
            ) : (progressQuery.isPending && !progress && !jobData) ||
              (detailsQuery.isPending && !jobData) ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
                <Spinner variant="primary" className="size-7" aria-hidden="true" />
                <p className="text-body">{t("loading")}</p>
              </div>
            ) : jobData === null ? (
              <p className="py-16 text-center text-body text-muted-foreground">{t("notFound")}</p>
            ) : jobData ? (
              <>
                {detailsQuery.isError ? (
                  <QueryErrorState
                    variant="panel"
                    title={t("refreshDetailsFailed")}
                    error={detailsQuery.error}
                    onRetry={() => void detailsQuery.refetch()}
                    className="my-0 min-h-0"
                  />
                ) : null}
                {progressQuery.isError ? (
                  <QueryErrorState
                    variant="panel"
                    title={t("refreshProgressFailed")}
                    error={progressQuery.error}
                    onRetry={() => void progressQuery.refetch()}
                    className="my-0 min-h-0"
                  />
                ) : null}
                <JobMetrics
                  provider={jobData.provider}
                  model={jobData.model}
                  isLegacyProviderFallback={jobData.isLegacyProviderFallback}
                  doneChunks={progress?.doneChunks ?? jobData.doneChunks}
                  totalChunks={progress?.totalChunks ?? jobData.totalChunks}
                  promptTokens={livePromptTokens}
                  completionTokens={liveCompletionTokens}
                />
                {jobData.error ? (
                  <div
                    className="flex shrink-0 items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-caption text-destructive-text"
                    role="alert"
                  >
                    <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    <JobErrorText message={jobData.error} className="break-all" />
                  </div>
                ) : null}
                <LogConsole logs={logs} mounted={mounted} />
                <ChunkMetricsTable chunks={chunks} />
              </>
            ) : (
              <p className="py-16 text-center text-body text-muted-foreground">
                {t("stillLoading")}
              </p>
            )}
          </div>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
