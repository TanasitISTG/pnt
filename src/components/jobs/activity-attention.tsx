import { useMemo } from "react";
import { useTranslations } from "use-intl";

import { ActivityBand } from "@/components/jobs/activity-band";
import { JobErrorText } from "@/components/jobs/job-error-text";
import { jobHistoryColumnCopy } from "@/components/jobs/job-history-columns";
import { Button } from "@/components/ui/button";
import type { JobHistoryRow } from "@/lib/job-dashboard/contracts";

export interface ActivityAttentionProps {
  /** The page's own failed rows, newest first. */
  jobs: JobHistoryRow[];
  /** Global counts, which can exceed what this page holds. */
  failedTranslationJobs: number;
  failedImportJobs: number;
  pendingJobId: string | null;
  onRetry: (job: JobHistoryRow) => void;
  onViewDetails: (job: JobHistoryRow) => void;
  onOpenNovel: (novelId: string) => void;
}

/**
 * What went wrong, and the one action that answers it.
 *
 * A failure is the reason a reader opens this page, so it leads — with the worker's own
 * message rather than a status word, because "Failed" does not say whether to retry or
 * to fix the source. Retry appears only where the row's own rules allow it: a failed
 * EPUB import cannot be retried from here, and offering the button would be a dead end.
 */
export function ActivityAttention({
  jobs,
  failedTranslationJobs,
  failedImportJobs,
  pendingJobId,
  onRetry,
  onViewDetails,
  onOpenNovel,
}: ActivityAttentionProps) {
  const t = useTranslations("jobs");
  const copy = useMemo(() => jobHistoryColumnCopy(t), [t]);
  const total = failedTranslationJobs + failedImportJobs;
  if (total === 0) return null;

  return (
    <ActivityBand
      ariaLabel={t("attentionAria")}
      label={t("attentionLabel")}
      value={total}
      detail={t("attentionDetail", {
        translation: failedTranslationJobs,
        import: failedImportJobs,
      })}
    >
      {jobs.length === 0 ? (
        <p className="pt-3 text-caption text-muted-foreground">{t("attentionEmpty")}</p>
      ) : (
        <ul className="divide-y divide-border">
          {jobs.map((job) => (
            <li key={job.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 py-3">
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  className="block max-w-full truncate text-left font-medium text-foreground underline-offset-4 hover:underline"
                  onClick={() => onOpenNovel(job.novelId)}
                  title={job.novelTitle}
                >
                  {job.novelTitle}
                </button>
                <p className="mt-0.5 truncate text-caption text-muted-foreground">
                  {copy.secondaryLine(job)} · {copy.type[job.type]}
                </p>
                {/* The stored error is a message code, so it is resolved here like anywhere
                    else the same column is read, rather than printed as the code. */}
                {job.error ? (
                  <JobErrorText message={job.error} className="mt-1 line-clamp-2" />
                ) : null}
              </div>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" variant="outline" onClick={() => onViewDetails(job)}>
                  {copy.details}
                </Button>
                {job.canRetry ? (
                  <Button size="sm" disabled={pendingJobId === job.id} onClick={() => onRetry(job)}>
                    {pendingJobId === job.id ? copy.menu.working : copy.menu.retryJob}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </ActivityBand>
  );
}
