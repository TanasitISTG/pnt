import "@tanstack/react-start/server-only";
import { desc, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  chapters,
  importJobs,
  novels,
  translationJobChunks,
  translationJobs,
} from "@/lib/db/schema";
import { normalizeJobStats, summarizeJobActivity } from "@/lib/job-observability";
import type { ServerTiming } from "@/lib/server-timing";

async function loadRecentTranslationJobs(userId: string) {
  const recentJobs = db
    .select({
      id: translationJobs.id,
      updatedAt: translationJobs.updatedAt,
    })
    .from(translationJobs)
    .innerJoin(chapters, eq(translationJobs.chapterId, chapters.id))
    .innerJoin(novels, eq(chapters.novelId, novels.id))
    .where(eq(novels.userId, userId))
    .orderBy(desc(translationJobs.updatedAt))
    .limit(25)
    .as("recent_translation_jobs");

  return db
    .select({
      id: translationJobs.id,
      status: translationJobs.status,
      totalChunks: translationJobs.totalChunks,
      doneChunks: translationJobs.doneChunks,
      error: translationJobs.error,
      createdAt: translationJobs.createdAt,
      updatedAt: translationJobs.updatedAt,
      chapterId: chapters.id,
      chapterNumber: chapters.number,
      chapterTitle: chapters.title,
      novelId: novels.id,
      novelTitle: novels.title,
    })
    .from(recentJobs)
    .innerJoin(translationJobs, eq(recentJobs.id, translationJobs.id))
    .innerJoin(chapters, eq(translationJobs.chapterId, chapters.id))
    .innerJoin(novels, eq(chapters.novelId, novels.id))
    .where(eq(novels.userId, userId))
    .orderBy(desc(recentJobs.updatedAt));
}

async function loadRecentImportJobs(userId: string) {
  const recentJobs = db
    .select({
      id: importJobs.id,
      updatedAt: importJobs.updatedAt,
    })
    .from(importJobs)
    .innerJoin(novels, eq(importJobs.novelId, novels.id))
    .where(eq(novels.userId, userId))
    .orderBy(desc(importJobs.updatedAt))
    .limit(25)
    .as("recent_import_jobs");

  return db
    .select({
      id: importJobs.id,
      kind: importJobs.kind,
      status: importJobs.status,
      baseUrl: importJobs.baseUrl,
      sourceFileName: importJobs.sourceFileName,
      fromNumber: importJobs.fromNumber,
      toNumber: importJobs.toNumber,
      nextNumber: importJobs.nextNumber,
      scrapeProvider: importJobs.scrapeProvider,
      added: importJobs.added,
      skipped: importJobs.skipped,
      failed: importJobs.failed,
      error: importJobs.error,
      createdAt: importJobs.createdAt,
      updatedAt: importJobs.updatedAt,
      novelId: novels.id,
      novelTitle: novels.title,
    })
    .from(recentJobs)
    .innerJoin(importJobs, eq(recentJobs.id, importJobs.id))
    .innerJoin(novels, eq(importJobs.novelId, novels.id))
    .where(eq(novels.userId, userId))
    .orderBy(desc(recentJobs.updatedAt));
}

export async function loadJobActivity(userId: string, timing: ServerTiming) {
  const [translationRows, importRows] = await Promise.all([
    timing.measure("translation-jobs", () => loadRecentTranslationJobs(userId)),
    timing.measure("import-jobs", () => loadRecentImportJobs(userId)),
  ]);

  return {
    summary: summarizeJobActivity(translationRows, importRows),
    translationJobs: translationRows,
    importJobs: importRows,
  };
}

export async function loadJobStats(userId: string, timing: ServerTiming) {
  const [chunkStats] = await timing.measure("chunk-stats", () =>
    db
      .select({
        avgLatencyMs: sql<number>`COALESCE(ROUND(AVG(${translationJobChunks.latencyMs})), 0)::int`,
        promptTokens: sql<number>`COALESCE(SUM(${translationJobChunks.promptTokens}), 0)::int`,
        completionTokens: sql<number>`COALESCE(SUM(${translationJobChunks.completionTokens}), 0)::int`,
      })
      .from(translationJobChunks)
      .innerJoin(translationJobs, eq(translationJobChunks.jobId, translationJobs.id))
      .innerJoin(chapters, eq(translationJobs.chapterId, chapters.id))
      .innerJoin(novels, eq(chapters.novelId, novels.id))
      .where(eq(novels.userId, userId)),
  );

  return normalizeJobStats(chunkStats);
}
