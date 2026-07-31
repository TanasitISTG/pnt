import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { eq, and, inArray, sql, desc, asc } from "drizzle-orm";

import { db } from "@/lib/db";
import { mapWithConcurrency } from "@/lib/async";
import {
  novels,
  chapters,
  translationJobs,
  translationOutbox,
  providerSettings,
} from "@/lib/db/schema";
import { ensureSession } from "@/lib/auth.functions";
import { nanoid } from "@/lib/utils";
import { createProviderClient } from "@/lib/translation/provider-client";
import { chunkText } from "@/lib/translation/chunker";
import {
  startTranslationJobSchema,
  startTranslationJobsSchema,
  cancelTranslationJobSchema,
  retryTranslationJobSchema,
  getJobStatusSchema,
  listActiveJobsSchema,
  getJobsTerminalStatusSchema,
} from "@/lib/translation/translation.schemas";
import { withSafeHandler, SafeServerError } from "@/lib/server-fn-error";
import type { ChunkProgress, LogEntry, SlimChunkProgress } from "./translation.types";
import { createLog } from "./log-entry";
import type { AIProviderClient } from "./translation.types";
import { translationRunIdentity } from "./job-state";

export { createLog } from "./log-entry";

const BATCH_ENQUEUE_CONCURRENCY = 2;

const dispatchOutboxBestEffort = createServerOnlyFn(async (outboxId: string) => {
  const { dispatchTranslationOutboxEventBestEffort } = await import("./outbox");
  await dispatchTranslationOutboxEventBestEffort(outboxId);
});

export const enqueueTranslationJob = createServerOnlyFn(async function enqueueTranslationJob(
  userId: string,
  chapterId: string,
  providerConfig: AIProviderClient,
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
      chunksJson: JSON.stringify(initialChunks),
      logsJson: JSON.stringify(logs),
    });
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

  await dispatchOutboxBestEffort(queued.outboxId);
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

      const queued: { chapterId: string; jobId: string; totalChunks: number }[] = [];
      const skipped: { chapterId: string; reason?: string }[] = [];

      const foundIds = new Set(targetChapters.map((ch) => ch.id));
      for (const id of data.chapterIds) {
        if (!foundIds.has(id)) {
          skipped.push({ chapterId: id, reason: "Chapter not found or unauthorized" });
        }
      }

      const enqueueResults = await mapWithConcurrency(
        targetChapters,
        BATCH_ENQUEUE_CONCURRENCY,
        async (chapter) => {
          try {
            const result = await enqueueTranslationJob(session.user.id, chapter.id, providerConfig);
            return {
              type: "queued" as const,
              chapterId: chapter.id,
              jobId: result.jobId,
              totalChunks: result.totalChunks,
            };
          } catch (error) {
            return {
              type: "skipped" as const,
              chapterId: chapter.id,
              reason: error instanceof Error ? error.message : "Failed to start translation",
            };
          }
        },
      );

      for (const result of enqueueResults) {
        if (result.type === "queued") queued.push(result);
        else skipped.push(result);
      }

      return { queued, skipped };
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

export const listActiveTranslationJobs = createServerFn({ method: "GET" })
  .validator(listActiveJobsSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();

      const rows = await db
        .select({ job: translationJobs })
        .from(translationJobs)
        .innerJoin(chapters, eq(translationJobs.chapterId, chapters.id))
        .innerJoin(novels, eq(chapters.novelId, novels.id))
        .where(
          and(
            eq(novels.id, data.novelId),
            eq(novels.userId, session.user.id),
            sql`${translationJobs.status} IN ('pending', 'running')`,
          ),
        )
        .orderBy(desc(translationJobs.createdAt));

      return rows.map((r) => ({
        id: r.job.id,
        chapterId: r.job.chapterId,
        status: r.job.status,
        doneChunks: r.job.doneChunks,
        totalChunks: r.job.totalChunks,
        error: r.job.error,
      }));
    }),
  );

export const getNovelCosts = createServerFn({ method: "GET" })
  .validator(listActiveJobsSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();

      const rows = await db
        .selectDistinctOn([translationJobs.chapterId], {
          chapterId: translationJobs.chapterId,
          usageJson: translationJobs.usageJson,
        })
        .from(translationJobs)
        .innerJoin(chapters, eq(translationJobs.chapterId, chapters.id))
        .innerJoin(novels, eq(chapters.novelId, novels.id))
        .where(
          and(
            eq(novels.id, data.novelId),
            eq(novels.userId, session.user.id),
            eq(translationJobs.status, "done"),
          ),
        )
        .orderBy(translationJobs.chapterId, desc(translationJobs.updatedAt));

      const perChapter: Record<string, { promptTokens: number; completionTokens: number }> = {};
      for (const row of rows) {
        if (!row.usageJson) continue;
        try {
          const usage = JSON.parse(row.usageJson) as {
            totalPromptTokens?: number;
            totalCompletionTokens?: number;
          };
          perChapter[row.chapterId] = {
            promptTokens: usage.totalPromptTokens ?? 0,
            completionTokens: usage.totalCompletionTokens ?? 0,
          };
        } catch {
          // malformed usageJson — skip
        }
      }

      const [settings] = await db
        .select({
          inputPricePer1M: providerSettings.inputPricePer1M,
          outputPricePer1M: providerSettings.outputPricePer1M,
        })
        .from(providerSettings)
        .where(eq(providerSettings.userId, session.user.id))
        .limit(1);

      const hasPrices = settings?.inputPricePer1M != null && settings?.outputPricePer1M != null;
      const costOf = (promptTokens: number, completionTokens: number) =>
        hasPrices
          ? (promptTokens * settings.inputPricePer1M! +
              completionTokens * settings.outputPricePer1M!) /
            1_000_000
          : null;

      const costs: Record<
        string,
        { promptTokens: number; completionTokens: number; cost: number | null }
      > = {};
      let totalPrompt = 0;
      let totalCompletion = 0;
      for (const [chapterId, usage] of Object.entries(perChapter)) {
        costs[chapterId] = { ...usage, cost: costOf(usage.promptTokens, usage.completionTokens) };
        totalPrompt += usage.promptTokens;
        totalCompletion += usage.completionTokens;
      }

      return {
        costs,
        totals: {
          promptTokens: totalPrompt,
          completionTokens: totalCompletion,
          cost: costOf(totalPrompt, totalCompletion),
        },
      };
    }),
  );

export const getTranslationJobStatus = createServerFn({ method: "GET" })
  .validator(getJobStatusSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      const providerConfig = await createProviderClient(session.user.id).catch(() => null);

      const whereCondition = data.jobId
        ? eq(translationJobs.id, data.jobId)
        : data.chapterId
          ? eq(translationJobs.chapterId, data.chapterId)
          : null;

      if (!whereCondition) {
        return null;
      }

      const [row] = await db
        .select({ job: translationJobs, chapter: chapters })
        .from(translationJobs)
        .innerJoin(chapters, eq(translationJobs.chapterId, chapters.id))
        .innerJoin(novels, eq(chapters.novelId, novels.id))
        .where(and(whereCondition, eq(novels.userId, session.user.id)))
        .orderBy(desc(translationJobs.createdAt))
        .limit(1);

      if (!row) {
        return null;
      }

      const logs: LogEntry[] = JSON.parse(row.job.logsJson || "[]");
      // Union: active/errored/cancelled jobs carry full ChunkProgress payloads
      // (needed for resume); done jobs are stripped to SlimChunkProgress.
      const rawChunks: (ChunkProgress & Partial<SlimChunkProgress>)[] = JSON.parse(
        row.job.chunksJson || "[]",
      );
      const chunks: SlimChunkProgress[] = rawChunks.map((c) => ({
        index: c.index,
        textLength: c.textLength ?? c.text?.length ?? 0,
        hasTranslation: c.hasTranslation ?? !!c.translation,
        promptTokens: c.promptTokens,
        completionTokens: c.completionTokens,
        latencyMs: c.latencyMs,
        error: c.error,
      }));

      return {
        id: row.job.id,
        chapterId: row.job.chapterId,
        chapterTitle: row.chapter.title,
        status: row.job.status,
        doneChunks: row.job.doneChunks,
        totalChunks: row.job.totalChunks,
        error: row.job.error,
        logs,
        chunks,
        usageJson: row.job.usageJson,
        model: providerConfig?.model || "AI Provider",
      };
    }),
  );

export const getTranslationJobsTerminalStatus = createServerFn({ method: "GET" })
  .validator(getJobsTerminalStatusSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();

      const rows = await db
        .select({
          id: translationJobs.id,
          chapterId: translationJobs.chapterId,
          status: translationJobs.status,
          error: translationJobs.error,
        })
        .from(translationJobs)
        .innerJoin(chapters, eq(translationJobs.chapterId, chapters.id))
        .innerJoin(novels, eq(chapters.novelId, novels.id))
        .where(and(inArray(translationJobs.id, data.jobIds), eq(novels.userId, session.user.id)));

      return rows.map((r) => ({
        id: r.id,
        chapterId: r.chapterId,
        status: r.status,
        error: r.error,
      }));
    }),
  );
