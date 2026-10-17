import { useMemo } from "react";
import { useLocale, useTranslations } from "use-intl";

import { ActivityBand } from "@/components/jobs/activity-band";
import { jobHistoryColumnCopy } from "@/components/jobs/job-history-columns";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatNumber } from "@/lib/i18n/format";
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
  const t = useTranslations("jobs");
  const locale = useLocale();
  const copy = useMemo(() => jobHistoryColumnCopy(t), [t]);
  const total = activeTranslationJobs + activeImportJobs;

  const progressLabel = (progress: JobHistoryProgress) =>
    progress.preparing
      ? copy.preparing
      : `${formatNumber(progress.completed, locale)} / ${formatNumber(progress.total, locale)}`;

  if (total === 0) return null;

  return (
    <ActivityBand
      ariaLabel={t("activeAria")}
      live
      label={t("activeLabel")}
      value={total}
      detail={t("activeDetail", {
        translation: activeTranslationJobs,
        import: activeImportJobs,
      })}
    >
      {jobs.length === 0 ? (
        <p className="pt-3 text-caption text-muted-foreground">{t("activeEmpty")}</p>
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
                  {copy.secondaryLine(job)} · {copy.type[job.type]}
                </p>
              </div>
              <div className="w-full sm:w-56">
                <Progress
                  value={job.progress.percent}
                  aria-label={copy.progressAria(job.progress.percent)}
                />
                <span className="mt-1 block text-caption tabular-nums text-muted-foreground">
                  {progressLabel(job.progress)}
                </span>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" variant="outline" onClick={() => onViewDetails(job)}>
                  {copy.menu.viewDetails}
                </Button>
                {job.canCancel ? (
                  <Button
                    size="sm"
                    variant="outlineDestructive"
                    disabled={pendingJobId === job.id}
                    onClick={() => onCancel(job)}
                  >
                    {pendingJobId === job.id ? copy.menu.working : copy.menu.cancelJob}
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
