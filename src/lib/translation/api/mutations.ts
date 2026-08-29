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

      const outboxId = await db.transaction(async (tx) => {
        const [row] = await tx
          .select({ job: translationJobs, chapter: chapters })
          .from(translationJobs)
          .innerJoin(chapters, eq(translationJobs.chapterId, chapters.id))
          .innerJoin(novels, eq(chapters.novelId, novels.id))
          .where(and(eq(translationJobs.id, data.jobId), eq(novels.userId, session.user.id)))
          .limit(1)
          .for("update");

        if (!row) throw new SafeServerError("Job not found or unauthorized");
        if (
          !["pending", "running"].includes(row.job.status) ||
          row.chapter.activeTranslationJobId !== row.job.id
        ) {
          return null;
        }

        const logs: LogEntry[] = JSON.parse(row.job.logsJson || "[]");
        logs.push(createLog("warn", "Job cancelled by user."));
        await tx
          .update(translationJobs)
          .set({ status: "cancelled", logsJson: JSON.stringify(logs), updatedAt: new Date() })
          .where(
            and(
              eq(translationJobs.id, row.job.id),
              sql`${translationJobs.status} IN ('pending', 'running')`,
            ),
          );
        await tx
          .update(chapters)
          .set({
            activeTranslationJobId: null,
            status: row.chapter.translatedContent ? "translated" : "raw",
            updatedAt: new Date(),
          })
          .where(
            and(eq(chapters.id, row.chapter.id), eq(chapters.activeTranslationJobId, row.job.id)),
          );
        const id = nanoid();
        await tx.insert(translationOutbox).values({
          id,
          eventName: "translation/job.cancelled",
          payloadJson: JSON.stringify(translationRunIdentity(row.job)),
        });
        return id;
      });

      if (outboxId) await dispatchOutboxBestEffort(outboxId);

      return { success: true };
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
