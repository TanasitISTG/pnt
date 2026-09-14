import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { eq, and, inArray, sql, asc, gte, desc } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  novels,
  chapters,
  translationJobs,
  translationJobChunks,
  workflowOutbox,
  providerSettings,
} from "@/lib/db/schema";
import { ensureSession } from "@/lib/auth/functions";
import { nanoid } from "@/lib/utils";
import { loadProviderRuntime } from "@/lib/translation/providers/provider-client";
import { chunkText } from "@/lib/translation/text/chunker";
import {
  startTranslationJobSchema,
  startTranslationJobsSchema,
  previewTranslationBatchSchema,
  cancelTranslationJobSchema,
  cancelTranslationJobsSchema,
  retryTranslationJobSchema,
} from "./schemas";
import { withSafeHandler, SafeServerError } from "@/lib/server-fn-error";
import type { ChunkProgress, LogEntry } from "../types/workflow";
import { appendLogEntry, createLog, serializeLogEntries } from "../workflow/log-entry";
import type { AIProviderClient } from "../types/provider";
import type { TranslationBatchPreview } from "../types/api";
import { calculateTokenCost } from "../cost";
import { enqueueTranslationBatchInOrder } from "./batch";
import type { TranslationStartMode } from "./schemas";
import { cancelActiveTranslationJobsInTransaction } from "../workflow/cancel";
const dispatchOutboxBestEffort = createServerOnlyFn(async (outboxId: string) => {
  const { dispatchWorkflowOutboxEventBestEffort } = await import("@/lib/inngest/outbox");
  await dispatchWorkflowOutboxEventBestEffort(outboxId);
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
    const now = new Date();
    const cancellation = await cancelActiveTranslationJobsInTransaction(
      tx,
      candidates.map(({ job }) => ({
        jobId: job.id,
        generation: job.generation,
        logsJson: job.logsJson,
      })),
      now,
    );
    const cancelledJobIds = new Set(cancellation.cancelledJobs.map((job) => job.jobId));
    const cancelled: Array<{ chapterId: string; jobId: string }> = [];

    for (const { job, chapter } of candidates) {
      if (!cancelledJobIds.has(job.id)) continue;
      await tx
        .update(chapters)
        .set({
          activeTranslationJobId: null,
          status: chapter.translatedContent?.trim() ? "translated" : "raw",
          updatedAt: now,
        })
        .where(and(eq(chapters.id, chapter.id), eq(chapters.activeTranslationJobId, job.id)));
      cancelled.push({ chapterId: chapter.id, jobId: job.id });
    }

    return {
      matchedJobIds,
      cancelled,
      outboxIds: cancellation.outboxIds,
    };
  });
}

export const enqueueTranslationJob = createServerOnlyFn(async function enqueueTranslationJob(
  userId: string,
  chapterId: string,
  providerConfig: AIProviderClient,
  mode: TranslationStartMode,
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
    const hasTranslation = Boolean(chapter.translatedContent?.trim());
    if (mode === "missing" && hasTranslation) {
      throw new SafeServerError(
        "Chapter already has a translation; choose re-translate to overwrite it",
      );
    }
    const chunkInfos = chunkText(chapter.rawContent, novel.chunkSize || 2000);
    if (chunkInfos.length === 0) throw new SafeServerError("Chapter content is empty");

    const activeJobs = await tx
      .select({
        id: translationJobs.id,
        generation: translationJobs.generation,
        logsJson: translationJobs.logsJson,
      })
      .from(translationJobs)
      .where(
        and(
          eq(translationJobs.chapterId, chapter.id),
          sql`${translationJobs.status} IN ('pending', 'running')`,
        ),
      )
      .for("update");
    const cancellation = await cancelActiveTranslationJobsInTransaction(
      tx,
      activeJobs.map((job) => ({
        jobId: job.id,
        generation: job.generation,
        logsJson: job.logsJson,
        message: "Translation cancelled because a newer translation was started.",
      })),
    );

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
      logsJson: serializeLogEntries(logs),
      overwriteExisting: mode === "overwrite",
      provider: providerConfig.provider,
      model: providerConfig.model,
      fastModel: providerConfig.fastModel ?? null,
      sourceCharCount: chapter.rawCharCount,
      inputPricePer1M: providerConfig.inputPricePer1M ?? null,
      outputPricePer1M: providerConfig.outputPricePer1M ?? null,
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
    await tx.insert(workflowOutbox).values({
      id: outboxId,
      eventName: "translation/job.requested",
      payloadJson: JSON.stringify({ jobId, novelId: novel.id, generation, runKey }),
    });

    return {
      jobId,
      outboxIds: [outboxId, ...cancellation.outboxIds],
      totalChunks: chunkInfos.length,
    };
  });

  await Promise.all(queued.outboxIds.map(dispatch));
  return { jobId: queued.jobId, totalChunks: queued.totalChunks };
});

type PreviewUsage = {
  promptTokens: number;
  completionTokens: number;
};

function parsePreviewUsage(value: string | null): PreviewUsage | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const promptTokens = record.totalPromptTokens;
    const completionTokens = record.totalCompletionTokens;
    if (
      typeof promptTokens !== "number" ||
      !Number.isFinite(promptTokens) ||
      promptTokens < 0 ||
      typeof completionTokens !== "number" ||
      !Number.isFinite(completionTokens) ||
      completionTokens < 0
    ) {
      return null;
    }
    return { promptTokens, completionTokens };
  } catch {
    return null;
  }
}

export const previewTranslationBatch = createServerFn({ method: "POST" })
  .validator(previewTranslationBatchSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      const [chapterRows, settingsRows, sampleRows] = await Promise.all([
        db
          .select({
            id: chapters.id,
            rawCharCount: chapters.rawCharCount,
            status: chapters.status,
            translatedContent: chapters.translatedContent,
            activeTranslationJobId: chapters.activeTranslationJobId,
            editedAt: chapters.editedAt,
          })
          .from(chapters)
          .innerJoin(novels, eq(chapters.novelId, novels.id))
          .where(
            and(
              eq(chapters.novelId, data.novelId),
              eq(novels.userId, session.user.id),
              inArray(chapters.id, data.chapterIds),
            ),
          ),
        db
          .select({
            inputPricePer1M: providerSettings.inputPricePer1M,
            outputPricePer1M: providerSettings.outputPricePer1M,
          })
          .from(providerSettings)
          .where(eq(providerSettings.userId, session.user.id))
          .limit(1),
        db
          .select({
            sourceCharCount: translationJobs.sourceCharCount,
            usageJson: translationJobs.usageJson,
          })
          .from(translationJobs)
          .innerJoin(chapters, eq(translationJobs.chapterId, chapters.id))
          .innerJoin(novels, eq(chapters.novelId, novels.id))
          .where(
            and(
              eq(chapters.novelId, data.novelId),
              eq(novels.userId, session.user.id),
              eq(translationJobs.status, "done"),
            ),
          )
          .orderBy(desc(translationJobs.updatedAt))
          .limit(20),
      ]);

      const chaptersById = new Map(chapterRows.map((chapter) => [chapter.id, chapter]));
      const eligibleIds: string[] = [];
      const skipped: TranslationBatchPreview["skipped"] = [];
      let rawCharacterTotal = 0;
      let existingTranslationCount = 0;
      let manualEditCount = 0;
      let activeCount = 0;

      for (const chapterId of data.chapterIds) {
        const chapter = chaptersById.get(chapterId);
        if (!chapter) {
          skipped.push({ id: chapterId, reason: "not-found" });
          continue;
        }
        const hasTranslation = Boolean(chapter.translatedContent?.trim());
        const isActive =
          Boolean(chapter.activeTranslationJobId) ||
          chapter.status === "queued" ||
          chapter.status === "translating";
        if (hasTranslation) existingTranslationCount++;
        if (chapter.editedAt) manualEditCount++;
        if (isActive) activeCount++;

        if (isActive) {
          skipped.push({ id: chapterId, reason: "active" });
        } else if (data.mode === "missing" && hasTranslation) {
          skipped.push({ id: chapterId, reason: "already-translated" });
        } else if (chapter.rawCharCount <= 0) {
          skipped.push({ id: chapterId, reason: "empty" });
        } else {
          eligibleIds.push(chapterId);
          rawCharacterTotal += chapter.rawCharCount;
        }
      }

      const sampleTotals = sampleRows.reduce(
        (totals, row) => {
          const usage = parsePreviewUsage(row.usageJson);
          const sourceCharCount = row.sourceCharCount ?? 0;
          if (!usage || sourceCharCount <= 0) return totals;
          return {
            promptTokens: totals.promptTokens + usage.promptTokens,
            completionTokens: totals.completionTokens + usage.completionTokens,
            sourceCharCount: totals.sourceCharCount + sourceCharCount,
            sampleSize: totals.sampleSize + 1,
          };
        },
        { promptTokens: 0, completionTokens: 0, sourceCharCount: 0, sampleSize: 0 },
      );
      const settings = settingsRows[0];
      const estimate =
        rawCharacterTotal > 0 && sampleTotals.sampleSize >= 3
          ? {
              sampleSize: sampleTotals.sampleSize,
              promptTokens: Math.ceil(
                (rawCharacterTotal * sampleTotals.promptTokens) / sampleTotals.sourceCharCount,
              ),
              completionTokens: Math.ceil(
                (rawCharacterTotal * sampleTotals.completionTokens) / sampleTotals.sourceCharCount,
              ),
              cost: null as number | null,
            }
          : null;
      if (estimate) {
        estimate.cost = calculateTokenCost(
          estimate.promptTokens,
          estimate.completionTokens,
          settings?.inputPricePer1M,
          settings?.outputPricePer1M,
        );
      }

      return {
        eligibleIds,
        skipped,
        rawCharacterTotal,
        existingTranslationCount,
        manualEditCount,
        activeCount,
        estimate,
      } satisfies TranslationBatchPreview;
    }),
  );

export const startTranslationJob = createServerFn({ method: "POST" })
  .validator(startTranslationJobSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();

      const { client: providerConfig } = await loadProviderRuntime(session.user.id);
      return enqueueTranslationJob(session.user.id, data.chapterId, providerConfig, data.mode);
    }),
  );

export const startTranslationJobs = createServerFn({ method: "POST" })
  .validator(startTranslationJobsSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      const [{ client: providerConfig }, targetChapters] = await Promise.all([
        loadProviderRuntime(session.user.id),
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
        enqueueTranslationJob(session.user.id, chapterId, providerConfig, data.mode),
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
      await loadProviderRuntime(session.user.id);

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
        if (!row.job.overwriteExisting && row.chapter.translatedContent?.trim()) {
          throw new SafeServerError(
            "Chapter already has a translation; choose re-translate to overwrite it",
          );
        }

        const activeJobs = await tx
          .select({
            id: translationJobs.id,
            generation: translationJobs.generation,
            logsJson: translationJobs.logsJson,
          })
          .from(translationJobs)
          .where(
            and(
              eq(translationJobs.chapterId, row.chapter.id),
              sql`${translationJobs.id} != ${row.job.id}`,
              sql`${translationJobs.status} IN ('pending', 'running')`,
            ),
          )
          .for("update");
        const cancellation = await cancelActiveTranslationJobsInTransaction(
          tx,
          activeJobs.map((job) => ({
            jobId: job.id,
            generation: job.generation,
            logsJson: job.logsJson,
            message: "Translation cancelled because a retry was started.",
          })),
        );

        const generation = row.chapter.translationGeneration + 1;
        const logsJson = appendLogEntry(
          row.job.logsJson,
          createLog("info", "Job retry initiated. Resuming from last completed chunk..."),
        );
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
            logsJson,
            error: null,
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
        await tx.insert(workflowOutbox).values({
          id: outboxId,
          eventName: "translation/job.requested",
          payloadJson: JSON.stringify({
            jobId: row.job.id,
            novelId: row.novelId,
            generation,
            runKey: nanoid(),
          }),
        });
        return {
          jobId: row.job.id,
          outboxIds: [outboxId, ...cancellation.outboxIds],
        };
      });

      await Promise.all(retried.outboxIds.map(dispatchOutboxBestEffort));
      return { success: true, jobId: retried.jobId };
    }),
  );
