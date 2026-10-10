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

// Live = publication reached and a complete translated body is available.
// Shared by the novel/chapter server-function modules for guest visibility filters.
export const chapterTranslationPresent = () =>
  sql<boolean>`${
    chapters.translatedContent
  } IS NOT NULL AND regexp_replace(${chapters.translatedContent}, '[[:space:]]', '', 'g') <> ''`;
export const novelLive = (now: Date = new Date()) => lte(novels.publishedAt, now);
export const chapterLive = (now: Date = new Date()) =>
  and(
    lte(chapters.publishedAt, now),
    eq(chapters.status, "translated"),
    chapterTranslationPresent(),
  );
export const chapterVisibleToGuests = (now: Date = new Date()) => chapterLive(now);
