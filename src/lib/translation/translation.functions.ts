import { createServerFn } from "@tanstack/react-start";
import { eq, and, sql, desc } from "drizzle-orm";

import { db } from "@/lib/db";
import { novels, chapters, translationJobs, providerSettings } from "@/lib/db/schema";
import { ensureSession } from "@/lib/auth.functions";
import { nanoid } from "@/lib/utils";
import { createProviderClient } from "@/lib/translation/provider-client";
import { chunkText } from "@/lib/translation/chunker";
import { inngest } from "@/lib/inngest/client";
import {
  startTranslationJobSchema,
  cancelTranslationJobSchema,
  retryTranslationJobSchema,
  getJobStatusSchema,
  listActiveJobsSchema,
} from "@/lib/translation/translation.schemas";

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
        .set({ status: "cancelled", lockedUntil: null, updatedAt: new Date() })
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
    await inngest.send({ name: "translation/job.requested", data: { jobId, runKey: nanoid() } });

    return { jobId, totalChunks: chunkInfos.length, logs };
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
        lockedUntil: null,
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

    await db
      .update(translationJobs)
      .set({
        status: "pending",
        error: null,
        logsJson: JSON.stringify(logs),
        lockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(translationJobs.id, row.job.id));

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

    const rows = await db
      .select({
        chapterId: translationJobs.chapterId,
        usageJson: translationJobs.usageJson,
        updatedAt: translationJobs.updatedAt,
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
      .orderBy(desc(translationJobs.updatedAt));

    // Rows are newest-first — first occurrence per chapter is the latest done job.
    const perChapter: Record<string, { promptTokens: number; completionTokens: number }> = {};
    for (const row of rows) {
      if (perChapter[row.chapterId] || !row.usageJson) continue;
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
    const chunks: ChunkProgress[] = JSON.parse(row.job.chunksJson || "[]");

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
