import "@tanstack/react-start/server-only";

import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { chapters, novels, translationJobs } from "@/lib/db/schema";
import { emptyRelationshipMap, serializeRelationshipMap } from "@/lib/relationships/map";
import { SafeServerError } from "@/lib/server-fn-error";
import { encodeMessage } from "@/lib/i18n/message-code";
import { isSupportedLanguagePair } from "@/lib/language-pair";
import { updateNovelSchema, type UpdateNovelInput } from "@/lib/content/novel/novel.schemas";
import { deleteCoverSet, writeCoverSet } from "@/lib/content/novel/cover-storage.server";
import { resolveAuthorId } from "@/lib/content/novel/author.service.server";
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
    throw new SafeServerError(encodeMessage("errors.coverNotValidated"));
  }

  // The canonical author is resolved before the transaction, like the cover objects: the
  // upsert is idempotent, and a merge can clean up a row no novel ends up naming.
  const authorChanged = data.author !== undefined;
  const resolvedAuthorId = authorChanged ? await resolveAuthorId(data.author) : undefined;

  // Object storage stays outside the transaction: the row lock only covers the
  // metadata write, and a failed commit deletes the freshly written objects.
  const nextCoverKey =
    coverBuffer && !data.removeCover
      ? await writeCoverSet(data.novelId, coverBuffer, data.coverMime ?? "image/webp")
      : null;

  let previousCoverKey: string | null = null;
  let result: { id: string };
  try {
    result = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({
          id: novels.id,
          sourceLang: novels.sourceLang,
          targetLang: novels.targetLang,
          coverKey: novels.coverKey,
        })
        .from(novels)
        .where(and(eq(novels.id, data.novelId), eq(novels.userId, userId)))
        .limit(1)
        .for("update");

      if (!existing) {
        throw new SafeServerError(encodeMessage("errors.novelNotFoundOrUnauthorized"));
      }

      const nextSourceLang = data.sourceLang ?? existing.sourceLang;
      const nextTargetLang = data.targetLang ?? existing.targetLang;
      const languagePairChanged =
        nextSourceLang !== existing.sourceLang || nextTargetLang !== existing.targetLang;

      if (!isSupportedLanguagePair(nextSourceLang, nextTargetLang)) {
        throw new SafeServerError(encodeMessage("validation.languagePairUnsupported"));
      }

      if (languagePairChanged) {
        const [activeChapter] = await tx
          .select({ id: chapters.id })
          .from(chapters)
          .where(
            and(eq(chapters.novelId, data.novelId), isNotNull(chapters.activeTranslationJobId)),
          )
          .limit(1);
        if (activeChapter) {
          throw new SafeServerError(encodeMessage("errors.languagePairNeedsCancel"));
        }
      }

      const updateValues: Record<string, unknown> = {
        title: data.title,
        originalTitle: data.originalTitle,
        description: data.description,
        sourceLang: data.sourceLang,
        targetLang: data.targetLang,
        customPrompt: data.customPrompt,
        updatedAt: new Date(),
      };

      // Both columns move together: an author that changed keeps its text and its identity
      // in step, and clearing the text clears the identity with it.
      if (authorChanged) {
        updateValues.author = data.author;
        updateValues.authorId = resolvedAuthorId;
      }

      if (languagePairChanged) {
        updateValues.relationshipMapJson = serializeRelationshipMap(emptyRelationshipMap());
      }
      if (data.chunkSize !== undefined) updateValues.chunkSize = data.chunkSize;
      if (data.contextTailLength !== undefined)
        updateValues.contextTailLength = data.contextTailLength;

      previousCoverKey = existing.coverKey;
      if (data.removeCover) {
        updateValues.coverKey = null;
        updateValues.coverMime = null;
      } else if (nextCoverKey) {
        updateValues.coverKey = nextCoverKey;
        updateValues.coverMime = data.coverMime ?? null;
      }

      await tx.update(novels).set(updateValues).where(eq(novels.id, data.novelId));
      return { id: data.novelId };
    });
  } catch (error) {
    await deleteCoverSet(nextCoverKey).catch(() => {});
    throw error;
  }

  if (previousCoverKey && previousCoverKey !== nextCoverKey) {
    await deleteCoverSet(previousCoverKey).catch(() => {});
  }
  return result;
}

export async function deleteNovelForUser(
  userId: string,
  novelId: string,
  dispatch: (outboxId: string) => Promise<void> = dispatchWorkflowOutboxEventBestEffort,
): Promise<{ success: true }> {
  const { outboxIds, coverKey } = await db.transaction(async (tx) => {
    if (!(await lockNovelForMutation(tx, novelId, userId))) {
      return { outboxIds: [] as string[], coverKey: null as string | null };
    }
    const [novelRow] = await tx
      .select({ coverKey: novels.coverKey })
      .from(novels)
      .where(and(eq(novels.id, novelId), eq(novels.userId, userId)))
      .limit(1);
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
        message: encodeMessage("log.cancelledNovelDeleted"),
      })),
      now,
    );
    const importOutboxIds = await cancelActiveImportsInTransaction(tx, novelId, now);
    await tx.delete(novels).where(and(eq(novels.id, novelId), eq(novels.userId, userId)));
    return {
      outboxIds: [...cancellation.outboxIds, ...importOutboxIds],
      coverKey: novelRow?.coverKey ?? null,
    };
  });
  // Cover objects are reachable only after the row is gone, so a crash between
  // the two leaves objects with no row rather than a row with no cover.
  await deleteCoverSet(coverKey).catch(() => {});
  await mapWithConcurrency(outboxIds, 2, async (outboxId) => {
    try {
      await dispatch(outboxId);
    } catch {
      // Committed cancellation intents remain recoverable after eager delivery failure.
    }
  });
  return { success: true };
}
