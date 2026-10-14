import { ActivityBand } from "@/components/jobs/activity-band";
import { jobSecondaryLine, typeLabels } from "@/components/jobs/job-history-columns";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { JobHistoryProgress, JobHistoryRow } from "@/lib/job-dashboard/contracts";

export interface ActivityLiveRunsProps {
  /** The page's own running or pending rows, newest first. */
  jobs: JobHistoryRow[];
  /** Global counts, which can exceed what this page holds. */
  activeTranslationJobs: number;
  activeImportJobs: number;
  pendingJobId: string | null;
  onCancel: (job: JobHistoryRow) => void;
  onViewDetails: (job: JobHistoryRow) => void;
  onOpenNovel: (novelId: string) => void;
}

function progressLabel(progress: JobHistoryProgress): string {
  return progress.preparing
    ? "Preparing…"
    : `${progress.completed.toLocaleString()} / ${progress.total.toLocaleString()}`;
}

/**
 * What is running right now, with the two things a reader does about it: look at it, or
 * stop it. The band is absent when nothing is running anywhere — "0 active" is not
 * content, and a page that always reserves a row for it pushes the history down for no
 * reason. When work exists but none of it is on this page, the count still stands so the
 * reader knows the console is not idle.
 */
export function ActivityLiveRuns({
  jobs,
  activeTranslationJobs,
  activeImportJobs,
  pendingJobId,
  onCancel,
  onViewDetails,
  onOpenNovel,
}: ActivityLiveRunsProps) {
  const total = activeTranslationJobs + activeImportJobs;
  if (total === 0) return null;

  return (
    <ActivityBand
      ariaLabel="Running jobs"
      live
      label="Active jobs"
      value={total}
      detail={
        <>
          Translation {activeTranslationJobs} · Import {activeImportJobs}
        </>
      }
    >
      {jobs.length === 0 ? (
        <p className="pt-3 text-caption text-muted-foreground">
          No running job appears on this page.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {jobs.map((job) => (
            <li key={job.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
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
              </div>
              <div className="w-full sm:w-56">
                <Progress
                  value={job.progress.percent}
                  aria-label={`${job.progress.percent}% complete`}
                />
                <span className="mt-1 block text-caption tabular-nums text-muted-foreground">
                  {progressLabel(job.progress)}
                </span>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" variant="outline" onClick={() => onViewDetails(job)}>
                  Details
                </Button>
                {job.canCancel ? (
                  <Button
                    size="sm"
                    variant="outlineDestructive"
                    disabled={pendingJobId === job.id}
                    onClick={() => onCancel(job)}
                  >
                    {pendingJobId === job.id ? "Working…" : "Cancel job"}
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
