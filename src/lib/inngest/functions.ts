import "@tanstack/react-start/server-only";

import { inngest } from "./client";
import { initJob, translateChunk, finalizeJob, failJob } from "@/lib/translation/worker";
import {
  initImportJob,
  importOneChapter,
  finishImportJob,
  failImportJob,
} from "@/lib/scrape.worker";
import { log } from "@/lib/log";

// One run per translation job. Each chunk is a memoized step = its own HTTP
// invocation (fresh 5-min Vercel budget) with automatic retries; a crash
// resumes from the last completed step, so no DB lease is needed.
export const translateChapterFn = inngest.createFunction(
  {
    id: "translate-chapter",
    triggers: { event: "translation/job.requested" },
    retries: 3,
    // runKey is a fresh nanoid per enqueue — duplicate sends of the same
    // enqueue collapse, while a deliberate retry (new runKey) always runs.
    idempotency: "event.data.runKey",
    cancelOn: [{ event: "translation/job.cancelled", match: "data.jobId" }],
    onFailure: async ({ event, error }) => {
      const jobId = (event.data as any).event?.data?.jobId;
      if (!jobId) {
        log("error", "Translation onFailure fired without jobId", { event, error: error.message });
        return;
      }
      log("error", "Translation job failed", { jobId, error: error.message });
      await failJob(jobId, error.message);
    },
  },
  async ({ event, step }) => {
    const { jobId } = event.data as { jobId: string };

    const init = await step.run("init", () => initJob(jobId));
    if (init.skip) return { skipped: true };

    for (let i = init.doneChunks; i < init.totalChunks; i++) {
      await step.run(`chunk-${i}`, () => translateChunk(jobId, i));
    }

    await step.run("finalize", () => finalizeJob(jobId));
    return { done: true };
  },
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
      const jobId = (event.data as any).event?.data?.jobId;
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
      const r = await step.run(`chapter-${n}`, () => importOneChapter(jobId, n));
      if (r.stop) return { stopped: true };
    }

    await step.run("finish", () => finishImportJob(jobId));
    return { done: true };
  },
);

export const functions = [translateChapterFn, importChaptersFn];
