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

// Non-null means nonblank: blank-but-non-null content is invalid data
// (finalization refuses blank output and backup validation asserts null-or-nonblank).
export const chapterTranslationPresent = () =>
  sql<boolean>`${chapters.translatedContent} IS NOT NULL`;
export const novelLive = (now: Date = new Date()) => lte(novels.publishedAt, now);
// Live = publication reached and a complete translated body is available.
// `status = 'translated'` already implies a nonblank body, so visibility never
// tests `translated_content`: referencing that column forces a row fetch per
// chapter and made guest list queries take seconds on CockroachDB.
export const chapterLive = (now: Date = new Date()) =>
  and(lte(chapters.publishedAt, now), eq(chapters.status, "translated"));
export const chapterVisibleToGuests = (now: Date = new Date()) => chapterLive(now);
