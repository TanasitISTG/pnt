import { useState, useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  startTranslationJob,
  tickTranslationJob,
  cancelTranslationJob,
  retryTranslationJob,
} from "./translation.functions";

export interface ActiveJobState {
  jobId: string;
  chapterId: string;
  status: "pending" | "running" | "done" | "error" | "cancelled";
  doneChunks: number;
  totalChunks: number;
  error?: string | null;
}

export function useTranslationJob(novelId: string) {
  const queryClient = useQueryClient();
  const [activeJobs, setActiveJobs] = useState<Map<string, ActiveJobState>>(new Map());
  const activeJobsRef = useRef(activeJobs);
  activeJobsRef.current = activeJobs;

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

  const runTick = useCallback(
    async (jobId: string, chapterId: string) => {
      try {
        const res = await tickTranslationJob({ data: { jobId } });
        updateJob(chapterId, {
          jobId,
          chapterId,
          status: res.status as any,
          doneChunks: res.doneChunks,
          totalChunks: res.totalChunks,
          error: res.error,
        });

        if (res.status === "done") {
          toast.success("Translation completed successfully!");
          queryClient.invalidateQueries({ queryKey: ["chapters", novelId] });
          queryClient.invalidateQueries({ queryKey: ["novels"] });
          removeJob(chapterId);
        } else if (res.status === "error") {
          toast.error(`Translation failed: ${res.error || "Unknown error"}`);
          queryClient.invalidateQueries({ queryKey: ["chapters", novelId] });
          queryClient.invalidateQueries({ queryKey: ["novels"] });
        } else if (res.status === "cancelled") {
          toast.info("Translation job cancelled");
          queryClient.invalidateQueries({ queryKey: ["chapters", novelId] });
          removeJob(chapterId);
        }
      } catch (err: any) {
        toast.error(err.message || "Failed to tick translation job");
        updateJob(chapterId, {
          jobId,
          chapterId,
          status: "error",
          doneChunks: activeJobsRef.current.get(chapterId)?.doneChunks || 0,
          totalChunks: activeJobsRef.current.get(chapterId)?.totalChunks || 1,
          error: err.message,
        });
      }
    },
    [novelId, queryClient, removeJob, updateJob],
  );

  // Polling loop effect for active running/pending jobs
  useEffect(() => {
    const activeList = Array.from(activeJobs.values()).filter(
      (j) => j.status === "pending" || j.status === "running",
    );

    if (activeList.length === 0) return;

    const interval = setInterval(() => {
      activeList.forEach((j) => {
        runTick(j.jobId, j.chapterId);
      });
    }, 2000);

    return () => clearInterval(interval);
  }, [activeJobs, runTick]);

  const start = useCallback(
    async (chapterId: string) => {
      try {
        const res = await startTranslationJob({ data: { chapterId } });
        const initialState: ActiveJobState = {
          jobId: res.jobId,
          chapterId,
          status: "pending",
          doneChunks: 0,
          totalChunks: res.totalChunks,
        };
        updateJob(chapterId, initialState);
        toast.info("Translation started");
        queryClient.invalidateQueries({ queryKey: ["chapters", novelId] });

        // Trigger immediate first tick
        runTick(res.jobId, chapterId);
      } catch (err: any) {
        toast.error(err.message || "Failed to start translation");
      }
    },
    [novelId, queryClient, runTick, updateJob],
  );

  const cancel = useCallback(
    async (jobId: string, chapterId: string) => {
      try {
        await cancelTranslationJob({ data: { jobId } });
        removeJob(chapterId);
        toast.info("Translation cancelled");
        queryClient.invalidateQueries({ queryKey: ["chapters", novelId] });
      } catch (err: any) {
        toast.error(err.message || "Failed to cancel translation");
      }
    },
    [novelId, queryClient, removeJob],
  );

  const retry = useCallback(
    async (jobId: string, chapterId: string) => {
      try {
        await retryTranslationJob({ data: { jobId } });
        const existing = activeJobsRef.current.get(chapterId);
        updateJob(chapterId, {
          jobId,
          chapterId,
          status: "pending",
          doneChunks: existing?.doneChunks || 0,
          totalChunks: existing?.totalChunks || 1,
        });
        toast.info("Retrying translation");
        queryClient.invalidateQueries({ queryKey: ["chapters", novelId] });

        // Trigger immediate first tick
        runTick(jobId, chapterId);
      } catch (err: any) {
        toast.error(err.message || "Failed to retry translation");
      }
    },
    [novelId, queryClient, runTick, updateJob],
  );

  return {
    start,
    cancel,
    retry,
    activeJobs,
  };
}
