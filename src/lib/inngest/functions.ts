import "@tanstack/react-start/server-only";

import { inngest } from "./client";
import { initJob, translateChunk, finalizeJob, failJob } from "@/lib/translation/workflow/worker";
import {
  prepareEpubImportJob,
  initEpubImportJob,
  importEpubChapterBatch,
  planEpubImportBatches,
  finishEpubImportJob,
  failEpubImportJob,
  cleanupExpiredEpubUploads,
} from "@/lib/epub/worker";
import { pruneOrphanNovelAssets, reapSupersededAssets } from "@/lib/account/purge.server";
import { log } from "@/lib/log";
import {
  pruneNotifications,
  sweepPendingChapterNotifications,
} from "@/lib/notifications/service.server";
import { dispatchPendingWorkflowOutbox } from "./outbox";
import { TRANSLATION_CANCEL_IF } from "@/lib/translation/workflow/job-state";
import { RETRY_COUNT } from "@/lib/retry";
import { cleanupExpiredRateLimits } from "@/lib/rate-limit";
import {
  failTranslationEvalReport,
  runTranslationEvalReport,
} from "@/lib/translation/evaluation/eval-worker";

// onFailure wraps the original trigger event: event.data.event.data.jobId.
type FailedRunEventData = { event?: { data?: { jobId?: string; generation?: number } } };
type FailedEvalRunEventData = { event?: { data?: { reportId?: string } } };

// One run per translation job. Each chunk is one memoized step (relationship
// analysis + translation) = its own HTTP invocation (fresh 5-min Vercel budget)
// with automatic retries; a crash resumes from the last completed step, so no DB
// lease is needed. `init` memoizes the run-stable context for every chunk step.
export const translateChapterFn = inngest.createFunction(
  {
    id: "translate-chapter",
    triggers: { event: "translation/job.requested" },
    retries: RETRY_COUNT,
    concurrency: { limit: 1, key: "event.data.novelId" },
    // runKey is a fresh nanoid per enqueue — duplicate sends of the same
    // enqueue collapse, while a deliberate retry (new runKey) always runs.
    idempotency: "event.data.runKey",
    cancelOn: [{ event: "translation/job.cancelled", if: TRANSLATION_CANCEL_IF }],
    onFailure: async ({ event, error }) => {
      const jobId = (event.data as FailedRunEventData).event?.data?.jobId;
      // Migration 0021 assigns generation 1 to jobs queued by the old event shape.
      const generation = (event.data as FailedRunEventData).event?.data?.generation ?? 1;
      if (!jobId) {
        log("error", "Translation onFailure fired without jobId", { event, error: error.message });
        return;
      }
      log("error", "Translation job failed", { jobId, error: error.message });
      await failJob(jobId, generation, error.message);
    },
  },
  async ({ event, step }) => {
    const { jobId, generation = 1 } = event.data as { jobId: string; generation?: number };

    const init = await step.run("init", () => initJob(jobId, generation));
    if (init.skip) return { skipped: true };

    for (let i = init.doneChunks; i < init.totalChunks; i++) {
      await step.run(`chunk-${i}`, () => translateChunk(jobId, i, generation, init.context));
    }

    await step.run("finalize", () => finalizeJob(jobId, generation));
    return { done: true };
  },
);

export const dispatchWorkflowOutboxFn = inngest.createFunction(
  {
    id: "dispatch-workflow-outbox",
    // Eager dispatch on the request path already delivers promptly; this sweep
    // is the retry path, so every two minutes is enough without 1,440 runs/day.
    triggers: { cron: "*/2 * * * *" },
    retries: 0,
    concurrency: { limit: 1 },
  },
  async ({ step }) => step.run("dispatch-pending", () => dispatchPendingWorkflowOutbox()),
);

export const importEpubChaptersFn = inngest.createFunction(
  {
    id: "import-epub-chapters",
    triggers: { event: "epub/import.requested" },
    retries: 3,
    concurrency: { limit: 1, key: "event.data.jobId" },
    idempotency: "event.data.runKey",
    cancelOn: [{ event: "epub/import.cancelled", match: "data.jobId" }],
    onFailure: async ({ event, error }) => {
      const jobId = (event.data as FailedRunEventData).event?.data?.jobId;
      if (!jobId) {
        log("error", "EPUB Import onFailure fired without jobId", { event, error: error.message });
        return;
      }
      log("error", "EPUB Import job failed", { jobId, error: error.message });
      await failEpubImportJob(jobId, error.message);
    },
  },
  async ({ event, step }) => {
    const { jobId } = event.data as { jobId: string };

    const prep = await step.run("prepare", () => prepareEpubImportJob(jobId));
    if (prep.skip) return { skipped: true };

    const init = await step.run("init", () => initEpubImportJob(jobId));
    if (init.skip || !init.next || !init.to) return { skipped: true };

    const plan = planEpubImportBatches(init.next, init.to);
    for (const batch of plan.batches) {
      const result = await step.run(`chapters-${batch.from}-${batch.to}`, () =>
        importEpubChapterBatch(jobId, batch.from, batch.to),
      );
      if (result.stop) return { stopped: true };
    }

    if (plan.hasMore) {
      await step.sendEvent("continue", {
        name: "epub/import.requested",
        data: {
          jobId,
          runKey: `${jobId}:${plan.next}`,
        },
      });
      return { continued: true, next: plan.next };
    }

    await step.run("finish", () => finishEpubImportJob(jobId));
    return { done: true };
  },
);

export const cleanupExpiredEpubUploadsFn = inngest.createFunction(
  {
    id: "cleanup-expired-epub-uploads",
    triggers: { cron: "0 * * * *" },
  },
  async ({ step }) => step.run("cleanup", () => cleanupExpiredEpubUploads()),
);

export const cleanupExpiredRateLimitsFn = inngest.createFunction(
  {
    id: "cleanup-expired-rate-limits",
    triggers: { cron: "0 * * * *" },
  },
  async ({ step }) => {
    let deleted = 0;
    for (let batch = 0; batch < 100; batch++) {
      const count = await step.run(`batch-${batch}`, () => cleanupExpiredRateLimits());
      deleted += count;
      if (count < 1000) break;
    }
    return deleted;
  },
);

// Nothing else reclaims the bytes the buckets accumulate. Deleting an account cascades its novels
// away in Postgres but leaves their cover variants and cached exports behind, because no foreign key
// reaches storage; replacing a cover or advancing a novel's content writes a new set and leaves the
// old one to a delete that can fail. So both rules run here: the orphan prune reclaims what a gone
// row no longer owns, and the superseded reap reclaims what a surviving row no longer names. Both
// are idempotent and also self-heal residue left by any earlier failure. Daily is enough — storage
// cost accrues slowly and each run lists both buckets — and the reap's grace period is measured in
// days for the same reason.
export const pruneOrphanStorageFn = inngest.createFunction(
  {
    id: "prune-orphan-storage",
    triggers: { cron: "0 3 * * *" },
    retries: 2,
    concurrency: { limit: 1 },
  },
  async ({ step }) => ({
    pruned: await step.run("prune", () => pruneOrphanNovelAssets()),
    reaped: await step.run("reap", () => reapSupersededAssets()),
  }),
);

export const translationEvalFn = inngest.createFunction(
  {
    id: "translation-eval",
    triggers: { event: "translation/eval.requested" },
    retries: 1,
    idempotency: "event.data.runKey",
    onFailure: async ({ event, error }) => {
      const reportId = (event.data as FailedEvalRunEventData).event?.data?.reportId;
      if (!reportId) {
        log("error", "Translation evaluation onFailure fired without reportId", {
          event,
          error: error.message,
        });
        return;
      }
      log("error", "Translation evaluation failed", { reportId, error: error.message });
      await failTranslationEvalReport(reportId);
    },
  },
  async ({ event, step }) => {
    const { reportId } = event.data as { reportId: string };
    return await step.run("run-eval", () => runTranslationEvalReport(reportId));
  },
);

/**
 * The clock's half of publishing: a scheduled chapter has no request behind it, and a bulk
 * release deliberately leaves its fan-out off the request, so this sweep turns "the time has
 * passed" into the same idempotent write the single-chapter path makes. It also catches a
 * publish whose inline fan-out failed, and prunes the rows a bell will never show again.
 *
 * Every minute rather than the outbox's two: readers wait on this one.
 */
export const notificationSweepFn = inngest.createFunction(
  {
    id: "notification-sweep",
    triggers: { cron: "* * * * *" },
    retries: 1,
    concurrency: { limit: 1 },
  },
  async ({ step }) => step.run("sweep-chapters", () => sweepPendingChapterNotifications()),
);

/**
 * Retention runs once a day, not with the sweep: a bell is a recent-events surface, and the
 * delete only has work to do when a day's worth of notifications have aged out.
 */
export const notificationRetentionFn = inngest.createFunction(
  {
    id: "notification-retention",
    triggers: { cron: "15 4 * * *" },
    retries: 1,
    concurrency: { limit: 1 },
  },
  async ({ step }) => step.run("prune", () => pruneNotifications()),
);

export const functions = [
  dispatchWorkflowOutboxFn,
  notificationSweepFn,
  notificationRetentionFn,
  translateChapterFn,
  importEpubChaptersFn,
  cleanupExpiredEpubUploadsFn,
  cleanupExpiredRateLimitsFn,
  pruneOrphanStorageFn,
  translationEvalFn,
];
