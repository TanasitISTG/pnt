import { useState, useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  startTranslationJob,
  cancelTranslationJob,
  retryTranslationJob,
  listActiveTranslationJobs,
  getTranslationJobStatus,
} from "./translation.functions";

export interface ActiveJobState {
  jobId: string;
  chapterId: string;
  status: "pending" | "running" | "done" | "error" | "cancelled";
  doneChunks: number;
  totalChunks: number;
  error?: string | null;
}

// This hook is a read-only observer: translation work is executed by the cron
// worker (see /api/cron/translation-worker), never by the browser — so page
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

  // Poll status for active jobs (read-only, idempotent)
  useEffect(() => {
    const activeList = Array.from(activeJobs.values()).filter(
      (j) => j.status === "pending" || j.status === "running",
    );

    if (activeList.length === 0) return;

    const interval = setInterval(async () => {
      for (const j of activeList) {
        try {
          const res = await getTranslationJobStatus({ data: { jobId: j.jobId } });
          if (!res) {
            removeJob(j.chapterId);
            continue;
          }

          if (res.status === "done") {
            toast.success("Translation completed successfully!");
            invalidate();
            removeJob(j.chapterId);
          } else if (res.status === "error") {
            toast.error(`Translation failed: ${res.error || "Unknown error"}`);
            invalidate();
            updateJob(j.chapterId, {
              jobId: j.jobId,
              chapterId: j.chapterId,
              status: "error",
              doneChunks: res.doneChunks,
              totalChunks: res.totalChunks,
              error: res.error,
            });
          } else if (res.status === "cancelled") {
            toast.info("Translation job cancelled");
            invalidate();
            removeJob(j.chapterId);
          } else {
            updateJob(j.chapterId, {
              jobId: j.jobId,
              chapterId: j.chapterId,
              status: res.status as ActiveJobState["status"],
              doneChunks: res.doneChunks,
              totalChunks: res.totalChunks,
              error: res.error,
            });
          }
        } catch {
          // Transient read failure — next poll retries.
        }
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [activeJobs, invalidate, removeJob, updateJob]);

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
      let queued = 0;
      let failed = 0;
      for (const chapterId of chapterIds) {
        try {
          const res = await startTranslationJob({ data: { chapterId } });
          updateJob(chapterId, {
            jobId: res.jobId,
            chapterId,
            status: "pending",
            doneChunks: 0,
            totalChunks: res.totalChunks,
          });
          queued++;
        } catch {
          failed++;
        }
      }
      if (queued > 0) toast.info(`Queued ${queued} chapter${queued === 1 ? "" : "s"}`);
      if (failed > 0) toast.error(`Failed to queue ${failed} chapter${failed === 1 ? "" : "s"}`);
      invalidate();
      return queued;
    },
    [invalidate, updateJob],
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
