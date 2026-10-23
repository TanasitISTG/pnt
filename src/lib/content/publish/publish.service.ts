import "@tanstack/react-start/server-only";

import { and, asc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { encodeMessage } from "@/lib/i18n/message-code";
import { lockNovelForMutation } from "@/lib/db/novel-lock";
import { chapters, novels } from "@/lib/db/schema";
import {
  clearChapterNotifications,
  clearNovelNotifications,
  notifyChapterPublished,
  runNotificationWrite,
} from "@/lib/notifications/service.server";
import { SafeServerError } from "@/lib/server-fn-error";
import { publicationBlockMessage, type PublicationBlock } from "./readiness";
import { loadPublicationVerdicts } from "./readiness.service";

export type ChapterPublicationInput = {
  chapterId: string;
  publishedAt: Date | null;
};

export type BlockedChapterPublication = {
  id: string;
  number: string;
  blockers: readonly PublicationBlock[];
};

export type BulkPublicationResult =
  | { id: string; published: number; skipped: number; blocked: BlockedChapterPublication[] }
  | { id: string; unpublished: number };

function isVisible(publishedAt: Date | null, now: Date): boolean {
  return publishedAt !== null && publishedAt <= now;
}

/**
 * The pre-flight is a read, and it runs before the write it guards.
 *
 * `status = 'translated'` is the workflow's promise that a complete body exists, but the
 * publish path is where that promise becomes a reader's experience, so it re-asserts it from
 * the run and chunk rows that produced the text. Only *becoming* visible is gated: a chapter
 * that is already live is never re-judged, because a gate that can withdraw published text
 * would turn a translation bug into a silent takedown.
 *
 * It sits inside the transaction, after the chapter row is locked and before the `UPDATE`,
 * which is also what keeps it ahead of the notification fan-out below: a refusal writes
 * nothing and announces nothing.
 */
export async function setChapterPublishedForUser(
  userId: string,
  input: ChapterPublicationInput,
): Promise<{ id: string }> {
  await db.transaction(async (tx) => {
    const [parent] = await tx
      .select({ novelId: chapters.novelId })
      .from(chapters)
      .where(eq(chapters.id, input.chapterId))
      .limit(1);
    if (!parent || !(await lockNovelForMutation(tx, parent.novelId, userId))) {
      throw new SafeServerError(encodeMessage("errors.chapterNotFoundOrUnauthorized"));
    }
    const [existing] = await tx
      .select({
        id: chapters.id,
        status: chapters.status,
        publishedAt: chapters.publishedAt,
      })
      .from(chapters)
      .innerJoin(novels, eq(chapters.novelId, novels.id))
      .where(
        and(
          eq(chapters.id, input.chapterId),
          eq(chapters.novelId, parent.novelId),
          eq(novels.userId, userId),
        ),
      )
      .limit(1)
      .for("update", { of: chapters });

    if (!existing) {
      throw new SafeServerError(encodeMessage("errors.chapterNotFoundOrUnauthorized"));
    }

    // "Already live" means a reader can see it right now, which takes both halves of the
    // catalog's rule: a translated body and a publication time that has passed. A row whose
    // time passed while it was still untranslated is not live, so republishing it is still an
    // entry and is still gated.
    const now = new Date();
    const alreadyLive = existing.status === "translated" && isVisible(existing.publishedAt, now);
    if (input.publishedAt !== null && !alreadyLive) {
      const verdicts = await loadPublicationVerdicts(tx, [input.chapterId]);
      const verdict = verdicts.get(input.chapterId);
      if (!verdict) {
        throw new SafeServerError(encodeMessage("errors.chapterNotFoundOrUnauthorized"));
      }
      if (!verdict.publishable) {
        throw new SafeServerError(
          publicationBlockMessage(verdict.blockers[0] ?? { reason: "translation-missing" }),
        );
      }
    }

    await tx
      .update(chapters)
      .set({ publishedAt: input.publishedAt, updatedAt: now })
      .where(eq(chapters.id, input.chapterId));
  });

  await reconcileChapterNotifications(input.chapterId, input.publishedAt);

  return { id: input.chapterId };
}

/**
 * The publication change is the event, so the notification follows it rather than the clock.
 *
 * This is the one chapter the author just published, so the fan-out runs here instead of
 * waiting for the sweep: it is a follower read, one insert, and one batched Ably call, and a
 * chapter that is not a draft or scheduled in the future loses the rows it may still have
 * carried — a reschedule must not keep announcing a chapter the catalog hides. Both calls
 * are best-effort: a reader can miss a badge, but never their own publish.
 */
async function reconcileChapterNotifications(
  chapterId: string,
  publishedAt: Date | null,
): Promise<void> {
  if (publishedAt !== null && publishedAt <= new Date()) {
    await runNotificationWrite("chapter published", () => notifyChapterPublished(chapterId));
    return;
  }
  await runNotificationWrite("chapter unpublished", () => clearChapterNotifications(chapterId));
}

/**
 * A bulk release publishes what it can and names what it cannot.
 *
 * Publishing chapters one at a time is the existing contract (`skipped` already reports the
 * ones that were not ready), so a chapter that fails the pre-flight joins that report instead
 * of failing the whole click: one broken chapter must not block the other four hundred. A
 * chapter that is already live keeps its place — its timestamp is updated as before, and the
 * studio's readiness read is what says it needs attention. Unpublishing is never gated.
 */
export async function setAllChaptersPublishedForUser(
  userId: string,
  novelId: string,
  publishedAt: Date | null,
): Promise<BulkPublicationResult> {
  const result = await db.transaction(async (tx) => {
    const [novel] = await tx
      .select({ id: novels.id })
      .from(novels)
      .where(and(eq(novels.id, novelId), eq(novels.userId, userId)))
      .limit(1)
      .for("update");

    if (!novel) {
      throw new SafeServerError(encodeMessage("errors.novelNotFoundOrUnauthorized"));
    }

    const chapterRows = await tx
      .select({
        id: chapters.id,
        number: chapters.number,
        status: chapters.status,
        publishedAt: chapters.publishedAt,
      })
      .from(chapters)
      .where(eq(chapters.novelId, novelId))
      .orderBy(asc(chapters.number), asc(chapters.id))
      .for("update");

    if (publishedAt === null) {
      await tx
        .update(chapters)
        .set({ publishedAt: null, updatedAt: new Date() })
        .where(eq(chapters.novelId, novelId));
      return { id: novelId, unpublished: chapterRows.length };
    }

    const now = new Date();
    const candidates = chapterRows.filter((chapter) => chapter.status === "translated");
    const entering = candidates.filter((chapter) => !isVisible(chapter.publishedAt, now));
    const verdicts = await loadPublicationVerdicts(
      tx,
      entering.map((chapter) => chapter.id),
    );

    const readyIds: string[] = [];
    const blocked: BlockedChapterPublication[] = [];
    for (const chapter of candidates) {
      if (isVisible(chapter.publishedAt, now)) {
        readyIds.push(chapter.id);
        continue;
      }
      const verdict = verdicts.get(chapter.id);
      if (verdict && !verdict.publishable) {
        blocked.push({ id: chapter.id, number: chapter.number, blockers: verdict.blockers });
        continue;
      }
      readyIds.push(chapter.id);
    }

    if (readyIds.length > 0) {
      await tx
        .update(chapters)
        .set({ publishedAt, updatedAt: now })
        .where(and(eq(chapters.novelId, novelId), inArray(chapters.id, readyIds)));
    }

    return {
      id: novelId,
      published: readyIds.length,
      skipped: chapterRows.length - candidates.length,
      blocked,
    };
  });

  // A bulk release can touch every chapter at once, so its fan-out is not run here: the
  // sweep picks these up within a minute, off the request. Unpublishing still reconciles
  // immediately, because a stale bell is visible and a late badge is not.
  if (publishedAt === null || publishedAt > new Date()) {
    await runNotificationWrite("novel unpublished", () => clearNovelNotifications(novelId));
  }

  return result;
}
