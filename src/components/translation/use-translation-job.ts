import { useState, useCallback, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  startTranslationJob,
  startTranslationJobs,
  cancelTranslationJob,
  cancelTranslationJobs,
  retryTranslationJob,
} from "@/lib/translation/api/mutations";
import {
  listActiveTranslationJobs,
  getTranslationJobsTerminalStatus,
} from "@/lib/translation/api/queries";
import type { ActiveJobState } from "@/lib/translation/types/api";
import type { TranslationStartMode } from "@/lib/translation/api/schemas";

type ActiveTranslationJobList = Array<{
  id: string;
  chapterId: string;
  status: ActiveJobState["status"];
  doneChunks: number;
  totalChunks: number;
  error: string | null;
}>;

type JobAuthority = {
  jobId: string;
  phase: "active" | "terminal";
  staleJobIds: Set<string>;
  suppressTerminalToast: boolean;
  state?: ActiveJobState;
};

// This hook is a read-only observer: translation work is executed by Inngest
// (see src/lib/inngest/functions.ts), never by the browser — so page
// refreshes can no longer duplicate chunks or finalization.
// `enabled=false` (guests) skips all server calls — job endpoints are admin-only.
// Mutation responses are authoritative for the chapter they changed.  The
// query can still deliver a response that was started before the mutation,
// so retain the superseded ids as tombstones until a different job is
// observed.
export function useTranslationJob(novelId: string, enabled = true) {
  const queryClient = useQueryClient();
  const [activeJobs, setActiveJobs] = useState<Map<string, ActiveJobState>>(new Map());
  const mutationCounterRef = useRef(0);
  const mutationVersionsRef = useRef(new Map<string, number>());
  const jobAuthorityRef = useRef(new Map<string, JobAuthority>());
  const previousActiveJobsRef = useRef(new Map<string, { jobId: string; chapterId: string }>());
  const terminalChecksRef = useRef(new Set<string>());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const beginMutation = useCallback((chapterIds: readonly string[]) => {
    const version = ++mutationCounterRef.current;
    for (const chapterId of new Set(chapterIds)) {
      mutationVersionsRef.current.set(chapterId, version);
    }
    return version;
  }, []);

  const ownsMutation = useCallback(
    (chapterId: string, version: number) => mutationVersionsRef.current.get(chapterId) === version,
    [],
  );

  const writeActiveJobsCache = useCallback(
    (updates: readonly ActiveJobState[], removedJobIds: readonly string[] = []) => {
      const queryKey = ["translationJobs", novelId] as const;
      queryClient.setQueryData<ActiveTranslationJobList>(queryKey, (current) => {
        if (!current) return current;
        const updatedChapterIds = new Set(updates.map((job) => job.chapterId));
        const removedIds = new Set(removedJobIds);
        return [
          ...updates.map((job) => ({
            id: job.jobId,
            chapterId: job.chapterId,
            status: job.status,
            doneChunks: job.doneChunks,
            totalChunks: job.totalChunks,
            error: job.error ?? null,
          })),
          ...current.filter(
            (job) => !updatedChapterIds.has(job.chapterId) && !removedIds.has(job.id),
          ),
        ];
      });
    },
    [novelId, queryClient],
  );

  const reconcileActiveJobsCache = useCallback(
    async (
      updates: readonly ActiveJobState[],
      removedJobIds: readonly string[] = [],
      shouldApply: () => boolean = () => true,
    ) => {
      const queryKey = ["translationJobs", novelId] as const;
      await queryClient.cancelQueries({ queryKey, exact: true });
      if (!shouldApply()) return;
      writeActiveJobsCache(updates, removedJobIds);
    },
    [novelId, queryClient, writeActiveJobsCache],
  );

  const rememberActiveJob = useCallback((job: ActiveJobState, version: number) => {
    if (mutationVersionsRef.current.get(job.chapterId) !== version) return false;

    const authority = jobAuthorityRef.current.get(job.chapterId);
    const staleJobIds = new Set(authority?.staleJobIds ?? []);
    if (authority && authority.jobId !== job.jobId) staleJobIds.add(authority.jobId);
    const previous = previousActiveJobsRef.current.get(job.chapterId);
    if (previous && previous.jobId !== job.jobId) staleJobIds.add(previous.jobId);
    jobAuthorityRef.current.set(job.chapterId, {
      jobId: job.jobId,
      phase: "active",
      staleJobIds,
      suppressTerminalToast: false,
      state: job,
    });
    previousActiveJobsRef.current.set(job.chapterId, {
      jobId: job.jobId,
      chapterId: job.chapterId,
    });
    return true;
  }, []);

  const rememberTerminalJob = useCallback(
    (chapterId: string, jobId: string, suppressTerminalToast: boolean) => {
      const authority = jobAuthorityRef.current.get(chapterId);
      const staleJobIds = new Set(authority?.staleJobIds ?? []);
      if (authority && authority.jobId !== jobId) staleJobIds.add(authority.jobId);
      jobAuthorityRef.current.set(chapterId, {
        jobId,
        phase: "terminal",
        staleJobIds,
        suppressTerminalToast,
      });
      if (previousActiveJobsRef.current.get(chapterId)?.jobId === jobId) {
        previousActiveJobsRef.current.delete(chapterId);
      }
    },
    [],
  );

  const acceptObservedJob = useCallback((chapterId: string, jobId: string) => {
    const authority = jobAuthorityRef.current.get(chapterId);
    if (!authority) return true;
    if (authority.staleJobIds.has(jobId)) return false;
    if (authority.phase === "terminal" && authority.jobId === jobId) return false;
    if (authority.jobId !== jobId) {
      authority.staleJobIds.add(authority.jobId);
      authority.jobId = jobId;
      authority.phase = "active";
      authority.suppressTerminalToast = false;
    }
    return true;
  }, []);

  const updateJob = useCallback((chapterId: string, state: ActiveJobState) => {
    setActiveJobs((prev) => {
      const existing = prev.get(chapterId);
      if (
        existing &&
        existing.jobId === state.jobId &&
        existing.status === state.status &&
        existing.doneChunks === state.doneChunks &&
        existing.totalChunks === state.totalChunks &&
        (existing.error ?? null) === (state.error ?? null)
      ) {
        return prev;
      }
      const next = new Map(prev);
      next.set(chapterId, state);
      return next;
    });
  }, []);

  const removeJobIfMatches = useCallback((chapterId: string, jobId: string) => {
    setActiveJobs((prev) => {
      if (prev.get(chapterId)?.jobId !== jobId) return prev;
      const next = new Map(prev);
      next.delete(chapterId);
      return next;
    });
  }, []);

  const clearActiveJobs = useCallback(() => {
    setActiveJobs(new Map());
  }, []);

  const invalidateJobProgress = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["chapters", novelId] });
    queryClient.invalidateQueries({ queryKey: ["adminNovelDetailMetrics", novelId] });
  }, [novelId, queryClient]);

  const invalidateJobOutcome = useCallback(() => {
    invalidateJobProgress();
    queryClient.invalidateQueries({ queryKey: ["readerChapterManifest", novelId] });
    queryClient.invalidateQueries({ queryKey: ["relationshipMap", novelId] });
    queryClient.invalidateQueries({ queryKey: ["novels"] });
  }, [invalidateJobProgress, novelId, queryClient]);

  const hasActiveJobs = Array.from(activeJobs.values()).some(
    (job) => job.status === "pending" || job.status === "running",
  );
  const activeJobsQuery = useQuery({
    queryKey: ["translationJobs", novelId],
    queryFn: () => listActiveTranslationJobs({ data: { novelId } }),
    enabled,
    staleTime: 1_000,
    refetchInterval: hasActiveJobs ? 3_000 : false,
    refetchIntervalInBackground: false,
  });
  useEffect(() => {
    const dbJobs = activeJobsQuery.data;
    if (!enabled || !dbJobs) return;
    let cancelled = false;

    const acceptedJobs = dbJobs.filter((job) => acceptObservedJob(job.chapterId, job.id));
    const acceptedJobIds = new Set(acceptedJobs.map((job) => job.id));
    const ignoredJobIds = dbJobs.filter((job) => !acceptedJobIds.has(job.id)).map((job) => job.id);
    const staleChapterIds = new Set(
      dbJobs.filter((job) => !acceptedJobIds.has(job.id)).map((job) => job.chapterId),
    );
    if (ignoredJobIds.length > 0) {
      const expectedJobs = [...jobAuthorityRef.current.entries()].flatMap(
        ([chapterId, authority]) => {
          if (authority.phase !== "active") return [];
          const local = activeJobs.get(chapterId);
          if (local?.jobId === authority.jobId) return [local];
          return authority.state ? [authority.state] : [];
        },
      );
      writeActiveJobsCache(expectedJobs, ignoredJobIds);
    }

    const acceptedJobMap = new Map(acceptedJobs.map((job) => [job.chapterId, job]));
    const trackedJobs = new Map(previousActiveJobsRef.current);
    for (const [chapterId, authority] of jobAuthorityRef.current) {
      if (authority.phase === "terminal") {
        if (trackedJobs.get(chapterId)?.jobId === authority.jobId) {
          trackedJobs.delete(chapterId);
        }
        continue;
      }
      trackedJobs.set(chapterId, { jobId: authority.jobId, chapterId });
    }
    for (const job of activeJobs.values()) {
      if (job.status !== "pending" && job.status !== "running") continue;
      const authority = jobAuthorityRef.current.get(job.chapterId);
      if (authority?.phase === "terminal") continue;
      trackedJobs.set(job.chapterId, {
        jobId: authority?.phase === "active" ? authority.jobId : job.jobId,
        chapterId: job.chapterId,
      });
    }
    const disappeared = [...trackedJobs.values()].filter(
      (job) =>
        !staleChapterIds.has(job.chapterId) && acceptedJobMap.get(job.chapterId)?.id !== job.jobId,
    );
    const replacedJobIds = new Set(
      disappeared
        .filter((job) => {
          const replacement = acceptedJobMap.get(job.chapterId);
          return replacement !== undefined && replacement.id !== job.jobId;
        })
        .map((job) => job.jobId),
    );
    const nextPrevious = new Map<string, { jobId: string; chapterId: string }>(
      acceptedJobs.map((job) => [job.chapterId, { jobId: job.id, chapterId: job.chapterId }]),
    );
    for (const job of trackedJobs.values()) {
      if (acceptedJobMap.has(job.chapterId)) continue;
      if (jobAuthorityRef.current.get(job.chapterId)?.phase === "terminal") continue;
      nextPrevious.set(job.chapterId, job);
    }
    previousActiveJobsRef.current = nextPrevious;

    for (const job of acceptedJobs) {
      updateJob(job.chapterId, {
        jobId: job.id,
        chapterId: job.chapterId,
        status: job.status as ActiveJobState["status"],
        doneChunks: job.doneChunks,
        totalChunks: job.totalChunks,
        error: job.error,
      });
    }

    const jobsToCheck = disappeared.filter((job) => !terminalChecksRef.current.has(job.jobId));
    if (jobsToCheck.length === 0) return;
    for (const job of jobsToCheck) terminalChecksRef.current.add(job.jobId);
    const lookupMutationVersions = new Map(
      jobsToCheck.map((job) => [job.chapterId, mutationVersionsRef.current.get(job.chapterId)]),
    );

    void (async () => {
      let doneCount = 0;
      let errorCount = 0;
      let cancelledCount = 0;
      let removedCount = 0;
      const unresolved: typeof jobsToCheck = [];
      const resolvedJobIds: string[] = [];

      const forgetTrackedJob = (job: (typeof jobsToCheck)[number]) => {
        if (previousActiveJobsRef.current.get(job.chapterId)?.jobId === job.jobId) {
          previousActiveJobsRef.current.delete(job.chapterId);
        }
      };

      try {
        const terminal = await getTranslationJobsTerminalStatus({
          data: { jobIds: jobsToCheck.map((job) => job.jobId) },
        });
        if (cancelled || !mountedRef.current) return;
        const terminalMap = new Map(terminal.map((job) => [job.id, job]));

        if (!cancelled && mountedRef.current) {
          for (const disappearedJob of jobsToCheck) {
            if (
              replacedJobIds.has(disappearedJob.jobId) ||
              mutationVersionsRef.current.get(disappearedJob.chapterId) !==
                lookupMutationVersions.get(disappearedJob.chapterId)
            ) {
              forgetTrackedJob(disappearedJob);
              continue;
            }

            const authority = jobAuthorityRef.current.get(disappearedJob.chapterId);
            if (
              authority &&
              (authority.jobId !== disappearedJob.jobId ||
                (authority.phase === "terminal" && authority.jobId === disappearedJob.jobId))
            ) {
              forgetTrackedJob(disappearedJob);
              continue;
            }
            if (
              previousActiveJobsRef.current.get(disappearedJob.chapterId)?.jobId &&
              previousActiveJobsRef.current.get(disappearedJob.chapterId)?.jobId !==
                disappearedJob.jobId
            ) {
              continue;
            }
            const terminalJob = terminalMap.get(disappearedJob.jobId);
            if (terminalJob?.status === "done") {
              rememberTerminalJob(disappearedJob.chapterId, disappearedJob.jobId, false);
              forgetTrackedJob(disappearedJob);
              doneCount++;
              resolvedJobIds.push(disappearedJob.jobId);
              removeJobIfMatches(disappearedJob.chapterId, disappearedJob.jobId);
            } else if (terminalJob?.status === "error") {
              rememberTerminalJob(disappearedJob.chapterId, disappearedJob.jobId, false);
              forgetTrackedJob(disappearedJob);
              errorCount++;
              resolvedJobIds.push(disappearedJob.jobId);
              setActiveJobs((prev) => {
                if (prev.get(disappearedJob.chapterId)?.jobId !== disappearedJob.jobId) {
                  return prev;
                }
                const next = new Map(prev);
                next.set(disappearedJob.chapterId, {
                  jobId: disappearedJob.jobId,
                  chapterId: disappearedJob.chapterId,
                  status: "error",
                  doneChunks: 0,
                  totalChunks: 1,
                  error: terminalJob.error,
                });
                return next;
              });
            } else if (terminalJob?.status === "cancelled") {
              rememberTerminalJob(disappearedJob.chapterId, disappearedJob.jobId, true);
              forgetTrackedJob(disappearedJob);
              resolvedJobIds.push(disappearedJob.jobId);
              if (!authority?.suppressTerminalToast) cancelledCount++;
              removeJobIfMatches(disappearedJob.chapterId, disappearedJob.jobId);
            } else if (!terminalJob) {
              // The owned job row was removed with its chapter. A successful
              // terminal lookup proves this is not a transient polling failure.
              rememberTerminalJob(disappearedJob.chapterId, disappearedJob.jobId, true);
              forgetTrackedJob(disappearedJob);
              resolvedJobIds.push(disappearedJob.jobId);
              removedCount++;
              removeJobIfMatches(disappearedJob.chapterId, disappearedJob.jobId);
            } else {
              unresolved.push(disappearedJob);
            }
          }
        }
      } catch {
        unresolved.push(...jobsToCheck);
      } finally {
        for (const job of jobsToCheck) terminalChecksRef.current.delete(job.jobId);
      }

      if (cancelled || !mountedRef.current) return;
      for (const job of unresolved) {
        const authority = jobAuthorityRef.current.get(job.chapterId);
        if (authority?.jobId === job.jobId && authority.phase === "terminal") continue;
        previousActiveJobsRef.current.set(job.chapterId, job);
      }

      const terminalCount = doneCount + errorCount + cancelledCount;
      if (terminalCount + removedCount === 0) return;
      if (resolvedJobIds.length > 0) {
        writeActiveJobsCache([], resolvedJobIds);
      }
      if (unresolved.length === 0 && acceptedJobs.length === 0) {
        invalidateJobOutcome();
      } else {
        invalidateJobProgress();
      }
      if (terminalCount === 0) return;

      const parts: string[] = [];
      if (doneCount > 0) parts.push(`${doneCount} completed`);
      if (errorCount > 0) parts.push(`${errorCount} failed`);
      if (cancelledCount > 0) parts.push(`${cancelledCount} cancelled`);
      if (errorCount > 0 && doneCount === 0 && cancelledCount === 0) {
        toast.error(`Translation: ${parts.join(", ")}`);
      } else if (doneCount > 0) {
        toast.success(`Translation: ${parts.join(", ")}`);
      } else {
        toast.info(`Translation: ${parts.join(", ")}`);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    activeJobs,
    acceptObservedJob,
    activeJobsQuery.data,
    activeJobsQuery.dataUpdatedAt,
    enabled,
    invalidateJobOutcome,
    invalidateJobProgress,
    rememberTerminalJob,
    removeJobIfMatches,
    updateJob,
    writeActiveJobsCache,
  ]);

  const start = useCallback(
    async (chapterId: string, mode: TranslationStartMode) => {
      const version = beginMutation([chapterId]);
      try {
        const res = await startTranslationJob({ data: { chapterId, mode } });
        if (!mountedRef.current || !ownsMutation(chapterId, version)) return;

        const nextJob: ActiveJobState = {
          jobId: res.jobId,
          chapterId,
          status: "pending",
          doneChunks: 0,
          totalChunks: res.totalChunks,
        };
        rememberActiveJob(nextJob, version);
        await reconcileActiveJobsCache(
          [nextJob],
          [],
          () => mountedRef.current && ownsMutation(chapterId, version),
        );
        if (!mountedRef.current || !ownsMutation(chapterId, version)) return;

        updateJob(chapterId, nextJob);
        toast.info(mode === "overwrite" ? "Re-translation queued" : "Translation queued");
        invalidateJobOutcome();
      } catch (err) {
        if (mountedRef.current && ownsMutation(chapterId, version)) {
          toast.error(err instanceof Error ? err.message : "Failed to start translation");
        }
      }
    },
    [
      beginMutation,
      invalidateJobOutcome,
      ownsMutation,
      reconcileActiveJobsCache,
      rememberActiveJob,
      updateJob,
    ],
  );

  const startMany = useCallback(
    async (chapterIds: string[], mode: TranslationStartMode) => {
      const version = beginMutation(chapterIds);
      try {
        const res = await startTranslationJobs({ data: { novelId, chapterIds, mode } });
        if (!mountedRef.current) return 0;

        const queuedJobs: ActiveJobState[] = res.queued
          .map((job) => ({
            jobId: job.jobId,
            chapterId: job.chapterId,
            status: "pending" as const,
            doneChunks: 0,
            totalChunks: job.totalChunks,
          }))
          .filter((job) => ownsMutation(job.chapterId, version));
        const skipped = res.skipped.filter(({ chapterId }) => ownsMutation(chapterId, version));

        for (const job of queuedJobs) rememberActiveJob(job, version);
        await reconcileActiveJobsCache(queuedJobs, [], () => {
          return (
            mountedRef.current && queuedJobs.every((job) => ownsMutation(job.chapterId, version))
          );
        });
        if (!mountedRef.current) return 0;

        const currentQueuedJobs = queuedJobs.filter((job) => ownsMutation(job.chapterId, version));
        const currentSkipped = skipped.filter(({ chapterId }) => ownsMutation(chapterId, version));
        for (const job of currentQueuedJobs) updateJob(job.chapterId, job);

        if (currentQueuedJobs.length > 0) {
          toast.info(
            `${mode === "overwrite" ? "Queued re-translation for" : "Queued"} ${currentQueuedJobs.length} chapter${currentQueuedJobs.length === 1 ? "" : "s"}`,
          );
        }
        if (currentSkipped.length > 0) {
          toast.warning(
            `Skipped ${currentSkipped.length} chapter${currentSkipped.length === 1 ? "" : "s"}`,
          );
        }

        if (currentQueuedJobs.length > 0 || currentSkipped.length > 0) invalidateJobOutcome();
        return currentQueuedJobs.length;
      } catch (err) {
        if (
          mountedRef.current &&
          chapterIds.some((chapterId) => ownsMutation(chapterId, version))
        ) {
          toast.error(err instanceof Error ? err.message : "Failed to queue translations");
        }
        return 0;
      }
    },
    [
      beginMutation,
      invalidateJobOutcome,
      novelId,
      ownsMutation,
      reconcileActiveJobsCache,
      rememberActiveJob,
      updateJob,
    ],
  );

  const cancelMany = useCallback(
    async (chapterIds: string[]) => {
      const version = beginMutation(chapterIds);
      try {
        const res = await cancelTranslationJobs({ data: { novelId, chapterIds } });
        if (!mountedRef.current) return null;

        const cancelled = res.cancelled.filter(({ chapterId }) => ownsMutation(chapterId, version));
        const skipped = res.skipped.filter(({ chapterId }) => ownsMutation(chapterId, version));
        for (const { chapterId, jobId } of cancelled) {
          rememberTerminalJob(chapterId, jobId, true);
        }

        await reconcileActiveJobsCache(
          [],
          cancelled.map(({ jobId }) => jobId),
          () => mountedRef.current,
        );
        if (!mountedRef.current) return null;

        const currentCancelled = cancelled.filter(({ chapterId }) =>
          ownsMutation(chapterId, version),
        );
        const currentSkipped = skipped.filter(({ chapterId }) => ownsMutation(chapterId, version));
        for (const { chapterId, jobId } of currentCancelled) {
          removeJobIfMatches(chapterId, jobId);
        }

        const cancelledChapterIds = currentCancelled.map(({ chapterId }) => chapterId);
        const skippedChapterIds = currentSkipped.map(({ chapterId }) => chapterId);
        if (cancelledChapterIds.length > 0) {
          toast.info(
            `Cancellation requested for ${cancelledChapterIds.length} translation${cancelledChapterIds.length === 1 ? "" : "s"}`,
          );
        }
        if (skippedChapterIds.length > 0) {
          toast.warning(
            `Skipped ${skippedChapterIds.length} chapter${skippedChapterIds.length === 1 ? "" : "s"} with no active translation`,
          );
        }

        if (cancelledChapterIds.length > 0 || skippedChapterIds.length > 0) invalidateJobOutcome();
        return { cancelledChapterIds, skippedChapterIds };
      } catch (err) {
        if (
          mountedRef.current &&
          chapterIds.some((chapterId) => ownsMutation(chapterId, version))
        ) {
          toast.error(err instanceof Error ? err.message : "Failed to stop selected translations");
        }
        return null;
      }
    },
    [
      beginMutation,
      invalidateJobOutcome,
      novelId,
      ownsMutation,
      reconcileActiveJobsCache,
      rememberTerminalJob,
      removeJobIfMatches,
    ],
  );

  const cancel = useCallback(
    async (jobId: string, chapterId: string) => {
      const version = beginMutation([chapterId]);
      try {
        await cancelTranslationJob({ data: { jobId } });
        if (!mountedRef.current || !ownsMutation(chapterId, version)) return;

        rememberTerminalJob(chapterId, jobId, true);
        await reconcileActiveJobsCache(
          [],
          [jobId],
          () => mountedRef.current && ownsMutation(chapterId, version),
        );
        if (!mountedRef.current || !ownsMutation(chapterId, version)) return;

        removeJobIfMatches(chapterId, jobId);
        toast.info("Translation cancelled");
        invalidateJobOutcome();
      } catch (err) {
        if (mountedRef.current && ownsMutation(chapterId, version)) {
          toast.error(err instanceof Error ? err.message : "Failed to cancel translation");
        }
      }
    },
    [
      beginMutation,
      invalidateJobOutcome,
      ownsMutation,
      reconcileActiveJobsCache,
      rememberTerminalJob,
      removeJobIfMatches,
    ],
  );

  const retry = useCallback(
    async (jobId: string, chapterId: string) => {
      const version = beginMutation([chapterId]);
      try {
        await retryTranslationJob({ data: { jobId } });
        if (!mountedRef.current || !ownsMutation(chapterId, version)) return;

        const existing = activeJobs.get(chapterId);
        const retriedJob: ActiveJobState = {
          jobId,
          chapterId,
          status: "pending",
          doneChunks: existing?.doneChunks || 0,
          totalChunks: existing?.totalChunks || 1,
        };
        rememberActiveJob(retriedJob, version);
        await reconcileActiveJobsCache(
          [retriedJob],
          [],
          () => mountedRef.current && ownsMutation(chapterId, version),
        );
        if (!mountedRef.current || !ownsMutation(chapterId, version)) return;

        updateJob(chapterId, retriedJob);
        toast.info("Translation requeued");
        invalidateJobOutcome();
      } catch (err) {
        if (mountedRef.current && ownsMutation(chapterId, version)) {
          toast.error(err instanceof Error ? err.message : "Failed to retry translation");
        }
      }
    },
    [
      activeJobs,
      beginMutation,
      invalidateJobOutcome,
      ownsMutation,
      reconcileActiveJobsCache,
      rememberActiveJob,
      updateJob,
    ],
  );

  return {
    start,
    startMany,
    cancel,
    cancelMany,
    retry,
    clearActiveJobs,
    activeJobs,
    activeJobsError: activeJobsQuery.error,
    refetchActiveJobs: activeJobsQuery.refetch,
  };
}
