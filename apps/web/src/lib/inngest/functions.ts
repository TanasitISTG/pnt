import "@tanstack/react-start/server-only";

import { inngest } from "./client";
import { initJob, translateChunk, finalizeJob, failJob } from "@/lib/translation/workflow/worker";
import {
  initImportJob,
  importOneChapter,
  finishImportJob,
  failImportJob,
} from "@/lib/scrape/worker";
import {
  prepareEpubImportJob,
  initEpubImportJob,
  importEpubChapterBatch,
  planEpubImportBatches,
  finishEpubImportJob,
  failEpubImportJob,
  cleanupExpiredEpubUploads,
} from "@/lib/epub/worker";
import { log } from "@/lib/log";
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
    triggers: { cron: "*/1 * * * *" },
    retries: 0,
    concurrency: { limit: 1 },
  },
  async ({ step }) => step.run("dispatch-pending", () => dispatchPendingWorkflowOutbox()),
);

// One run per bulk chapter import. Each chapter is a memoized step (own HTTP
// invocation, fresh budget, auto-retry); cancel is honored between steps and
// re-checked inside each step so a DB-cancel stops the run mid-range.
export const importChaptersFn = inngest.createFunction(
  {
    id: "import-chapters",
    triggers: { event: "scrape/import.requested" },
    retries: 3,
    concurrency: { limit: 1, key: "event.data.jobId" },
    idempotency: "event.data.runKey",
    cancelOn: [{ event: "scrape/import.cancelled", match: "data.jobId" }],
    onFailure: async ({ event, error }) => {
      const jobId = (event.data as FailedRunEventData).event?.data?.jobId;
      if (!jobId) {
        log("error", "Import onFailure fired without jobId", { event, error: error.message });
        return;
      }
      log("error", "Import job failed", { jobId, error: error.message });
      await failImportJob(jobId, error.message);
    },
  },
  async ({ event, step }) => {
    const { jobId } = event.data as { jobId: string };

    const init = await step.run("init", () => initImportJob(jobId));
    if (init.skip) return { skipped: true };

    for (let n = init.next; n <= init.to; n++) {
      const r = await step.run(`chapter-${n}`, () => importOneChapter(jobId, n, init.chapterUrls));
      if (r.stop) return { stopped: true };
    }

    await step.run("finish", () => finishImportJob(jobId));
    return { done: true };
  },
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

export const functions = [
  dispatchWorkflowOutboxFn,
  translateChapterFn,
  importChaptersFn,
  importEpubChaptersFn,
  cleanupExpiredEpubUploadsFn,
  cleanupExpiredRateLimitsFn,
  translationEvalFn,
];
