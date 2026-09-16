import "@tanstack/react-start/server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { chapters, novels, translationJobs } from "@/lib/db/schema";
import { dispatchWorkflowOutboxEventBestEffort } from "@/lib/inngest/outbox";
import { SafeServerError } from "@/lib/server-fn-error";
import { cancelActiveTranslationJobsInTransaction } from "@/lib/translation/workflow/cancel";

type OutboxDispatch = (outboxId: string) => Promise<void>;
const retryChapterDelete = Symbol("retryChapterDelete");

function isRetryableChapterDeleteError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  return error.code === "55P03" || error.code === "40P01";
}

const MAX_CHAPTER_DELETE_ATTEMPTS = 5;

export async function deleteChapterForUser(
  userId: string,
  chapterId: string,
  dispatch: OutboxDispatch = dispatchWorkflowOutboxEventBestEffort,
): Promise<{ success: true }> {
  let outboxIds: string[] | null = null;

  for (let attempt = 0; attempt < MAX_CHAPTER_DELETE_ATTEMPTS; attempt++) {
    try {
      outboxIds = await db.transaction(async (tx) => {
        const [snapshot] = await tx
          .select({ activeTranslationJobId: chapters.activeTranslationJobId })
          .from(chapters)
          .innerJoin(novels, eq(chapters.novelId, novels.id))
          .where(and(eq(chapters.id, chapterId), eq(novels.userId, userId)))
          .limit(1);

        if (!snapshot) throw new SafeServerError("Chapter not found or unauthorized");

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
              .for("update")
          : [];

        // The observed job is locked first; NOWAIT on the chapter prevents a concurrent
        // chapter-edit transaction (chapter first, job second) from forming a lock cycle.
        const [existing] = await tx
          .select({ chapter: chapters })
          .from(chapters)
          .innerJoin(novels, eq(chapters.novelId, novels.id))
          .where(and(eq(chapters.id, chapterId), eq(novels.userId, userId)))
          .limit(1)
          .for("update", { of: chapters, noWait: true });

        if (!existing) throw new SafeServerError("Chapter not found or unauthorized");
        if (existing.chapter.activeTranslationJobId !== snapshot.activeTranslationJobId) {
          throw retryChapterDelete;
        }

        let cancellationOutboxIds: string[] = [];
        if (
          activeJob &&
          activeJob.chapterId === existing.chapter.id &&
          (activeJob.status === "pending" || activeJob.status === "running")
        ) {
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

        await tx.delete(chapters).where(eq(chapters.id, chapterId));
        return cancellationOutboxIds;
      });
      break;
    } catch (error) {
      if (error === retryChapterDelete || isRetryableChapterDeleteError(error)) {
        if (attempt === MAX_CHAPTER_DELETE_ATTEMPTS - 1) {
          throw new SafeServerError("Chapter changed while it was being deleted; try again");
        }
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 10 * 2 ** attempt);
        });
        continue;
      }
      throw error;
    }
  }

  if (!outboxIds) {
    throw new SafeServerError("Chapter changed while it was being deleted; try again");
  }

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
