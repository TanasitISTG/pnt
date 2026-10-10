import "@tanstack/react-start/server-only";

import { and, asc, eq, exists, gt, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { lockNovelForMutation } from "@/lib/db/novel-lock";
import { chapters, glossaryTerms, novels, translationJobs } from "@/lib/db/schema";
import { mapWithConcurrency } from "@/lib/async";
import { SafeServerError } from "@/lib/server-fn-error";
import { dispatchWorkflowOutboxEventBestEffort } from "@/lib/inngest/outbox";
import { cancelActiveTranslationJobsInTransaction } from "@/lib/translation/workflow/cancel";
import { loadApprovedTermsForContext } from "@/lib/translation/workflow/job-store";
import { createProviderClient } from "@/lib/translation/providers/provider-client";
import { retryOperation } from "@/lib/retry";
import { translateChapterTitle } from "@/lib/translation/workflow/title";
import { parseRelationshipMap } from "@/lib/relationships/map";
import { scanResidualScripts } from "@/lib/translation/text/residual";

/** Split items into consecutive fixed-size batches, preserving order. */
export function batchesOf<T>(items: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
}
const RESIDUAL_SCAN_BATCH_SIZE = 100;

export interface ResidualScriptChapter {
  chapterId: string;
  number: string;
  count: number;
}

export async function getResidualScriptChaptersForOwnedNovel(
  novelId: string,
): Promise<ResidualScriptChapter[]> {
  const [novel] = await db
    .select({
      sourceLang: novels.sourceLang,
      targetLang: novels.targetLang,
    })
    .from(novels)
    .where(eq(novels.id, novelId))
    .limit(1);

  if (!novel) {
    throw new SafeServerError("Novel not found or unauthorized");
  }

  const approvedTerms = await db
    .select({ target: glossaryTerms.target })
    .from(glossaryTerms)
    .where(and(eq(glossaryTerms.novelId, novelId), eq(glossaryTerms.status, "approved")));
  const pair = `${novel.sourceLang}->${novel.targetLang}`;
  const protectedTerms = approvedTerms.map((term) => term.target);
  const residualChapters: ResidualScriptChapter[] = [];
  let lastChapterId: string | undefined;

  while (true) {
    const where = lastChapterId
      ? and(
          eq(chapters.novelId, novelId),
          eq(chapters.status, "translated"),
          gt(chapters.id, lastChapterId),
        )
      : and(eq(chapters.novelId, novelId), eq(chapters.status, "translated"));
    const batch = await db
      .select({
        id: chapters.id,
        number: chapters.number,
        rawContent: chapters.rawContent,
        translatedContent: chapters.translatedContent,
      })
      .from(chapters)
      .where(where)
      .orderBy(asc(chapters.id))
      .limit(RESIDUAL_SCAN_BATCH_SIZE);

    if (batch.length === 0) break;
    for (const chapter of batch) {
      if (!chapter.translatedContent) continue;
      const residual = scanResidualScripts(pair, chapter.translatedContent, {
        sourceText: chapter.rawContent,
        protectedTerms,
      });
      if (residual.letterCount > 0) {
        residualChapters.push({
          chapterId: chapter.id,
          number: chapter.number,
          count: residual.letterCount,
        });
      }
    }
    lastChapterId = batch[batch.length - 1].id;
    if (batch.length < RESIDUAL_SCAN_BATCH_SIZE) break;
  }

  return residualChapters;
}
export async function getResidualScriptChaptersForUser(
  userId: string,
  novelId: string,
): Promise<ResidualScriptChapter[]> {
  const [novel] = await db
    .select({ id: novels.id })
    .from(novels)
    .where(and(eq(novels.id, novelId), eq(novels.userId, userId)))
    .limit(1);
  if (!novel) throw new SafeServerError("Novel not found or unauthorized");
  return getResidualScriptChaptersForOwnedNovel(novelId);
}

export async function translateMissingTitlesForUser(
  userId: string,
  novelId: string,
): Promise<{ translated: number }> {
  const [novel] = await db
    .select()
    .from(novels)
    .where(and(eq(novels.id, novelId), eq(novels.userId, userId)))
    .limit(1);

  if (!novel) {
    throw new SafeServerError("Novel not found or unauthorized");
  }

  const missing = await db
    .select({
      id: chapters.id,
      title: chapters.title,
      sourceRevision: chapters.sourceRevision,
      translationGeneration: chapters.translationGeneration,
    })
    .from(chapters)
    .where(
      and(
        eq(chapters.novelId, novelId),
        eq(chapters.status, "translated"),
        isNull(chapters.translatedTitle),
        isNull(chapters.activeTranslationJobId),
      ),
    )
    .orderBy(asc(chapters.number))
    // One serverless request can't hold a big backlog of sequential
    // LLM calls — cap per click; the UI re-clicks for the next batch.
    .limit(20);

  if (missing.length === 0) {
    return { translated: 0 };
  }

  const [providerConfig, approvedTerms] = await Promise.all([
    retryOperation(() => createProviderClient(userId)),
    loadApprovedTermsForContext(novel.id),
  ]);
  const pair = `${novel.sourceLang}->${novel.targetLang}`;
  const relationshipMap = parseRelationshipMap(novel.relationshipMapJson);

  // Small parallel batches: 20 sequential LLM calls is slow, 20 parallel
  // is a provider rate-limit burst. 5 at a time.
  let translated = 0;
  for (const batch of batchesOf(missing, 5)) {
    const results = await Promise.all(
      batch.map(async (chapter) => {
        const { translated: title } = await translateChapterTitle(
          providerConfig,
          pair,
          chapter.title,
          {
            glossaryTerms: approvedTerms,
            customPrompt: novel.customPrompt,
            relationshipMap,
          },
        );
        if (!title) return false;
        return db.transaction(async (tx) => {
          if (!(await lockNovelForMutation(tx, novelId, userId))) return false;
          const written = await tx
            .update(chapters)
            .set({ translatedTitle: title, updatedAt: new Date() })
            .where(
              and(
                eq(chapters.id, chapter.id),
                eq(chapters.novelId, novelId),
                eq(chapters.sourceRevision, chapter.sourceRevision),
                eq(chapters.translationGeneration, chapter.translationGeneration),
                isNull(chapters.translatedTitle),
                isNull(chapters.activeTranslationJobId),
                eq(chapters.status, "translated"),
                exists(
                  tx
                    .select({ id: novels.id })
                    .from(novels)
                    .where(and(eq(novels.id, novelId), eq(novels.userId, userId))),
                ),
              ),
            )
            .returning({ id: chapters.id });
          return written.length === 1;
        });
      }),
    );
    translated += results.filter(Boolean).length;
  }

  return { translated };
}

export async function deleteAllNovelTranslationsForUser(
  userId: string,
  novelId: string,
  dispatch: (outboxId: string) => Promise<void> = dispatchWorkflowOutboxEventBestEffort,
): Promise<{ chaptersCleared: number; jobsCancelled: number }> {
  const result = await db.transaction(async (tx) => {
    const [novel] = await tx
      .select({ id: novels.id, storySummary: novels.storySummary })
      .from(novels)
      .where(and(eq(novels.id, novelId), eq(novels.userId, userId)))
      .limit(1)
      .for("update");

    if (!novel) throw new SafeServerError("Novel not found or unauthorized");

    const novelChapters = await tx
      .select()
      .from(chapters)
      .where(eq(chapters.novelId, novelId))
      .orderBy(asc(chapters.id))
      .for("update");

    const chapterIds = novelChapters.map((chapter) => chapter.id);
    const now = new Date();
    const activeJobs =
      chapterIds.length === 0
        ? []
        : await tx
            .select({
              id: translationJobs.id,
              generation: translationJobs.generation,
              logsJson: translationJobs.logsJson,
            })
            .from(translationJobs)
            .where(
              and(
                inArray(translationJobs.chapterId, chapterIds),
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
        message: "Translation cancelled because all translations were deleted.",
      })),
      now,
    );

    const chaptersToClear = novelChapters.filter(
      (chapter) =>
        chapter.status !== "raw" ||
        chapter.translatedContent !== null ||
        chapter.translatedTitle !== null ||
        chapter.summary !== null ||
        chapter.translatedAt !== null ||
        chapter.editedAt !== null ||
        chapter.activeTranslationJobId !== null,
    );
    if (chaptersToClear.length > 0) {
      await tx
        .update(chapters)
        .set({
          status: "raw",
          translatedContent: null,
          translatedTitle: null,
          summary: null,
          translatedAt: null,
          editedAt: null,
          activeTranslationJobId: null,
          updatedAt: now,
        })
        .where(
          inArray(
            chapters.id,
            chaptersToClear.map((chapter) => chapter.id),
          ),
        );
    }

    if (novel.storySummary !== null) {
      await tx
        .update(novels)
        .set({ storySummary: null, updatedAt: now })
        .where(eq(novels.id, novelId));
    }

    return {
      outboxIds: cancellation.outboxIds,
      chaptersCleared: chaptersToClear.length,
      jobsCancelled: cancellation.cancelledJobs.length,
    };
  });

  await mapWithConcurrency(result.outboxIds, 2, dispatch);
  return {
    chaptersCleared: result.chaptersCleared,
    jobsCancelled: result.jobsCancelled,
  };
}
