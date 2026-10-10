import "@tanstack/react-start/server-only";

import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { chapters, novels, translationJobs } from "@/lib/db/schema";

export type TranslationJobLookup = {
  jobId?: string;
  chapterId?: string;
};

function orderForLookup(lookup: TranslationJobLookup) {
  return lookup.chapterId
    ? [
        desc(
          sql`CASE WHEN ${translationJobs.id} = ${chapters.activeTranslationJobId} THEN 1 ELSE 0 END`,
        ),
        desc(translationJobs.createdAt),
      ]
    : [desc(translationJobs.createdAt)];
}

export async function findOwnedTranslationJob(userId: string, lookup: TranslationJobLookup) {
  const whereCondition = lookup.jobId
    ? eq(translationJobs.id, lookup.jobId)
    : lookup.chapterId
      ? eq(translationJobs.chapterId, lookup.chapterId)
      : null;

  if (!whereCondition) return null;

  const [row] = await db
    .select({ job: translationJobs, chapter: chapters })
    .from(translationJobs)
    .innerJoin(chapters, eq(translationJobs.chapterId, chapters.id))
    .innerJoin(novels, eq(chapters.novelId, novels.id))
    .where(and(whereCondition, eq(novels.userId, userId)))
    .orderBy(...orderForLookup(lookup))
    .limit(1);

  return row ?? null;
}

export async function findOwnedTranslationJobProgress(
  userId: string,
  lookup: TranslationJobLookup,
) {
  const whereCondition = lookup.jobId
    ? eq(translationJobs.id, lookup.jobId)
    : lookup.chapterId
      ? eq(translationJobs.chapterId, lookup.chapterId)
      : null;

  if (!whereCondition) return null;

  const [row] = await db
    .select({
      id: translationJobs.id,
      chapterId: translationJobs.chapterId,
      status: translationJobs.status,
      doneChunks: translationJobs.doneChunks,
      totalChunks: translationJobs.totalChunks,
      error: translationJobs.error,
      updatedAt: translationJobs.updatedAt,
    })
    .from(translationJobs)
    .innerJoin(chapters, eq(translationJobs.chapterId, chapters.id))
    .innerJoin(novels, eq(chapters.novelId, novels.id))
    .where(and(whereCondition, eq(novels.userId, userId)))
    .orderBy(...orderForLookup(lookup))
    .limit(1);

  return row ?? null;
}
