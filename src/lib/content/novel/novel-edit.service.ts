import "@tanstack/react-start/server-only";

import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { chapters, novels, translationJobs } from "@/lib/db/schema";
import { emptyRelationshipMap, serializeRelationshipMap } from "@/lib/relationships/map";
import { SafeServerError } from "@/lib/server-fn-error";
import { isSupportedLanguagePair } from "@/lib/language-pair";
import { updateNovelSchema, type UpdateNovelInput } from "@/lib/content/novel/novel.schemas";
import { lockNovelForMutation } from "@/lib/db/novel-lock";
import { mapWithConcurrency } from "@/lib/async";
import { dispatchWorkflowOutboxEventBestEffort } from "@/lib/inngest/outbox";
import { cancelActiveTranslationJobsInTransaction } from "@/lib/translation/workflow/cancel";
import { cancelActiveImportsInTransaction } from "@/lib/import/commands";

export async function updateNovelForUser(
  userId: string,
  rawData: UpdateNovelInput,
  coverBuffer?: Uint8Array,
): Promise<{ id: string }> {
  const data = updateNovelSchema.parse(rawData);
  if (data.cover && !coverBuffer) {
    throw new SafeServerError("Cover image data was not validated");
  }

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        id: novels.id,
        sourceLang: novels.sourceLang,
        targetLang: novels.targetLang,
      })
      .from(novels)
      .where(and(eq(novels.id, data.novelId), eq(novels.userId, userId)))
      .limit(1)
      .for("update");

    if (!existing) {
      throw new SafeServerError("Novel not found or unauthorized");
    }

    const nextSourceLang = data.sourceLang ?? existing.sourceLang;
    const nextTargetLang = data.targetLang ?? existing.targetLang;
    const languagePairChanged =
      nextSourceLang !== existing.sourceLang || nextTargetLang !== existing.targetLang;

    if (!isSupportedLanguagePair(nextSourceLang, nextTargetLang)) {
      throw new SafeServerError("Unsupported language pair — use EN→TH, ZH→EN, or ZH→TH");
    }

    if (languagePairChanged) {
      const [activeChapter] = await tx
        .select({ id: chapters.id })
        .from(chapters)
        .where(and(eq(chapters.novelId, data.novelId), isNotNull(chapters.activeTranslationJobId)))
        .limit(1);
      if (activeChapter) {
        throw new SafeServerError("Cancel active translations before changing the language pair");
      }
    }

    const updateValues: Record<string, unknown> = {
      title: data.title,
      originalTitle: data.originalTitle,
      author: data.author,
      description: data.description,
      sourceLang: data.sourceLang,
      targetLang: data.targetLang,
      customPrompt: data.customPrompt,
      updatedAt: new Date(),
    };

    if (languagePairChanged) {
      updateValues.relationshipMapJson = serializeRelationshipMap(emptyRelationshipMap());
    }
    if (data.chunkSize !== undefined) updateValues.chunkSize = data.chunkSize;
    if (data.contextTailLength !== undefined)
      updateValues.contextTailLength = data.contextTailLength;

    if (data.removeCover) {
      updateValues.cover = null;
      updateValues.coverMime = null;
    } else if (coverBuffer) {
      updateValues.cover = coverBuffer;
      updateValues.coverMime = data.coverMime;
    }

    await tx.update(novels).set(updateValues).where(eq(novels.id, data.novelId));
    return { id: data.novelId };
  });
}

export async function deleteNovelForUser(
  userId: string,
  novelId: string,
  dispatch: (outboxId: string) => Promise<void> = dispatchWorkflowOutboxEventBestEffort,
): Promise<{ success: true }> {
  const outboxIds = await db.transaction(async (tx) => {
    if (!(await lockNovelForMutation(tx, novelId, userId))) return [];
    const novelChapters = await tx
      .select({ id: chapters.id })
      .from(chapters)
      .where(eq(chapters.novelId, novelId));
    const chapterIds = novelChapters.map((chapter) => chapter.id);
    const activeJobs =
      chapterIds.length === 0
        ? []
        : await tx
            .select({
              id: translationJobs.id,
              chapterId: translationJobs.chapterId,
              generation: translationJobs.generation,
              logsJson: translationJobs.logsJson,
            })
            .from(translationJobs)
            .innerJoin(chapters, eq(translationJobs.chapterId, chapters.id))
            .where(
              and(
                eq(chapters.novelId, novelId),
                inArray(translationJobs.chapterId, chapterIds),
                inArray(translationJobs.status, ["pending", "running"]),
              ),
            )
            .orderBy(asc(translationJobs.id))
            .for("update", { of: translationJobs });
    const now = new Date();
    const cancellation = await cancelActiveTranslationJobsInTransaction(
      tx,
      activeJobs.map((job) => ({
        jobId: job.id,
        generation: job.generation,
        logsJson: job.logsJson,
        message: "Translation cancelled because the novel was deleted.",
      })),
      now,
    );
    const importOutboxIds = await cancelActiveImportsInTransaction(tx, novelId, now);
    await tx.delete(novels).where(and(eq(novels.id, novelId), eq(novels.userId, userId)));
    return [...cancellation.outboxIds, ...importOutboxIds];
  });
  await mapWithConcurrency(outboxIds, 2, async (outboxId) => {
    try {
      await dispatch(outboxId);
    } catch {
      // Committed cancellation intents remain recoverable after eager delivery failure.
    }
  });
  return { success: true };
}
