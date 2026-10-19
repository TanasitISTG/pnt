import { useQuery } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import type { ReactNode } from "react";
import { useLocale, useTranslations } from "use-intl";

import type { JobsTranslator } from "@/components/jobs/job-history-columns";
import { DateCell } from "@/components/jobs/date-cell";
import { JobErrorText } from "@/components/jobs/job-error-text";
import { StatusBadge } from "@/components/jobs/status-badge";
import { QueryErrorState } from "@/components/query-error-state";
import { Badge } from "@/components/ui/badge";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { formatNumber } from "@/lib/i18n/format";
import { useIsDesktop } from "@/lib/use-media-query";
import { getImportJobStatus } from "@/lib/import/functions";
import type { JobHistoryStatus } from "@/lib/job-dashboard/contracts";

export interface ImportJobDrawerProps {
  jobId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ImportJobDetails {
  id: string;
  novelTitle: string;
  kind: "epub";
  status: string;
  sourceFileName?: string | null;
  fromNumber: number;
  toNumber: number;
  nextNumber: number;
  added: number;
  skipped: number;
  failed: number;
  error: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

function importProgress(job: ImportJobDetails, t: JobsTranslator) {
  const processed = job.added + job.skipped + job.failed;
  if (job.toNumber === 0) {
    return { label: t("preparing"), percent: 0 };
  }
  const total = job.toNumber;
  return {
    label: `${processed} / ${total}`,
    percent: Math.min(100, Math.round((processed / Math.max(1, total)) * 100)),
  };
}

function ImportJobDetailsContent({ job, updating }: { job: ImportJobDetails; updating: boolean }) {
  const t = useTranslations("jobs");
  const progress = importProgress(job, t);
  const source = job.sourceFileName || t("sourceEpubUpload");
  const chapterRange =
    job.toNumber === 0
      ? t("preparing")
      : t("rangeChapters", { from: job.fromNumber, to: job.toNumber });
  const showReupload =
    job.kind === "epub" && (job.status === "error" || job.status === "cancelled");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={job.status as JobHistoryStatus} />
        <Badge variant="outline">{t("typeEpub")}</Badge>
        {updating ? (
          <span
            className="ml-auto inline-flex items-center gap-1.5 text-caption text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            <Spinner className="size-3.5" aria-hidden="true" />
            {t("importUpdating")}
          </span>
        ) : null}
      </div>
      <dl className="grid gap-3 rounded-lg border border-border bg-surface-inset p-4 sm:grid-cols-2">
        <Detail label={t("detailNovel")} value={job.novelTitle} />
        <Detail label={t("detailJobId")} value={job.id} mono />
        <Detail label={t("detailSource")} value={source} breakWords />
        <Detail label={t("detailChapterRange")} value={chapterRange} />
        <Detail label={t("columnStarted")} value={<DateCell value={job.createdAt} />} />
        <Detail label={t("columnUpdated")} value={<DateCell value={job.updatedAt} />} />
      </dl>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3 text-caption">
          <span className="font-medium text-foreground">{t("processing")}</span>
          <span className="tabular-nums text-muted-foreground">{progress.label}</span>
        </div>
        <Progress value={progress.percent} aria-label={t("processingAria")} />
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <Counter label={t("counterAdded")} value={job.added} />
        <Counter label={t("counterSkipped")} value={job.skipped} />
        <Counter label={t("counterFailed")} value={job.failed} />
      </div>
      {job.error ? (
        <div
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-caption text-destructive-text"
          role="alert"
        >
          <p className="font-semibold">{t("workerError")}</p>
          <JobErrorText message={job.error} className="mt-1 whitespace-pre-wrap break-words" />
        </div>
      ) : null}
      {showReupload ? (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-surface-inset p-3 text-caption text-muted-foreground">
          <Upload className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>{t("reuploadHint")}</p>
        </div>
      ) : null}
    </div>
  );
}

interface ImportDrawerBodyProps {
  job: ImportJobDetails | null | undefined;
  loading: boolean;
  updating: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
}

function ImportDrawerBody({
  job,
  loading,
  updating,
  isError,
  error,
  onRetry,
}: ImportDrawerBodyProps) {
  const t = useTranslations("jobs");
  if (loading) {
    return (
      <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-muted-foreground">
        <Spinner className="size-7" aria-hidden="true" />
        <p>{t("importLoading")}</p>
      </div>
    );
  }
  if (isError && !job) {
    return (
      <QueryErrorState
        title={t("importLoadFailed")}
        error={error}
        onRetry={onRetry}
        className="my-0"
      />
    );
  }
  if (!job) {
    return (
      <p className="flex min-h-48 items-center justify-center text-center text-body text-muted-foreground">
        {t("importNotFound")}
      </p>
    );
  }
  return <ImportJobDetailsContent job={job} updating={updating} />;
}

/**
 * One import run's detail, as a drawer — the same surface the translation log uses, so a
 * reader who opens either kind of run from the console meets one container rather than a
 * dialog for one and a panel for the other.
 */
export function ImportJobDrawer({ jobId, open, onOpenChange }: ImportJobDrawerProps) {
  const t = useTranslations("jobs");
  const isDesktop = useIsDesktop();
  const jobQuery = useQuery({
    queryKey: ["import-job-details", jobId],
    queryFn: () => getImportJobStatus({ data: { jobId: jobId! } }),
    enabled: open && jobId !== null,
    staleTime: 2_000,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "pending" || status === "running" ? 5_000 : false;
    },
    refetchIntervalInBackground: false,
  });

  if (!open || jobId === null) return null;

  const job = jobQuery.data;
  const isLoading = jobQuery.isPending && !job;

  return (
    <Drawer open={open} onOpenChange={onOpenChange} swipeDirection={isDesktop ? "right" : "down"}>
      <DrawerContent side={isDesktop ? "end" : "bottom"}>
        <DrawerHeader>
          <DrawerTitle>{t("importTitle")}</DrawerTitle>
          <DrawerDescription>{t("importDescription")}</DrawerDescription>
        </DrawerHeader>
        <DrawerBody>
          <div className="flex min-h-full flex-col gap-4">
            {jobQuery.isError && job ? (
              <QueryErrorState
                title={t("importRefreshFailed")}
                error={jobQuery.error}
                onRetry={() => void jobQuery.refetch()}
                variant="panel"
                className="my-0 min-h-0"
              />
            ) : null}

            <ImportDrawerBody
              job={job}
              loading={isLoading}
              updating={jobQuery.isFetching}
              isError={jobQuery.isError}
              error={jobQuery.error}
              onRetry={() => void jobQuery.refetch()}
            />
          </div>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}

function Detail({
  label,
  value,
  mono = false,
  breakWords = false,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  breakWords?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-micro font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd
        className={`mt-1 text-caption text-foreground ${mono ? "font-mono" : ""} ${breakWords ? "break-words" : "truncate"}`}
      >
        {value}
      </dd>
    </div>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  const locale = useLocale();
  return (
    <div className="rounded-lg border border-border bg-surface-inset px-2 py-3">
      <div className="font-semibold tabular-nums text-foreground">
        {formatNumber(value, locale)}
      </div>
      <div className="mt-1 text-micro text-muted-foreground">{label}</div>
    </div>
  );
}
