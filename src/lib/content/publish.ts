import { lte } from "drizzle-orm";

import { novels, chapters } from "@/lib/db/schema";

export type PublishState = "draft" | "scheduled" | "live";

export function publishState(
  publishedAt: Date | string | null | undefined,
  now: Date = new Date(),
): PublishState {
  if (!publishedAt) return "draft";
  return new Date(publishedAt) <= now ? "live" : "scheduled";
}

// Live = published_at reached (null fails the comparison, so drafts are excluded).
// Shared by the novel/chapter server-function modules for guest visibility filters.
export const novelLive = () => lte(novels.publishedAt, new Date());
export const chapterLive = () => lte(chapters.publishedAt, new Date());
