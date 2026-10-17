import { useTranslations } from "use-intl";

import { Button } from "@/components/ui/button";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import { StatusBadge } from "@/components/jobs/status-badge";
import type { ImportJobState } from "@/components/chapters/import/use-import-job";

interface ChapterImportStatusProps {
  label: string;
  job: ImportJobState | null;
  active: boolean;
  statusError: Error | null;
  onRetryStatus: () => void | Promise<void>;
}

export function ChapterImportStatus({
  label,
  job,
  active,
  statusError,
  onRetryStatus,
}: ChapterImportStatusProps) {
  const t = useTranslations("studio");
  if (!job && !statusError) return null;

  const total = job ? (job.kind === "epub" ? job.toNumber : job.toNumber - job.fromNumber + 1) : 0;
  const processed = job ? job.added + job.skipped + job.failed : 0;
  const percent = total > 0 ? Math.min(100, Math.max(0, (processed / total) * 100)) : 0;
  const progressText =
    !job || job.toNumber === 0
      ? t("importPreparing")
      : t("importProgress", { processed: Math.min(processed, total), total });

  return (
    <div className="flex flex-col gap-4 border-t border-border pt-5">
      {job ? (
        <p className="sr-only" role="status">
          {t("importStatusLine", { label, status: job.status, progress: progressText })}
        </p>
      ) : null}
      {job ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="truncate text-sm font-semibold text-foreground">{label}</span>
            <StatusBadge status={job.status} />
            {job.sourceFileName ? (
              <span className="truncate text-sm text-muted-foreground" title={job.sourceFileName}>
                {job.sourceFileName}
              </span>
            ) : null}
          </div>
          <span className="text-sm tabular-nums text-muted-foreground">{progressText}</span>
        </div>
      ) : null}

      {job ? (
        <Progress
          value={percent}
          aria-label={t("importProgressLabel", { label })}
          className="gap-2"
        >
          <div className="flex w-full items-center gap-3 text-sm text-muted-foreground">
            <ProgressLabel>
              {active ? t("importRunningOnServer") : t("importProgressTitle")}
            </ProgressLabel>
            <ProgressValue>{() => `${Math.round(percent)}%`}</ProgressValue>
          </div>
        </Progress>
      ) : null}

      {job ? (
        <dl className="grid grid-cols-3 gap-3 text-sm">
          <div className="flex flex-col gap-1">
            <dt className="text-muted-foreground">{t("importStatAdded")}</dt>
            <dd className="tabular-nums text-foreground">{job.added}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-muted-foreground">{t("importStatSkipped")}</dt>
            <dd className="tabular-nums text-foreground">{job.skipped}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-muted-foreground">{t("importStatFailed")}</dt>
            <dd className="tabular-nums text-foreground">{job.failed}</dd>
          </div>
        </dl>
      ) : null}

      {job?.error ? <p className="text-sm text-destructive-text">{job.error}</p> : null}

      {statusError ? (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive-text"
          role="alert"
        >
          <span>{statusError.message}</span>
          <Button type="button" size="sm" variant="outline" onClick={() => void onRetryStatus()}>
            {t("retryStatus")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
