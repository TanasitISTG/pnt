import { createServerFn } from "@tanstack/react-start";
import { eq, and, inArray, sql, desc, asc } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  novels,
  chapters,
  translationJobs,
  translationJobChunks,
  providerSettings,
} from "@/lib/db/schema";
import { ensureSession } from "@/lib/auth/functions";
import { createProviderClient } from "@/lib/translation/providers/provider-client";
import { getJobStatusSchema, listActiveJobsSchema, getJobsTerminalStatusSchema } from "./schemas";
import { withSafeHandler } from "@/lib/server-fn-error";
import type { LogEntry } from "../types/workflow";
import type { NovelCostData, SlimChunkProgress } from "../types/api";

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

      const costs: NovelCostData["costs"] = {};
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
      } satisfies NovelCostData;
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
      const chunkRows = await db
        .select()
        .from(translationJobChunks)
        .where(eq(translationJobChunks.jobId, row.job.id))
        .orderBy(asc(translationJobChunks.index));
      const chunks: SlimChunkProgress[] = chunkRows.map((chunk) => ({
        index: chunk.index,
        textLength: chunk.textLength,
        hasTranslation: chunk.translation !== null,
        promptTokens: chunk.promptTokens ?? undefined,
        completionTokens: chunk.completionTokens ?? undefined,
        latencyMs: chunk.latencyMs ?? undefined,
        error: chunk.error ?? undefined,
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
