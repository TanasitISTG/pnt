import { and, eq, lte, sql } from "drizzle-orm";

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
