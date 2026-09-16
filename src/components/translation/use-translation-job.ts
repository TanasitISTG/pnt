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
import {
  beginMutation,
  claimTerminalChecks,
  createJobAuthorityState,
  decideTerminalLookup,
  forgetTrackedJob,
  mapTerminalOutcome,
  mergeJobState,
  ownsMutation,
  planPollReconciliation,
  releaseTerminalChecks,
  rememberActiveJob,
  rememberTerminalJob,
  removeJobIfMatches,
  trackUnresolvedJob,
  withJobFailure,
  type ActiveTranslationJobList,
  type JobAuthorityState,
  type TrackedJob,
} from "./job-authority";

// This hook is a read-only observer: translation work is executed by Inngest
// (see src/lib/inngest/functions.ts), never by the browser — so page
// refreshes can no longer duplicate chunks or finalization.
// `enabled=false` (guests) skips all server calls — job endpoints are admin-only.
// The authority protocol that decides which poll/mutation response wins lives
// in ./job-authority.ts; this hook only wires it to React, the query cache,
// invalidation, and toasts.
export function useTranslationJob(novelId: string, enabled = true) {
  const queryClient = useQueryClient();
  const [activeJobs, setActiveJobs] = useState<Map<string, ActiveJobState>>(new Map());
  const authorityRef = useRef<JobAuthorityState>(createJobAuthorityState());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

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

  const setJobState = useCallback((state: ActiveJobState) => {
    setActiveJobs((prev) => mergeJobState(prev, state));
  }, []);

  const removeJob = useCallback((chapterId: string, jobId: string) => {
    setActiveJobs((prev) => removeJobIfMatches(prev, chapterId, jobId));
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

    const plan = planPollReconciliation(authorityRef.current, dbJobs, activeJobs);
    authorityRef.current = { ...plan.state, previousActiveJobs: plan.nextPreviousActiveJobs };
    if (plan.ignoredJobIds.length > 0) {
      writeActiveJobsCache(plan.expectedJobsForCacheRewrite, plan.ignoredJobIds);
    }

    for (const job of plan.accepted) {
      setJobState({
        jobId: job.id,
        chapterId: job.chapterId,
        status: job.status,
        doneChunks: job.doneChunks,
        totalChunks: job.totalChunks,
        error: job.error,
      });
    }

    const { state: claimedState, claimed } = claimTerminalChecks(
      authorityRef.current,
      plan.disappeared,
    );
    authorityRef.current = claimedState;
    if (claimed.length === 0) return;

    void (async () => {
      let doneCount = 0;
      let errorCount = 0;
      let cancelledCount = 0;
      let removedCount = 0;
      const unresolved: TrackedJob[] = [];
      const resolvedJobIds: string[] = [];

      try {
        const terminal = await getTranslationJobsTerminalStatus({
          data: { jobIds: claimed.map(({ job }) => job.jobId) },
        });
        if (cancelled || !mountedRef.current) return;
        const terminalMap = new Map(terminal.map((job) => [job.id, job]));

        for (const { job, mutationVersion } of claimed) {
          const decision = decideTerminalLookup(authorityRef.current, job, {
            replacedJobIds: plan.replacedJobIds,
            lookupMutationVersion: mutationVersion,
          });
          if (decision === "forget") {
            authorityRef.current = forgetTrackedJob(authorityRef.current, job);
            continue;
          }
          if (decision === "defer") continue;

          const authority = authorityRef.current.authorities.get(job.chapterId);
          const outcome = mapTerminalOutcome(terminalMap.get(job.jobId));
          if (outcome.kind === "done") {
            authorityRef.current = rememberTerminalJob(
              authorityRef.current,
              job.chapterId,
              job.jobId,
              false,
            );
            authorityRef.current = forgetTrackedJob(authorityRef.current, job);
            doneCount++;
            resolvedJobIds.push(job.jobId);
            removeJob(job.chapterId, job.jobId);
          } else if (outcome.kind === "error") {
            authorityRef.current = rememberTerminalJob(
              authorityRef.current,
              job.chapterId,
              job.jobId,
              false,
            );
            authorityRef.current = forgetTrackedJob(authorityRef.current, job);
            errorCount++;
            resolvedJobIds.push(job.jobId);
            setActiveJobs((prev) => withJobFailure(prev, job.chapterId, job.jobId, outcome.error));
          } else if (outcome.kind === "cancelled") {
            authorityRef.current = rememberTerminalJob(
              authorityRef.current,
              job.chapterId,
              job.jobId,
              true,
            );
            authorityRef.current = forgetTrackedJob(authorityRef.current, job);
            resolvedJobIds.push(job.jobId);
            if (!authority?.suppressTerminalToast) cancelledCount++;
            removeJob(job.chapterId, job.jobId);
          } else if (outcome.kind === "removed") {
            // The owned job row was removed with its chapter. A successful
            // terminal lookup proves this is not a transient polling failure.
            authorityRef.current = rememberTerminalJob(
              authorityRef.current,
              job.chapterId,
              job.jobId,
              true,
            );
            authorityRef.current = forgetTrackedJob(authorityRef.current, job);
            resolvedJobIds.push(job.jobId);
            removedCount++;
            removeJob(job.chapterId, job.jobId);
          } else {
            unresolved.push(job);
          }
        }
      } catch {
        unresolved.push(...claimed.map(({ job }) => job));
      } finally {
        authorityRef.current = releaseTerminalChecks(
          authorityRef.current,
          claimed.map(({ job }) => job.jobId),
        );
      }

      if (cancelled || !mountedRef.current) return;
      for (const job of unresolved) {
        authorityRef.current = trackUnresolvedJob(authorityRef.current, job);
      }

      const terminalCount = doneCount + errorCount + cancelledCount;
      if (terminalCount + removedCount === 0) return;
      if (resolvedJobIds.length > 0) {
        writeActiveJobsCache([], resolvedJobIds);
      }
      if (unresolved.length === 0 && plan.accepted.length === 0) {
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
    activeJobsQuery.data,
    activeJobsQuery.dataUpdatedAt,
    enabled,
    invalidateJobOutcome,
    invalidateJobProgress,
    removeJob,
    setJobState,
    writeActiveJobsCache,
  ]);

  const start = useCallback(
    async (chapterId: string, mode: TranslationStartMode) => {
      const mutation = beginMutation(authorityRef.current, [chapterId]);
      authorityRef.current = mutation.state;
      const version = mutation.version;
      try {
        const res = await startTranslationJob({ data: { chapterId, mode } });
        if (!mountedRef.current || !ownsMutation(authorityRef.current, chapterId, version)) return;

        const nextJob: ActiveJobState = {
          jobId: res.jobId,
          chapterId,
          status: "pending",
          doneChunks: 0,
          totalChunks: res.totalChunks,
        };
        authorityRef.current = rememberActiveJob(authorityRef.current, nextJob, version).state;
        await reconcileActiveJobsCache(
          [nextJob],
          [],
          () => mountedRef.current && ownsMutation(authorityRef.current, chapterId, version),
        );
        if (!mountedRef.current || !ownsMutation(authorityRef.current, chapterId, version)) return;

        setJobState(nextJob);
        toast.info(mode === "overwrite" ? "Re-translation queued" : "Translation queued");
        invalidateJobOutcome();
      } catch (err) {
        if (mountedRef.current && ownsMutation(authorityRef.current, chapterId, version)) {
          toast.error(err instanceof Error ? err.message : "Failed to start translation");
        }
      }
    },
    [invalidateJobOutcome, reconcileActiveJobsCache, setJobState],
  );

  const startMany = useCallback(
    async (chapterIds: string[], mode: TranslationStartMode) => {
      const mutation = beginMutation(authorityRef.current, chapterIds);
      authorityRef.current = mutation.state;
      const version = mutation.version;
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
          .filter((job) => ownsMutation(authorityRef.current, job.chapterId, version));
        const skipped = res.skipped.filter(({ chapterId }) =>
          ownsMutation(authorityRef.current, chapterId, version),
        );

        for (const job of queuedJobs) {
          authorityRef.current = rememberActiveJob(authorityRef.current, job, version).state;
        }
        await reconcileActiveJobsCache(queuedJobs, [], () => {
          return (
            mountedRef.current &&
            queuedJobs.every((job) => ownsMutation(authorityRef.current, job.chapterId, version))
          );
        });
        if (!mountedRef.current) return 0;

        const currentQueuedJobs = queuedJobs.filter((job) =>
          ownsMutation(authorityRef.current, job.chapterId, version),
        );
        const currentSkipped = skipped.filter(({ chapterId }) =>
          ownsMutation(authorityRef.current, chapterId, version),
        );
        for (const job of currentQueuedJobs) setJobState(job);

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
          chapterIds.some((chapterId) => ownsMutation(authorityRef.current, chapterId, version))
        ) {
          toast.error(err instanceof Error ? err.message : "Failed to queue translations");
        }
        return 0;
      }
    },
    [invalidateJobOutcome, novelId, reconcileActiveJobsCache, setJobState],
  );

  const cancelMany = useCallback(
    async (chapterIds: string[]) => {
      const mutation = beginMutation(authorityRef.current, chapterIds);
      authorityRef.current = mutation.state;
      const version = mutation.version;
      try {
        const res = await cancelTranslationJobs({ data: { novelId, chapterIds } });
        if (!mountedRef.current) return null;

        const cancelled = res.cancelled.filter(({ chapterId }) =>
          ownsMutation(authorityRef.current, chapterId, version),
        );
        const skipped = res.skipped.filter(({ chapterId }) =>
          ownsMutation(authorityRef.current, chapterId, version),
        );
        for (const { chapterId, jobId } of cancelled) {
          authorityRef.current = rememberTerminalJob(authorityRef.current, chapterId, jobId, true);
        }

        await reconcileActiveJobsCache(
          [],
          cancelled.map(({ jobId }) => jobId),
          () => mountedRef.current,
        );
        if (!mountedRef.current) return null;

        const currentCancelled = cancelled.filter(({ chapterId }) =>
          ownsMutation(authorityRef.current, chapterId, version),
        );
        const currentSkipped = skipped.filter(({ chapterId }) =>
          ownsMutation(authorityRef.current, chapterId, version),
        );
        for (const { chapterId, jobId } of currentCancelled) {
          removeJob(chapterId, jobId);
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
          chapterIds.some((chapterId) => ownsMutation(authorityRef.current, chapterId, version))
        ) {
          toast.error(err instanceof Error ? err.message : "Failed to stop selected translations");
        }
        return null;
      }
    },
    [invalidateJobOutcome, novelId, reconcileActiveJobsCache, removeJob],
  );

  const cancel = useCallback(
    async (jobId: string, chapterId: string) => {
      const mutation = beginMutation(authorityRef.current, [chapterId]);
      authorityRef.current = mutation.state;
      const version = mutation.version;
      try {
        await cancelTranslationJob({ data: { jobId } });
        if (!mountedRef.current || !ownsMutation(authorityRef.current, chapterId, version)) return;

        authorityRef.current = rememberTerminalJob(authorityRef.current, chapterId, jobId, true);
        await reconcileActiveJobsCache(
          [],
          [jobId],
          () => mountedRef.current && ownsMutation(authorityRef.current, chapterId, version),
        );
        if (!mountedRef.current || !ownsMutation(authorityRef.current, chapterId, version)) return;

        removeJob(chapterId, jobId);
        toast.info("Translation cancelled");
        invalidateJobOutcome();
      } catch (err) {
        if (mountedRef.current && ownsMutation(authorityRef.current, chapterId, version)) {
          toast.error(err instanceof Error ? err.message : "Failed to cancel translation");
        }
      }
    },
    [invalidateJobOutcome, reconcileActiveJobsCache, removeJob],
  );

  const retry = useCallback(
    async (jobId: string, chapterId: string) => {
      const mutation = beginMutation(authorityRef.current, [chapterId]);
      authorityRef.current = mutation.state;
      const version = mutation.version;
      try {
        await retryTranslationJob({ data: { jobId } });
        if (!mountedRef.current || !ownsMutation(authorityRef.current, chapterId, version)) return;

        const existing = activeJobs.get(chapterId);
        const retriedJob: ActiveJobState = {
          jobId,
          chapterId,
          status: "pending",
          doneChunks: existing?.doneChunks || 0,
          totalChunks: existing?.totalChunks || 1,
        };
        authorityRef.current = rememberActiveJob(authorityRef.current, retriedJob, version).state;
        await reconcileActiveJobsCache(
          [retriedJob],
          [],
          () => mountedRef.current && ownsMutation(authorityRef.current, chapterId, version),
        );
        if (!mountedRef.current || !ownsMutation(authorityRef.current, chapterId, version)) return;

        setJobState(retriedJob);
        toast.info("Translation requeued");
        invalidateJobOutcome();
      } catch (err) {
        if (mountedRef.current && ownsMutation(authorityRef.current, chapterId, version)) {
          toast.error(err instanceof Error ? err.message : "Failed to retry translation");
        }
      }
    },
    [activeJobs, invalidateJobOutcome, reconcileActiveJobsCache, setJobState],
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
