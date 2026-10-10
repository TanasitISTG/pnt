import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
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
import {
  getJobsTerminalStatusSchema,
  listActiveJobsSchema,
  translationJobLookupSchema,
} from "./schemas";
import { withSafeHandler } from "@/lib/server-fn-error";
import { parseLogEntries } from "../workflow/log-entry";
import type { SlimChunkProgress } from "../types/api";
import { getNovelCostsForUser } from "../cost-service";
import { findOwnedTranslationJob, findOwnedTranslationJobProgress } from "./job-query.service";

type TranslationJobProviderModelSnapshot = Pick<
  typeof translationJobs.$inferSelect,
  "provider" | "model"
>;

export interface TranslationJobRuntimeDetails {
  provider: string | null;
  model: string;
  isLegacyProviderFallback: boolean;
}

function hasSnapshotValue(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Resolve display metadata without ever exposing provider credentials.
 * Complete snapshots are authoritative; only incomplete legacy snapshots
 * consult the owner's current model setting.
 */
export const resolveTranslationJobRuntime = createServerOnlyFn(
  async (
    snapshot: TranslationJobProviderModelSnapshot,
    loadCurrentModel: () => Promise<string | null | undefined>,
  ): Promise<TranslationJobRuntimeDetails> => {
    if (hasSnapshotValue(snapshot.provider) && hasSnapshotValue(snapshot.model)) {
      return {
        provider: snapshot.provider,
        model: snapshot.model,
        isLegacyProviderFallback: false,
      };
    }

    const currentModel = await loadCurrentModel();
    return {
      provider: null,
      model: hasSnapshotValue(currentModel) ? currentModel : "AI Provider",
      isLegacyProviderFallback: true,
    };
  },
);

export const listActiveTranslationJobs = createServerFn({ method: "GET" })
  .validator(listActiveJobsSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();

      const rows = await db
        .select({
          id: translationJobs.id,
          chapterId: translationJobs.chapterId,
          status: translationJobs.status,
          doneChunks: translationJobs.doneChunks,
          totalChunks: translationJobs.totalChunks,
          error: translationJobs.error,
        })
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

      return rows.map((row) => ({
        id: row.id,
        chapterId: row.chapterId,
        status: row.status,
        doneChunks: row.doneChunks,
        totalChunks: row.totalChunks,
        error: row.error,
      }));
    }),
  );

export const getNovelCosts = createServerFn({ method: "GET" })
  .validator(listActiveJobsSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      return getNovelCostsForUser(session.user.id, data.novelId);
    }),
  );

export const getTranslationJobProgress = createServerFn({ method: "GET" })
  .validator(translationJobLookupSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      const row = await findOwnedTranslationJobProgress(session.user.id, data);
      if (!row) return null;

      return {
        id: row.id,
        chapterId: row.chapterId,
        status: row.status,
        doneChunks: row.doneChunks,
        totalChunks: row.totalChunks,
        error: row.error,
        updatedAt: row.updatedAt,
      };
    }),
  );

export const getTranslationJobDetails = createServerFn({ method: "GET" })
  .validator(translationJobLookupSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      const row = await findOwnedTranslationJob(session.user.id, data);
      if (!row) return null;
      const logs = parseLogEntries(row.job.logsJson);

      const [chunkRows, runtime] = await Promise.all([
        db
          .select()
          .from(translationJobChunks)
          .where(eq(translationJobChunks.jobId, row.job.id))
          .orderBy(asc(translationJobChunks.index)),
        resolveTranslationJobRuntime(row.job, async () => {
          const [settings] = await db
            .select({ model: providerSettings.model })
            .from(providerSettings)
            .where(eq(providerSettings.userId, session.user.id))
            .limit(1);
          return settings?.model;
        }),
      ]);
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
        updatedAt: row.job.updatedAt,
        logs,
        chunks,
        usageJson: row.job.usageJson,
        provider: runtime.provider,
        model: runtime.model,
        isLegacyProviderFallback: runtime.isLegacyProviderFallback,
        inputPricePer1M: row.job.inputPricePer1M,
        outputPricePer1M: row.job.outputPricePer1M,
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
