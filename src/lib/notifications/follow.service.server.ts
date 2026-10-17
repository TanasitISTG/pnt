import "@tanstack/react-start/server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { encodeMessage } from "@/lib/i18n/message-code";
import { novelReadable } from "@/lib/content/publish/publish";
import { novelFollows, novels } from "@/lib/db/schema";
import { SafeServerError } from "@/lib/server-fn-error";
import type { NovelFollowState } from "./types";

/**
 * Following is a reader relation on a novel the viewer may merely be reading, so the gate is
 * read visibility rather than ownership — the same rule bookmarks and progress use. The one
 * exception is the author: following your own novel would only notify you about your own
 * work, so the button is absent and the write refuses.
 */
export async function setNovelFollowForUser(
  userId: string,
  novelId: string,
  following: boolean,
): Promise<NovelFollowState> {
  if (!following) {
    // Leaving needs no visibility check: a novel that became unreadable must still be
    // leavable, or the follow would be stuck on an account forever.
    await db
      .delete(novelFollows)
      .where(and(eq(novelFollows.userId, userId), eq(novelFollows.novelId, novelId)));
    return { following: false };
  }

  const [novel] = await db
    .select({ id: novels.id, ownerId: novels.userId })
    .from(novels)
    .where(and(eq(novels.id, novelId), novelReadable(userId)))
    .limit(1);

  if (!novel) throw new SafeServerError(encodeMessage("errors.novelNotFoundOrUnauthorized"));
  if (novel.ownerId === userId) {
    throw new SafeServerError(encodeMessage("errors.cannotFollowOwnNovel"));
  }

  await db.insert(novelFollows).values({ userId, novelId }).onConflictDoNothing();

  return { following: true };
}

/**
 * The follow state behind one novel's button. An unreadable novel reads as "not following"
 * rather than as an error: the caller is a button, and "no" is the answer that hides it.
 */
export async function getNovelFollowForUser(
  userId: string,
  novelId: string,
): Promise<NovelFollowState> {
  const [row] = await db
    .select({ userId: novelFollows.userId })
    .from(novelFollows)
    .where(and(eq(novelFollows.userId, userId), eq(novelFollows.novelId, novelId)))
    .limit(1);

  return { following: Boolean(row) };
}
