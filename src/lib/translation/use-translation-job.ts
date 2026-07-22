import { useState, useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  startTranslationJob,
  startTranslationJobs,
  cancelTranslationJob,
  retryTranslationJob,
  listActiveTranslationJobs,
  getTranslationJobsTerminalStatus,
} from "./translation.functions";

export interface ActiveJobState {
  jobId: string;
  chapterId: string;
  status: "pending" | "running" | "done" | "error" | "cancelled";
  doneChunks: number;
  totalChunks: number;
  error?: string | null;
}

// This hook is a read-only observer: translation work is executed by Inngest
// (see src/lib/inngest/functions.ts), never by the browser — so page
// refreshes can no longer duplicate chunks or finalization.
// `enabled=false` (guests) skips all server calls — job endpoints are admin-only.
export function useTranslationJob(novelId: string, enabled = true) {
  const queryClient = useQueryClient();
  const [activeJobs, setActiveJobs] = useState<Map<string, ActiveJobState>>(new Map());

  const updateJob = useCallback((chapterId: string, state: ActiveJobState) => {
    setActiveJobs((prev) => {
      const next = new Map(prev);
      next.set(chapterId, state);
      return next;
    });
  }, []);

  const removeJob = useCallback((chapterId: string) => {
    setActiveJobs((prev) => {
      const next = new Map(prev);
      next.delete(chapterId);
      return next;
    });
  }, []);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["chapters", novelId] });
    queryClient.invalidateQueries({ queryKey: ["novels"] });
    queryClient.invalidateQueries({ queryKey: ["costs", novelId] });
  }, [novelId, queryClient]);

  // Rehydrate active jobs from DB on mount — shows jobs the worker is processing
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    listActiveTranslationJobs({ data: { novelId } })
      .then((jobs) => {
        if (cancelled || jobs.length === 0) return;
        setActiveJobs((prev) => {
          const next = new Map(prev);
          for (const j of jobs) {
            if (!next.has(j.chapterId)) {
              next.set(j.chapterId, {
                jobId: j.id,
                chapterId: j.chapterId,
                status: j.status as ActiveJobState["status"],
                doneChunks: j.doneChunks,
                totalChunks: j.totalChunks,
                error: j.error,
              });
            }
          }
          return next;
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [novelId, enabled]);

  // Poll status for active jobs using a single listActiveTranslationJobs call per interval
  useEffect(() => {
    const activeList = Array.from(activeJobs.values()).filter(
      (j) => j.status === "pending" || j.status === "running",
    );

    if (activeList.length === 0) return;

    const interval = setInterval(async () => {
      try {
        const dbJobs = await listActiveTranslationJobs({ data: { novelId } });
        const dbJobMap = new Map(dbJobs.map((j) => [j.chapterId, j]));

        // Collect jobs that disappeared from the active list
        const disappeared: { jobId: string; chapterId: string }[] = [];

        for (const localJob of activeList) {
          const dbJob = dbJobMap.get(localJob.chapterId);

          if (!dbJob) {
            disappeared.push({ jobId: localJob.jobId, chapterId: localJob.chapterId });
          } else {
            // Still active — update progress
            updateJob(localJob.chapterId, {
              jobId: dbJob.id,
              chapterId: dbJob.chapterId,
              status: dbJob.status as ActiveJobState["status"],
              doneChunks: dbJob.doneChunks,
              totalChunks: dbJob.totalChunks,
              error: dbJob.error,
            });
          }
        }

        // Batch fetch terminal statuses for disappeared jobs
        if (disappeared.length > 0) {
          let doneCount = 0;
          let errorCount = 0;
          let cancelledCount = 0;
          let unresolvedCount = 0;

          try {
            const terminal = await getTranslationJobsTerminalStatus({
              data: { jobIds: disappeared.map((d) => d.jobId) },
            });
            const terminalMap = new Map(terminal.map((t) => [t.id, t]));

            for (const d of disappeared) {
              const t = terminalMap.get(d.jobId);
              if (t?.status === "done") {
                doneCount++;
                removeJob(d.chapterId);
              } else if (t?.status === "error") {
                errorCount++;
                updateJob(d.chapterId, {
                  jobId: d.jobId,
                  chapterId: d.chapterId,
                  status: "error",
                  doneChunks: 0,
                  totalChunks: 1,
                  error: t.error,
                });
              } else if (t?.status === "cancelled") {
                cancelledCount++;
                removeJob(d.chapterId);
              } else {
                // Not found or unknown status — keep in state, retry next poll
                unresolvedCount++;
              }
            }
          } catch {
            // Batch fetch failed — keep all jobs, retry next poll
            unresolvedCount = disappeared.length;
          }

          // Only invalidate and toast when at least one job was resolved
          if (doneCount + errorCount + cancelledCount > 0) {
            invalidate();

            const parts: string[] = [];
            if (doneCount > 0) parts.push(`${doneCount} completed`);
            if (errorCount > 0) parts.push(`${errorCount} failed`);
            if (cancelledCount > 0) parts.push(`${cancelledCount} cancelled`);

            if (parts.length > 0) {
              if (errorCount > 0 && doneCount === 0 && cancelledCount === 0) {
                toast.error(`Translation: ${parts.join(", ")}`);
              } else if (doneCount > 0) {
                toast.success(`Translation: ${parts.join(", ")}`);
              } else {
                toast.info(`Translation: ${parts.join(", ")}`);
              }
            }
          }
        }
      } catch {
        // Transient read failure — next poll retries.
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [activeJobs, invalidate, removeJob, updateJob, novelId]);

  const start = useCallback(
    async (chapterId: string) => {
      try {
        const res = await startTranslationJob({ data: { chapterId } });
        updateJob(chapterId, {
          jobId: res.jobId,
          chapterId,
          status: "pending",
          doneChunks: 0,
          totalChunks: res.totalChunks,
        });
        toast.info("Translation queued");
        invalidate();
      } catch (err: any) {
        toast.error(err.message || "Failed to start translation");
      }
    },
    [invalidate, updateJob],
  );

  const startMany = useCallback(
    async (chapterIds: string[]) => {
      try {
        const res = await startTranslationJobs({ data: { novelId, chapterIds } });

        for (const q of res.queued) {
          updateJob(q.chapterId, {
            jobId: q.jobId,
            chapterId: q.chapterId,
            status: "pending",
            doneChunks: 0,
            totalChunks: q.totalChunks,
          });
        }

        if (res.queued.length > 0) {
          toast.info(`Queued ${res.queued.length} chapter${res.queued.length === 1 ? "" : "s"}`);
        }
        if (res.skipped.length > 0) {
          toast.warning(
            `Skipped ${res.skipped.length} chapter${res.skipped.length === 1 ? "" : "s"}`,
          );
        }

        invalidate();
        return res.queued.length;
      } catch (err: any) {
        toast.error(err.message || "Failed to queue translations");
        return 0;
      }
    },
    [novelId, invalidate, updateJob],
  );

  const cancel = useCallback(
    async (jobId: string, chapterId: string) => {
      try {
        await cancelTranslationJob({ data: { jobId } });
        removeJob(chapterId);
        toast.info("Translation cancelled");
        invalidate();
      } catch (err: any) {
        toast.error(err.message || "Failed to cancel translation");
      }
    },
    [invalidate, removeJob],
  );

  const retry = useCallback(
    async (jobId: string, chapterId: string) => {
      try {
        await retryTranslationJob({ data: { jobId } });
        setActiveJobs((prev) => {
          const next = new Map(prev);
          const existing = next.get(chapterId);
          next.set(chapterId, {
            jobId,
            chapterId,
            status: "pending",
            doneChunks: existing?.doneChunks || 0,
            totalChunks: existing?.totalChunks || 1,
          });
          return next;
        });
        toast.info("Translation requeued");
        invalidate();
      } catch (err: any) {
        toast.error(err.message || "Failed to retry translation");
      }
    },
    [invalidate],
  );

  return {
    start,
    startMany,
    cancel,
    retry,
    activeJobs,
  };
}
