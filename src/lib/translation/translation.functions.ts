import { createServerFn } from "@tanstack/react-start";
import { eq, and, inArray, sql, desc } from "drizzle-orm";

import { db } from "@/lib/db";
import { novels, chapters, translationJobs, providerSettings } from "@/lib/db/schema";
import { ensureSession } from "@/lib/auth.functions";
import { nanoid } from "@/lib/utils";
import { createProviderClient } from "@/lib/translation/provider-client";
import { chunkText } from "@/lib/translation/chunker";
import { inngest } from "@/lib/inngest/client";
import {
  startTranslationJobSchema,
  startTranslationJobsSchema,
  cancelTranslationJobSchema,
  retryTranslationJobSchema,
  getJobStatusSchema,
  listActiveJobsSchema,
  getJobsTerminalStatusSchema,
} from "@/lib/translation/translation.schemas";

export interface SlimChunkProgress {
  index: number;
  textLength: number;
  hasTranslation: boolean;
  promptTokens?: number;
  completionTokens?: number;
  latencyMs?: number;
  error?: string;
}

export interface ChunkProgress {
  index: number;
  text: string;
  translation?: string;
  promptTokens?: number;
  completionTokens?: number;
  latencyMs?: number;
  error?: string;
}

export interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error" | "success";
  message: string;
}

export function createLog(level: LogEntry["level"], message: string): LogEntry {
  const time = new Date().toLocaleTimeString("en-US", { hour12: false });
  return { timestamp: time, level, message };
}

export const startTranslationJob = createServerFn({ method: "POST" })
  .validator(startTranslationJobSchema)
  .handler(async ({ data }) => {
    const session = await ensureSession();

    // Verify provider is configured
    const providerConfig = await createProviderClient(session.user.id);

    // Verify chapter ownership & load novel settings
    const [row] = await db
      .select({
        chapter: chapters,
        novel: novels,
      })
      .from(chapters)
      .innerJoin(novels, eq(chapters.novelId, novels.id))
      .where(and(eq(chapters.id, data.chapterId), eq(novels.userId, session.user.id)))
      .limit(1);

    if (!row) {
      throw new Error("Chapter not found or unauthorized");
    }

    const { chapter, novel } = row;

    // Split text into chunks
    const chunkInfos = chunkText(chapter.rawContent, novel.chunkSize || 2000);
    if (chunkInfos.length === 0) {
      throw new Error("Chapter content is empty");
    }

    // Cancel any existing active jobs for this chapter
    const existingJobs = await db
      .select({ id: translationJobs.id })
      .from(translationJobs)
      .where(
        and(
          eq(translationJobs.chapterId, chapter.id),
          sql`${translationJobs.status} IN ('pending', 'running')`,
        ),
      );

    for (const j of existingJobs) {
      await db
        .update(translationJobs)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(translationJobs.id, j.id));
    }

    const initialChunks: ChunkProgress[] = chunkInfos.map((c) => ({
      index: c.index,
      text: c.text,
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

    await db.insert(translationJobs).values({
      id: jobId,
      chapterId: chapter.id,
      status: "pending",
      totalChunks: chunkInfos.length,
      doneChunks: 0,
      chunksJson: JSON.stringify(initialChunks),
      logsJson: JSON.stringify(logs),
    });

    await db
      .update(chapters)
      .set({ status: "queued", updatedAt: new Date() })
      .where(eq(chapters.id, chapter.id));

    // Kick off the Inngest run — chunk 1 starts within seconds.
    try {
      await inngest.send({ name: "translation/job.requested", data: { jobId, runKey: nanoid() } });
    } catch {
      const errorLogs = JSON.stringify([
        ...logs,
        createLog("error", "Inngest dispatch failed — retry this job to re-trigger."),
      ]);
      await db
        .update(translationJobs)
        .set({
          status: "error",
          error: "Inngest dispatch failed",
          logsJson: errorLogs,
          updatedAt: new Date(),
        })
        .where(eq(translationJobs.id, jobId));
      await db
        .update(chapters)
        .set({
          status: sql`CASE WHEN ${chapters.translatedContent} IS NOT NULL THEN 'translated' ELSE 'raw' END`,
          updatedAt: new Date(),
        })
        .where(eq(chapters.id, chapter.id));
    }

    return { jobId, totalChunks: chunkInfos.length, logs };
  });

export const startTranslationJobs = createServerFn({ method: "POST" })
  .validator(startTranslationJobsSchema)
  .handler(async ({ data }) => {
    const session = await ensureSession();

    // Verify provider is configured (single check for the batch)
    const providerConfig = await createProviderClient(session.user.id);

    // Verify novel ownership
    const [novel] = await db
      .select()
      .from(novels)
      .where(and(eq(novels.id, data.novelId), eq(novels.userId, session.user.id)))
      .limit(1);

    if (!novel) {
      throw new Error("Novel not found or unauthorized");
    }

    // Load all requested chapters belonging to this novel (single query)
    const chapterRows = await db
      .select()
      .from(chapters)
      .where(and(eq(chapters.novelId, novel.id), inArray(chapters.id, data.chapterIds)));

    const chapterMap = new Map(chapterRows.map((c) => [c.id, c]));

    // Batch check for existing active jobs across all requested chapters (single query)
    const activeJobRows = await db
      .select({ chapterId: translationJobs.chapterId })
      .from(translationJobs)
      .where(
        and(
          inArray(translationJobs.chapterId, data.chapterIds),
          sql`${translationJobs.status} IN ('pending', 'running')`,
        ),
      );
    const chaptersWithActiveJobs = new Set(activeJobRows.map((r) => r.chapterId));

    const queued: { chapterId: string; jobId: string; totalChunks: number }[] = [];
    const skipped: { chapterId: string; reason: string }[] = [];
    const jobInserts: Array<{
      id: string;
      chapterId: string;
      status: "pending";
      totalChunks: number;
      doneChunks: number;
      chunksJson: string;
      logsJson: string;
    }> = [];
    const chapterIdsToQueue: string[] = [];
    const inngestEvents: Array<{ name: string; data: { jobId: string; runKey: string } }> = [];

    for (const chapterId of data.chapterIds) {
      const chapter = chapterMap.get(chapterId);
      if (!chapter) {
        skipped.push({ chapterId, reason: "Chapter not found" });
        continue;
      }

      if (!chapter.rawContent || chapter.rawContent.trim().length === 0) {
        skipped.push({ chapterId, reason: "Chapter content is empty" });
        continue;
      }

      if (chaptersWithActiveJobs.has(chapterId)) {
        skipped.push({ chapterId, reason: "Translation already in progress" });
        continue;
      }

      const chunkInfos = chunkText(chapter.rawContent, novel.chunkSize || 2000);
      if (chunkInfos.length === 0) {
        skipped.push({ chapterId, reason: "Chapter content could not be chunked" });
        continue;
      }

      const initialChunks: ChunkProgress[] = chunkInfos.map((c) => ({
        index: c.index,
        text: c.text,
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

      jobInserts.push({
        id: jobId,
        chapterId: chapter.id,
        status: "pending",
        totalChunks: chunkInfos.length,
        doneChunks: 0,
        chunksJson: JSON.stringify(initialChunks),
        logsJson: JSON.stringify(logs),
      });

      chapterIdsToQueue.push(chapter.id);

      inngestEvents.push({
        name: "translation/job.requested",
        data: { jobId, runKey: nanoid() },
      });

      queued.push({ chapterId, jobId, totalChunks: chunkInfos.length });
    }

    // DB-first: insert jobs and update chapters before dispatching events.
    // Wrapped in try/catch so a partial failure (insert ok, update fail)
    // cleans up the inserted jobs instead of stranding them as pending.
    const jobIds = jobInserts.map((j) => j.id);
    if (jobInserts.length > 0) {
      try {
        await db.insert(translationJobs).values(jobInserts);
        await db
          .update(chapters)
          .set({ status: "queued", updatedAt: new Date() })
          .where(inArray(chapters.id, chapterIdsToQueue));
      } catch (dbErr) {
        // Best-effort cleanup: delete any jobs that were inserted before the
        // failure. If the insert itself failed this is a harmless no-op.
        try {
          await db.delete(translationJobs).where(inArray(translationJobs.id, jobIds));
        } catch {
          // Cleanup failed — throw original error so the caller sees it.
        }
        throw dbErr;
      }
    }

    // Dispatch Inngest events. On failure, mark new jobs error so the UI can
    // retry them; chapters revert to their pre-queue status.
    if (inngestEvents.length > 0) {
      try {
        await inngest.send(inngestEvents);
      } catch {
        const errorLog = JSON.stringify([
          createLog("error", "Inngest dispatch failed — retry this job to re-trigger."),
        ]);
        await db
          .update(translationJobs)
          .set({
            status: "error",
            error: "Inngest dispatch failed",
            logsJson: errorLog,
            updatedAt: new Date(),
          })
          .where(inArray(translationJobs.id, jobIds));
        await db
          .update(chapters)
          .set({
            status: sql`CASE WHEN ${chapters.translatedContent} IS NOT NULL THEN 'translated' ELSE 'raw' END`,
            updatedAt: new Date(),
          })
          .where(inArray(chapters.id, chapterIdsToQueue));
      }
    }

    return { queued, skipped };
  });

export const cancelTranslationJob = createServerFn({ method: "POST" })
  .validator(cancelTranslationJobSchema)
  .handler(async ({ data }) => {
    const session = await ensureSession();

    const [row] = await db
      .select({
        job: translationJobs,
        chapter: chapters,
      })
      .from(translationJobs)
      .innerJoin(chapters, eq(translationJobs.chapterId, chapters.id))
      .innerJoin(novels, eq(chapters.novelId, novels.id))
      .where(and(eq(translationJobs.id, data.jobId), eq(novels.userId, session.user.id)))
      .limit(1);

    if (!row) {
      throw new Error("Job not found or unauthorized");
    }

    const logs: LogEntry[] = JSON.parse(row.job.logsJson || "[]");
    logs.push(createLog("warn", "Job cancelled by user."));

    await db
      .update(translationJobs)
      .set({
        status: "cancelled",
        logsJson: JSON.stringify(logs),
        updatedAt: new Date(),
      })
      .where(eq(translationJobs.id, row.job.id));

    const newStatus = row.chapter.translatedContent ? "translated" : "raw";
    await db
      .update(chapters)
      .set({ status: newStatus, updatedAt: new Date() })
      .where(eq(chapters.id, row.chapter.id));

    // Best-effort: DB status is the real cancel — worker steps re-check it;
    // the event just stops the Inngest run sooner (between steps).
    try {
      await inngest.send({ name: "translation/job.cancelled", data: { jobId: row.job.id } });
    } catch {
      // Inngest unreachable — the status check in each step still stops the job.
    }

    return { success: true };
  });

export const retryTranslationJob = createServerFn({ method: "POST" })
  .validator(retryTranslationJobSchema)
  .handler(async ({ data }) => {
    const session = await ensureSession();

    const [row] = await db
      .select({
        job: translationJobs,
        chapter: chapters,
      })
      .from(translationJobs)
      .innerJoin(chapters, eq(translationJobs.chapterId, chapters.id))
      .innerJoin(novels, eq(chapters.novelId, novels.id))
      .where(and(eq(translationJobs.id, data.jobId), eq(novels.userId, session.user.id)))
      .limit(1);

    if (!row) {
      throw new Error("Job not found or unauthorized");
    }

    const logs: LogEntry[] = JSON.parse(row.job.logsJson || "[]");
    logs.push(createLog("info", "Job retry initiated. Resuming from last completed chunk..."));

    const updated = await db
      .update(translationJobs)
      .set({
        status: "pending",
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

    if (updated.length === 0) {
      throw new Error("Job is not retryable");
    }

    await db
      .update(chapters)
      .set({ status: "queued", updatedAt: new Date() })
      .where(eq(chapters.id, row.chapter.id));

    await inngest.send({
      name: "translation/job.requested",
      data: { jobId: row.job.id, runKey: nanoid() },
    });

    return { success: true, jobId: row.job.id };
  });

export const listActiveTranslationJobs = createServerFn({ method: "GET" })
  .validator(listActiveJobsSchema)
  .handler(async ({ data }) => {
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
  });

// P8.3 — per-chapter token usage + cost from the latest done job per chapter.
export const getNovelCosts = createServerFn({ method: "GET" })
  .validator(listActiveJobsSchema)
  .handler(async ({ data }) => {
    const session = await ensureSession();

    // One row per chapter (latest done job) — DISTINCT ON pushes the dedupe to
    // Postgres instead of scanning the whole done-job history and deduping in JS.
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
        // malformed usageJson — skip this chapter
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
  });

export const getTranslationJobStatus = createServerFn({ method: "GET" })
  .validator(getJobStatusSchema)
  .handler(async ({ data }) => {
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
    const rawChunks: ChunkProgress[] = JSON.parse(row.job.chunksJson || "[]");
    const chunks: SlimChunkProgress[] = rawChunks.map((c) => ({
      index: c.index,
      textLength: c.text?.length ?? 0,
      hasTranslation: !!c.translation,
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
  });

export const getTranslationJobsTerminalStatus = createServerFn({ method: "GET" })
  .validator(getJobsTerminalStatusSchema)
  .handler(async ({ data }) => {
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
  });
