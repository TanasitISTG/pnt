import "@tanstack/react-start/server-only";

import { and, eq, inArray } from "drizzle-orm";

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

export type ChapterPublicationInput = {
  chapterId: string;
  publishedAt: Date | null;
};

export type BulkPublicationResult =
  | { id: string; published: number; skipped: number }
  | { id: string; unpublished: number };

// `status = 'translated'` already implies a nonblank body (finalization refuses
// blank output and backup validation rejects translated-without-content), so the
// readiness check never needs to read the wide content column.
function chapterIsReady(chapter: { status: string }): boolean {
  return chapter.status === "translated";
}

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
    if (input.publishedAt !== null && !chapterIsReady(existing)) {
      throw new SafeServerError(encodeMessage("errors.chapterNotTranslatedForPublish"));
    }

    await tx
      .update(chapters)
      .set({ publishedAt: input.publishedAt, updatedAt: new Date() })
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
        status: chapters.status,
      })
      .from(chapters)
      .where(eq(chapters.novelId, novelId))
      .for("update");

    if (publishedAt === null) {
      await tx
        .update(chapters)
        .set({ publishedAt: null, updatedAt: new Date() })
        .where(eq(chapters.novelId, novelId));
      return { id: novelId, unpublished: chapterRows.length };
    }

    const readyIds = chapterRows.filter(chapterIsReady).map((chapter) => chapter.id);
    if (readyIds.length > 0) {
      await tx
        .update(chapters)
        .set({ publishedAt, updatedAt: new Date() })
        .where(and(eq(chapters.novelId, novelId), inArray(chapters.id, readyIds)));
    }

    return {
      id: novelId,
      published: readyIds.length,
      skipped: chapterRows.length - readyIds.length,
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
