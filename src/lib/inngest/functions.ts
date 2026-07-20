import "@tanstack/react-start/server-only";

import { inngest } from "./client";
import { initJob, translateChunk, finalizeJob, failJob } from "@/lib/translation/worker";

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
      const { jobId } = (event.data as any).event?.data ?? {};
      if (jobId) await failJob(jobId, error.message);
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

export const functions = [translateChapterFn];
