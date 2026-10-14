import { ActivityBand } from "@/components/jobs/activity-band";
import { jobSecondaryLine, typeLabels } from "@/components/jobs/job-history-columns";
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
  const total = failedTranslationJobs + failedImportJobs;
  if (total === 0) return null;

  return (
    <ActivityBand
      ariaLabel="Jobs needing attention"
      label="Needs attention"
      value={total}
      detail={
        <>
          Translation {failedTranslationJobs} · Import {failedImportJobs}
        </>
      }
    >
      {jobs.length === 0 ? (
        <p className="pt-3 text-caption text-muted-foreground">
          No failed job appears on this page.
        </p>
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
                  {jobSecondaryLine(job)} · {typeLabels[job.type]}
                </p>
                {job.error ? (
                  <p
                    className="mt-1 line-clamp-2 text-caption text-destructive-text"
                    title={job.error}
                  >
                    {job.error}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" variant="outline" onClick={() => onViewDetails(job)}>
                  Details
                </Button>
                {job.canRetry ? (
                  <Button size="sm" disabled={pendingJobId === job.id} onClick={() => onRetry(job)}>
                    {pendingJobId === job.id ? "Working…" : "Retry job"}
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
