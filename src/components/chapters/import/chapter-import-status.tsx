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
  if (!job && !statusError) return null;

  const total = job ? (job.kind === "epub" ? job.toNumber : job.toNumber - job.fromNumber + 1) : 0;
  const processed = job ? job.added + job.skipped + job.failed : 0;
  const percent = total > 0 ? Math.min(100, Math.max(0, (processed / total) * 100)) : 0;
  const progressText =
    !job || job.toNumber === 0
      ? "Preparing…"
      : `${Math.min(processed, total)} of ${total} chapters`;

  return (
    <div className="flex flex-col gap-4 border-t border-border pt-5">
      {job ? (
        <p className="sr-only" role="status">
          {label}: {job.status}. {progressText}.
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
        <Progress value={percent} aria-label={`${label} progress`} className="gap-2">
          <div className="flex w-full items-center gap-3 text-sm text-muted-foreground">
            <ProgressLabel>{active ? "Running on the server" : "Import progress"}</ProgressLabel>
            <ProgressValue>{() => `${Math.round(percent)}%`}</ProgressValue>
          </div>
        </Progress>
      ) : null}

      {job ? (
        <dl className="grid grid-cols-3 gap-3 text-sm">
          <div className="flex flex-col gap-1">
            <dt className="text-muted-foreground">Added</dt>
            <dd className="tabular-nums text-foreground">{job.added}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-muted-foreground">Skipped</dt>
            <dd className="tabular-nums text-foreground">{job.skipped}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-muted-foreground">Failed</dt>
            <dd className="tabular-nums text-foreground">{job.failed}</dd>
          </div>
        </dl>
      ) : null}

      {job?.error ? <p className="text-sm text-destructive">{job.error}</p> : null}

      {statusError ? (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          role="alert"
        >
          <span>{statusError.message}</span>
          <Button type="button" size="sm" variant="outline" onClick={() => void onRetryStatus()}>
            Retry status
          </Button>
        </div>
      ) : null}
    </div>
  );
}
