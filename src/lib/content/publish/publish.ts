import { and, eq, lte, or, sql } from "drizzle-orm";

import { novels, chapters } from "@/lib/db/schema";

export type PublishState = "draft" | "scheduled" | "live";

export function publishState(
  publishedAt: Date | string | null | undefined,
  now: Date = new Date(),
): PublishState {
  if (!publishedAt) return "draft";
  return new Date(publishedAt) <= now ? "live" : "scheduled";
}

// `status = 'translated'` already implies a nonblank body: finalization refuses
// blank output and backup validation rejects translated-without-content. Testing
// the status instead of `translated_content` keeps the wide column out of list
// projections, where referencing it forces a row fetch per chapter.
export const chapterHasTranslation = () => sql<boolean>`${chapters.status} = 'translated'`;
export const novelLive = (now: Date = new Date()) => lte(novels.publishedAt, now);
// Live = publication reached and a complete translated body is available.
// `status = 'translated'` already implies a nonblank body, so visibility never
// tests `translated_content`: referencing that column forces a row fetch per
// chapter, which made guest list queries take seconds.
export const chapterLive = (now: Date = new Date()) =>
  and(lte(chapters.publishedAt, now), eq(chapters.status, "translated"));
export const chapterVisibleToGuests = (now: Date = new Date()) => chapterLive(now);

/**
 * Read visibility for a novel, from the viewer's point of view.
 *
 * A viewer may read a novel they own in any publication state, and may read anyone
 * else's once it is live. Anonymous viewers only ever get the live filter. This is the
 * only rule a read path may use: "is there a session" is not an authorization
 * decision, and a client-supplied flag never is.
 *
 * Ownership for *mutation* stays a stricter, separate check (`eq(novels.userId, ...)`) —
 * being able to read a published novel must never imply being able to change it.
 */
export const novelReadable = (viewerId: string | null, now: Date = new Date()) =>
  viewerId ? or(eq(novels.userId, viewerId), novelLive(now)) : novelLive(now);

/**
 * The same rule one level down. Requires the `novels` join, because ownership lives on
 * the novel rather than the chapter: an owner sees every chapter of their own novel,
 * while everyone else sees only chapters that are live and translated.
 */
export const chapterReadable = (viewerId: string | null, now: Date = new Date()) =>
  viewerId
    ? or(eq(novels.userId, viewerId), chapterVisibleToGuests(now))
    : chapterVisibleToGuests(now);
