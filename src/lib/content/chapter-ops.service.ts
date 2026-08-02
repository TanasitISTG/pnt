import "@tanstack/react-start/server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { chapters, novels, translationJobs, translationOutbox } from "@/lib/db/schema";
import { mapWithConcurrency } from "@/lib/async";
import { SafeServerError } from "@/lib/server-fn-error";
import { nanoid } from "@/lib/utils";
import { dispatchTranslationOutboxEventBestEffort } from "@/lib/translation/outbox";
import { translationRunIdentity } from "@/lib/translation/job-state";

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
