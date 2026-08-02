import "@tanstack/react-start/server-only";

import { inngest } from "./client";
import { initJob, translateChunk, finalizeJob, failJob } from "@/lib/translation/worker";
import {
  initImportJob,
  importOneChapter,
  finishImportJob,
  failImportJob,
} from "@/lib/scrape/worker";
import { log } from "@/lib/log";
import { dispatchPendingTranslationOutbox } from "@/lib/translation/outbox";
import { TRANSLATION_CANCEL_IF } from "@/lib/translation/job-state";
import { runTranslationEvalReport } from "@/lib/translation/eval-worker";

// onFailure wraps the original trigger event: event.data.event.data.jobId.
type FailedRunEventData = { event?: { data?: { jobId?: string; generation?: number } } };

// One run per translation job. Each chunk is a memoized step = its own HTTP
// invocation (fresh 5-min Vercel budget) with automatic retries; a crash
// resumes from the last completed step, so no DB lease is needed.
export const translateChapterFn = inngest.createFunction(
  {
    id: "translate-chapter",
    triggers: { event: "translation/job.requested" },
    retries: 3,
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
      await step.run(`chunk-${i}`, () => translateChunk(jobId, i, generation));
    }

    await step.run("finalize", () => finalizeJob(jobId, generation));
    return { done: true };
  },
);

export const dispatchTranslationOutboxFn = inngest.createFunction(
  {
    id: "dispatch-translation-outbox",
    triggers: { cron: "*/1 * * * *" },
    retries: 0,
    concurrency: { limit: 1 },
  },
  async ({ step }) => step.run("dispatch-pending", () => dispatchPendingTranslationOutbox()),
);

// One run per bulk chapter import. Each chapter is a memoized step (own HTTP
// invocation, fresh budget, auto-retry); cancel is honored between steps and
// re-checked inside each step so a DB-cancel stops the run mid-range.
export const importChaptersFn = inngest.createFunction(
  {
    id: "import-chapters",
    triggers: { event: "scrape/import.requested" },
    retries: 3,
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

export const translationEvalFn = inngest.createFunction(
  {
    id: "translation-eval",
    triggers: { event: "translation/eval.requested" },
    retries: 1,
    idempotency: "event.data.runKey",
  },
  async ({ event, step }) => {
    const { reportId } = event.data as { reportId: string };
    return await step.run("run-eval", () => runTranslationEvalReport(reportId));
  },
);

export const functions = [
  translateChapterFn,
  dispatchTranslationOutboxFn,
  importChaptersFn,
  translationEvalFn,
];
