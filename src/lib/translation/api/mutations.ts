import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { eq, and, inArray, sql, asc, gte } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  novels,
  chapters,
  translationJobs,
  translationJobChunks,
  translationOutbox,
} from "@/lib/db/schema";
import { ensureSession } from "@/lib/auth/functions";
import { nanoid } from "@/lib/utils";
import { createProviderClient } from "@/lib/translation/providers/provider-client";
import { chunkText } from "@/lib/translation/text/chunker";
import {
  startTranslationJobSchema,
  startTranslationJobsSchema,
  cancelTranslationJobSchema,
  cancelTranslationJobsSchema,
  retryTranslationJobSchema,
} from "./schemas";
import { withSafeHandler, SafeServerError } from "@/lib/server-fn-error";
import type { ChunkProgress, LogEntry } from "../types/workflow";
import { createLog } from "../workflow/log-entry";
import type { AIProviderClient } from "../types/provider";
import { translationRunIdentity } from "../workflow/job-state";
import { enqueueTranslationBatchInOrder } from "./batch";

const dispatchOutboxBestEffort = createServerOnlyFn(async (outboxId: string) => {
  const { dispatchTranslationOutboxEventBestEffort } = await import("../workflow/outbox");
  await dispatchTranslationOutboxEventBestEffort(outboxId);
});
async function cancelTranslationRunsForUser(
  userId: string,
  target: { jobIds: readonly string[] } | { novelId: string; chapterIds: readonly string[] },
): Promise<{
  matchedJobIds: string[];
  cancelled: Array<{ chapterId: string; jobId: string }>;
  outboxIds: string[];
}> {
  return db.transaction(async (tx) => {
    let candidates: Array<{
      job: typeof translationJobs.$inferSelect;
      chapter: typeof chapters.$inferSelect;
    }>;

    if ("jobIds" in target) {
      candidates = await tx
        .select({ job: translationJobs, chapter: chapters })
        .from(translationJobs)
        .innerJoin(chapters, eq(translationJobs.chapterId, chapters.id))
        .innerJoin(novels, eq(chapters.novelId, novels.id))
        .where(and(inArray(translationJobs.id, [...target.jobIds]), eq(novels.userId, userId)))
        .for("update");
    } else {
      const chapterRows = await tx
        .select({ chapter: chapters })
        .from(chapters)
        .innerJoin(novels, eq(chapters.novelId, novels.id))
        .where(
          and(
            inArray(chapters.id, [...target.chapterIds]),
            eq(chapters.novelId, target.novelId),
            eq(novels.userId, userId),
          ),
        )
        .for("update");

      const activeJobIds = chapterRows.flatMap(({ chapter }) =>
        chapter.activeTranslationJobId ? [chapter.activeTranslationJobId] : [],
      );
      if (activeJobIds.length === 0) {
        candidates = [];
      } else {
        const jobs = await tx
          .select()
          .from(translationJobs)
          .where(inArray(translationJobs.id, activeJobIds))
          .for("update");
        const jobsById = new Map(jobs.map((job) => [job.id, job]));
        candidates = chapterRows.flatMap(({ chapter }) => {
          const jobId = chapter.activeTranslationJobId;
          const job = jobId ? jobsById.get(jobId) : undefined;
          return job && job.chapterId === chapter.id ? [{ job, chapter }] : [];
        });
      }
    }

    const targetOrder = new Map(
      ("jobIds" in target ? target.jobIds : target.chapterIds).map((id, index) => [id, index]),
    );
    const getOrder = (candidate: (typeof candidates)[number]) =>
      targetOrder.get("jobIds" in target ? candidate.job.id : candidate.chapter.id) ??
      Number.MAX_SAFE_INTEGER;
    candidates.sort((left, right) => getOrder(left) - getOrder(right));

    const matchedJobIds = candidates.map(({ job }) => job.id);
    const cancelled: Array<{ chapterId: string; jobId: string }> = [];
    const cancellationOutboxRows: Array<{
      id: string;
      eventName: "translation/job.cancelled";
      payloadJson: string;
    }> = [];

    for (const { job, chapter } of candidates) {
      if (
        !["pending", "running"].includes(job.status) ||
        chapter.activeTranslationJobId !== job.id
      ) {
        continue;
      }

      const logs: LogEntry[] = JSON.parse(job.logsJson || "[]");
      logs.push(createLog("warn", "Job cancelled by user."));
      await tx
        .update(translationJobs)
        .set({ status: "cancelled", logsJson: JSON.stringify(logs), updatedAt: new Date() })
        .where(
          and(
            eq(translationJobs.id, job.id),
            sql`${translationJobs.status} IN ('pending', 'running')`,
          ),
        );
      await tx
        .update(chapters)
        .set({
          activeTranslationJobId: null,
          status: chapter.translatedContent ? "translated" : "raw",
          updatedAt: new Date(),
        })
        .where(and(eq(chapters.id, chapter.id), eq(chapters.activeTranslationJobId, job.id)));

      const outboxId = nanoid();
      cancellationOutboxRows.push({
        id: outboxId,
        eventName: "translation/job.cancelled",
        payloadJson: JSON.stringify(translationRunIdentity(job)),
      });
      cancelled.push({ chapterId: chapter.id, jobId: job.id });
    }

    if (cancellationOutboxRows.length > 0) {
      await tx.insert(translationOutbox).values(cancellationOutboxRows);
    }

    return {
      matchedJobIds,
      cancelled,
      outboxIds: cancellationOutboxRows.map(({ id }) => id),
    };
  });
}

export const enqueueTranslationJob = createServerOnlyFn(async function enqueueTranslationJob(
  userId: string,
  chapterId: string,
  providerConfig: AIProviderClient,
  dispatch: (outboxId: string) => Promise<void> = dispatchOutboxBestEffort,
) {
  const queued = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ chapter: chapters, novel: novels })
      .from(chapters)
      .innerJoin(novels, eq(chapters.novelId, novels.id))
      .where(and(eq(chapters.id, chapterId), eq(novels.userId, userId)))
      .limit(1)
      .for("update");

    if (!row) throw new SafeServerError("Chapter not found or unauthorized");

    const { chapter, novel } = row;
    const chunkInfos = chunkText(chapter.rawContent, novel.chunkSize || 2000);
    if (chunkInfos.length === 0) throw new SafeServerError("Chapter content is empty");

    const cancelledJobs = await tx
      .update(translationJobs)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(
        and(
          eq(translationJobs.chapterId, chapter.id),
          sql`${translationJobs.status} IN ('pending', 'running')`,
        ),
      )
      .returning({ id: translationJobs.id, generation: translationJobs.generation });

    const initialChunks: ChunkProgress[] = chunkInfos.map((chunk) => ({
      index: chunk.index,
      text: chunk.text,
    }));
    const logs: LogEntry[] = [
      createLog(
        "info",
        `Job initialized for Chapter "${chapter.title}" (${chapter.rawCharCount.toLocaleString()} chars).`,
      ),
      createLog(
        "info",
        `Split into ${chunkInfos.length} chunk(s) (target size: ${(novel.chunkSize || 2000).toLocaleString()} chars). Model: ${providerConfig.model}`,
      ),
    ];
    const jobId = nanoid();
    const outboxId = nanoid();
    const generation = chapter.translationGeneration + 1;
    const runKey = nanoid();

    await tx.insert(translationJobs).values({
      id: jobId,
      chapterId: chapter.id,
      status: "pending",
      sourceRevision: chapter.sourceRevision,
      generation,
      totalChunks: chunkInfos.length,
      doneChunks: 0,
      logsJson: JSON.stringify(logs),
    });
    await tx.insert(translationJobChunks).values(
      initialChunks.map((chunk) => ({
        jobId,
        index: chunk.index,
        sourceText: chunk.text,
        textLength: chunk.text.length,
      })),
    );
    await tx
      .update(chapters)
      .set({
        status: "queued",
        activeTranslationJobId: jobId,
        translationGeneration: generation,
        updatedAt: new Date(),
      })
      .where(eq(chapters.id, chapter.id));
    await tx.insert(translationOutbox).values({
      id: outboxId,
      eventName: "translation/job.requested",
      payloadJson: JSON.stringify({ jobId, novelId: novel.id, generation, runKey }),
    });
    if (cancelledJobs.length > 0) {
      await tx.insert(translationOutbox).values(
        cancelledJobs.map((cancelled) => ({
          id: nanoid(),
          eventName: "translation/job.cancelled",
          payloadJson: JSON.stringify(translationRunIdentity(cancelled)),
        })),
      );
    }

    return { jobId, outboxId, totalChunks: chunkInfos.length };
  });

  await dispatch(queued.outboxId);
  return { jobId: queued.jobId, totalChunks: queued.totalChunks };
});

export const startTranslationJob = createServerFn({ method: "POST" })
  .validator(startTranslationJobSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();

      const providerConfig = await createProviderClient(session.user.id);
      return enqueueTranslationJob(session.user.id, data.chapterId, providerConfig);
    }),
  );

export const startTranslationJobs = createServerFn({ method: "POST" })
  .validator(startTranslationJobsSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      const [providerConfig, targetChapters] = await Promise.all([
        createProviderClient(session.user.id),
        db
          .select({ id: chapters.id, number: chapters.number })
          .from(chapters)
          .innerJoin(novels, eq(chapters.novelId, novels.id))
          .where(
            and(
              inArray(chapters.id, data.chapterIds),
              eq(chapters.novelId, data.novelId),
              eq(novels.userId, session.user.id),
            ),
          )
          .orderBy(asc(sql`COALESCE(${chapters.number}::numeric, 0)`)),
      ]);

      const targetChapterIds = new Set(targetChapters.map((chapter) => chapter.id));
      const missing = data.chapterIds.flatMap((chapterId) =>
        targetChapterIds.has(chapterId)
          ? []
          : [{ chapterId, reason: "Chapter not found or unauthorized" }],
      );

      const result = await enqueueTranslationBatchInOrder(targetChapters, (chapterId) =>
        enqueueTranslationJob(session.user.id, chapterId, providerConfig),
      );

      return { queued: result.queued, skipped: [...missing, ...result.skipped] };
    }),
  );

export const cancelTranslationJob = createServerFn({ method: "POST" })
  .validator(cancelTranslationJobSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      const result = await cancelTranslationRunsForUser(session.user.id, {
        jobIds: [data.jobId],
      });

      if (!result.matchedJobIds.includes(data.jobId)) {
        throw new SafeServerError("Job not found or unauthorized");
      }

      await Promise.all(result.outboxIds.map(dispatchOutboxBestEffort));
      return { success: true };
    }),
  );

export const cancelTranslationJobs = createServerFn({ method: "POST" })
  .validator(cancelTranslationJobsSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      const chapterIds = [...new Set(data.chapterIds)];
      const result = await cancelTranslationRunsForUser(session.user.id, {
        novelId: data.novelId,
        chapterIds,
      });

      await Promise.all(result.outboxIds.map(dispatchOutboxBestEffort));

      const cancelledChapterIds = new Set(result.cancelled.map(({ chapterId }) => chapterId));
      return {
        cancelled: result.cancelled,
        skipped: chapterIds.flatMap((chapterId) =>
          cancelledChapterIds.has(chapterId)
            ? []
            : [{ chapterId, reason: "No active translation" as const }],
        ),
      };
    }),
  );

export const retryTranslationJob = createServerFn({ method: "POST" })
  .validator(retryTranslationJobSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      await createProviderClient(session.user.id);

      const retried = await db.transaction(async (tx) => {
        const [row] = await tx
          .select({ job: translationJobs, chapter: chapters, novelId: novels.id })
          .from(translationJobs)
          .innerJoin(chapters, eq(translationJobs.chapterId, chapters.id))
          .innerJoin(novels, eq(chapters.novelId, novels.id))
          .where(and(eq(translationJobs.id, data.jobId), eq(novels.userId, session.user.id)))
          .limit(1)
          .for("update");

        if (!row) throw new SafeServerError("Job not found or unauthorized");
        if (!["error", "cancelled"].includes(row.job.status)) {
          throw new SafeServerError("Job is not retryable");
        }
        if (row.job.sourceRevision !== row.chapter.sourceRevision) {
          throw new SafeServerError("Chapter source changed; start a new translation instead");
        }

        const cancelledJobs = await tx
          .update(translationJobs)
          .set({ status: "cancelled", updatedAt: new Date() })
          .where(
            and(
              eq(translationJobs.chapterId, row.chapter.id),
              sql`${translationJobs.id} != ${row.job.id}`,
              sql`${translationJobs.status} IN ('pending', 'running')`,
            ),
          )
          .returning({ id: translationJobs.id, generation: translationJobs.generation });

        const generation = row.chapter.translationGeneration + 1;
        const logs: LogEntry[] = JSON.parse(row.job.logsJson || "[]");
        logs.push(createLog("info", "Job retry initiated. Resuming from last completed chunk..."));
        await tx
          .update(translationJobChunks)
          .set({ error: null })
          .where(
            and(
              eq(translationJobChunks.jobId, row.job.id),
              gte(translationJobChunks.index, row.job.doneChunks),
            ),
          );
        const updated = await tx
          .update(translationJobs)
          .set({
            status: "pending",
            generation,
            sourceRevision: row.chapter.sourceRevision,
            error: null,
            logsJson: JSON.stringify(logs),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(translationJobs.id, row.job.id),
              sql`${translationJobs.status} IN ('error', 'cancelled')`,
            ),
          )
          .returning({ id: translationJobs.id });
        if (updated.length === 0) throw new SafeServerError("Job is not retryable");

        await tx
          .update(chapters)
          .set({
            status: "queued",
            activeTranslationJobId: row.job.id,
            translationGeneration: generation,
            updatedAt: new Date(),
          })
          .where(eq(chapters.id, row.chapter.id));

        const outboxId = nanoid();
        await tx.insert(translationOutbox).values({
          id: outboxId,
          eventName: "translation/job.requested",
          payloadJson: JSON.stringify({
            jobId: row.job.id,
            novelId: row.novelId,
            generation,
            runKey: nanoid(),
          }),
        });
        if (cancelledJobs.length > 0) {
          await tx.insert(translationOutbox).values(
            cancelledJobs.map((cancelled) => ({
              id: nanoid(),
              eventName: "translation/job.cancelled",
              payloadJson: JSON.stringify(translationRunIdentity(cancelled)),
            })),
          );
        }
        return { jobId: row.job.id, outboxId };
      });

      await dispatchOutboxBestEffort(retried.outboxId);
      return { success: true, jobId: retried.jobId };
    }),
  );
