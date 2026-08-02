import { createServerFn } from "@tanstack/react-start";
import { desc, eq, sql } from "drizzle-orm";

import { ensureSession } from "@/lib/auth/functions";
import { db } from "@/lib/db";
import {
  chapters,
  importJobs,
  novels,
  translationJobChunks,
  translationJobs,
} from "@/lib/db/schema";
import { withSafeHandler } from "@/lib/server-fn-error";

export const getJobDashboard = createServerFn({ method: "GET" }).handler(async () =>
  withSafeHandler(async () => {
    const session = await ensureSession();

    const [translationRows, importRows, [chunkStats]] = await Promise.all([
      db
        .select({
          id: translationJobs.id,
          status: translationJobs.status,
          totalChunks: translationJobs.totalChunks,
          doneChunks: translationJobs.doneChunks,
          error: translationJobs.error,
          usageJson: translationJobs.usageJson,
          createdAt: translationJobs.createdAt,
          updatedAt: translationJobs.updatedAt,
          chapterId: chapters.id,
          chapterNumber: chapters.number,
          chapterTitle: chapters.title,
          novelId: novels.id,
          novelTitle: novels.title,
        })
        .from(translationJobs)
        .innerJoin(chapters, eq(translationJobs.chapterId, chapters.id))
        .innerJoin(novels, eq(chapters.novelId, novels.id))
        .where(eq(novels.userId, session.user.id))
        .orderBy(desc(translationJobs.updatedAt))
        .limit(25),
      db
        .select({
          id: importJobs.id,
          status: importJobs.status,
          baseUrl: importJobs.baseUrl,
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
        .from(importJobs)
        .innerJoin(novels, eq(importJobs.novelId, novels.id))
        .where(eq(novels.userId, session.user.id))
        .orderBy(desc(importJobs.updatedAt))
        .limit(25),
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
        .where(eq(novels.userId, session.user.id)),
    ]);

    return {
      summary: {
        activeTranslationJobs: translationRows.filter(
          (j) => j.status === "pending" || j.status === "running",
        ).length,
        failedTranslationJobs: translationRows.filter((j) => j.status === "error").length,
        activeImportJobs: importRows.filter((j) => j.status === "pending" || j.status === "running")
          .length,
        failedImportJobs: importRows.filter((j) => j.status === "error").length,
        avgChunkLatencyMs: Number(chunkStats?.avgLatencyMs ?? 0),
        promptTokens: Number(chunkStats?.promptTokens ?? 0),
        completionTokens: Number(chunkStats?.completionTokens ?? 0),
      },
      translationJobs: translationRows,
      importJobs: importRows,
    };
  }),
);
