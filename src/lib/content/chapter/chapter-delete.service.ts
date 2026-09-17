import "@tanstack/react-start/server-only";

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { lockNovelForMutation } from "@/lib/db/novel-lock";
import { chapters, readerProgress, translationJobs } from "@/lib/db/schema";
import { dispatchWorkflowOutboxEventBestEffort } from "@/lib/inngest/outbox";
import { SafeServerError } from "@/lib/server-fn-error";
import { cancelActiveTranslationJobsInTransaction } from "@/lib/translation/workflow/cancel";

type OutboxDispatch = (outboxId: string) => Promise<void>;

export async function deleteChapterForUser(
  userId: string,
  chapterId: string,
  dispatch: OutboxDispatch = dispatchWorkflowOutboxEventBestEffort,
): Promise<{ success: true }> {
  const outboxIds = await db.transaction(async (tx) => {
    const [parent] = await tx
      .select({ novelId: chapters.novelId })
      .from(chapters)
      .where(eq(chapters.id, chapterId))
      .limit(1);
    if (!parent || !(await lockNovelForMutation(tx, parent.novelId, userId))) {
      throw new SafeServerError("Chapter not found or unauthorized");
    }
    const chapterScope = and(eq(chapters.id, chapterId), eq(chapters.novelId, parent.novelId));
    const [snapshot] = await tx
      .select({ activeTranslationJobId: chapters.activeTranslationJobId })
      .from(chapters)
      .where(chapterScope)
      .limit(1);
    if (!snapshot) throw new SafeServerError("Chapter not found or unauthorized");

    // Preserve pointed-job-before-chapter locking inside the novel gate.
    const [activeJob] = snapshot.activeTranslationJobId
      ? await tx
          .select({
            id: translationJobs.id,
            chapterId: translationJobs.chapterId,
            generation: translationJobs.generation,
            status: translationJobs.status,
            logsJson: translationJobs.logsJson,
          })
          .from(translationJobs)
          .where(eq(translationJobs.id, snapshot.activeTranslationJobId))
          .limit(1)
          .for("update", { of: translationJobs })
      : [];
    const [existing] = await tx
      .select({ id: chapters.id, activeTranslationJobId: chapters.activeTranslationJobId })
      .from(chapters)
      .where(chapterScope)
      .limit(1)
      .for("update", { of: chapters });
    if (!existing) throw new SafeServerError("Chapter not found or unauthorized");
    if (
      existing.activeTranslationJobId !== snapshot.activeTranslationJobId ||
      (activeJob && activeJob.chapterId !== existing.id)
    ) {
      throw new SafeServerError("Chapter changed while it was being deleted; try again");
    }

    let cancellationOutboxIds: string[] = [];
    if (activeJob && (activeJob.status === "pending" || activeJob.status === "running")) {
      const cancellation = await cancelActiveTranslationJobsInTransaction(tx, [
        {
          jobId: activeJob.id,
          generation: activeJob.generation,
          logsJson: activeJob.logsJson,
          message: "Translation cancelled because the chapter was deleted.",
        },
      ]);
      cancellationOutboxIds = cancellation.outboxIds;
    }
    await tx
      .update(readerProgress)
      .set({ lastChapterId: null, scrollFraction: 0, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(readerProgress.lastChapterId, chapterId));
    await tx.delete(chapters).where(chapterScope);
    return cancellationOutboxIds;
  });

  await Promise.all(
    outboxIds.map(async (outboxId) => {
      try {
        await dispatch(outboxId);
      } catch {
        // The committed outbox row remains authoritative for recovery.
      }
    }),
  );
  return { success: true };
}
