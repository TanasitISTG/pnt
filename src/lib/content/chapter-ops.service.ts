import "@tanstack/react-start/server-only";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { chapters, novels, translationJobs, translationOutbox } from "@/lib/db/schema";
import { mapWithConcurrency } from "@/lib/async";
import { SafeServerError } from "@/lib/server-fn-error";
import { nanoid } from "@/lib/utils";
import { dispatchTranslationOutboxEventBestEffort } from "@/lib/translation/workflow/outbox";
import { translationRunIdentity } from "@/lib/translation/workflow/job-state";
import { loadApprovedTermsForContext } from "@/lib/translation/workflow/job-store";
import { createProviderClient } from "@/lib/translation/providers/provider-client";
import { retryTranslationOperation } from "@/lib/translation/workflow/retry";
import { translateChapterTitle } from "@/lib/translation/workflow/title";
import { parseRelationshipMap } from "@/lib/relationships/map";

/** Split items into consecutive fixed-size batches, preserving order. */
export function batchesOf<T>(items: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
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
    .select({ id: chapters.id, title: chapters.title })
    .from(chapters)
    .where(
      and(
        eq(chapters.novelId, novelId),
        eq(chapters.status, "translated"),
        isNull(chapters.translatedTitle),
      ),
    )
    .orderBy(asc(sql`COALESCE(${chapters.number}::numeric, 0)`))
    // One serverless request can't hold a big backlog of sequential
    // LLM calls — cap per click; the UI re-clicks for the next batch.
    .limit(20);

  if (missing.length === 0) {
    return { translated: 0 };
  }

  const [providerConfig, approvedTerms] = await Promise.all([
    retryTranslationOperation(() => createProviderClient(userId)),
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
        await db
          .update(chapters)
          .set({ translatedTitle: title, updatedAt: new Date() })
          .where(eq(chapters.id, chapter.id));
        return true;
      }),
    );
    translated += results.filter(Boolean).length;
  }

  return { translated };
}

export async function deleteAllNovelTranslationsForUser(
  userId: string,
  novelId: string,
  dispatch: (outboxId: string) => Promise<void> = dispatchTranslationOutboxEventBestEffort,
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
    const cancelledJobs =
      chapterIds.length === 0
        ? []
        : await tx
            .update(translationJobs)
            .set({ status: "cancelled", updatedAt: now })
            .where(
              and(
                inArray(translationJobs.chapterId, chapterIds),
                sql`${translationJobs.status} IN ('pending', 'running')`,
              ),
            )
            .returning({ id: translationJobs.id, generation: translationJobs.generation });

    const cancellationOutboxRows = cancelledJobs.map((job) => ({
      id: nanoid(),
      eventName: "translation/job.cancelled",
      payloadJson: JSON.stringify(translationRunIdentity(job)),
    }));
    if (cancellationOutboxRows.length > 0) {
      await tx.insert(translationOutbox).values(cancellationOutboxRows);
    }

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
      outboxIds: cancellationOutboxRows.map((row) => row.id),
      chaptersCleared: chaptersToClear.length,
      jobsCancelled: cancelledJobs.length,
    };
  });

  await mapWithConcurrency(result.outboxIds, 2, dispatch);
  return {
    chaptersCleared: result.chaptersCleared,
    jobsCancelled: result.jobsCancelled,
  };
}
