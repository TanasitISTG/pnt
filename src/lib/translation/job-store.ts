import "@tanstack/react-start/server-only";
import { eq, and, sql, lt, desc, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { novels, chapters, translationJobs, glossaryTerms } from "@/lib/db/schema";

export async function loadJob(jobId: string) {
  const [row] = await db
    .select({ job: translationJobs, chapter: chapters, novel: novels })
    .from(translationJobs)
    .innerJoin(chapters, eq(translationJobs.chapterId, chapters.id))
    .innerJoin(novels, eq(chapters.novelId, novels.id))
    .where(eq(translationJobs.id, jobId))
    .limit(1);
  return row ?? null;
}

export async function saveJob(jobId: string, patch: Record<string, unknown>) {
  await db
    .update(translationJobs)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(translationJobs.id, jobId));
}

export async function markChapterTranslating(chapterId: string) {
  await db
    .update(chapters)
    .set({ status: "translating", updatedAt: new Date() })
    .where(eq(chapters.id, chapterId));
}

export async function loadApprovedTermsForContext(novelId: string) {
  return db
    .select({
      source: glossaryTerms.source,
      target: glossaryTerms.target,
      category: glossaryTerms.category,
      note: glossaryTerms.note,
    })
    .from(glossaryTerms)
    .where(and(eq(glossaryTerms.novelId, novelId), eq(glossaryTerms.status, "approved")));
}

export async function loadPrevChapterForContext(novelId: string, chapterNumber: string) {
  const [prevChapter] = await db
    .select({ summary: chapters.summary, translatedContent: chapters.translatedContent })
    .from(chapters)
    .where(
      and(
        eq(chapters.novelId, novelId),
        lt(sql`COALESCE(${chapters.number}::numeric, 0)`, sql`${chapterNumber}::numeric`),
        eq(chapters.status, "translated"),
      ),
    )
    .orderBy(desc(sql`COALESCE(${chapters.number}::numeric, 0)`))
    .limit(1);
  return prevChapter ?? null;
}

export async function markChapterTranslated(chapterId: string, fullTranslation: string) {
  await db
    .update(chapters)
    .set({
      translatedContent: fullTranslation,
      status: "translated",
      translatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(chapters.id, chapterId));
}

export async function setChapterTranslatedTitle(chapterId: string, translatedTitle: string) {
  await db
    .update(chapters)
    .set({ translatedTitle, updatedAt: new Date() })
    .where(eq(chapters.id, chapterId));
}

export async function setChapterSummary(chapterId: string, summary: string) {
  await db
    .update(chapters)
    .set({ summary, updatedAt: new Date() })
    .where(eq(chapters.id, chapterId));
}

export async function setNovelStorySummary(novelId: string, storySummary: string) {
  await db
    .update(novels)
    .set({ storySummary, updatedAt: new Date() })
    .where(eq(novels.id, novelId));
}

export async function loadTermSourcesForExclusion(novelId: string) {
  const [approvedTerms, rejectedTerms] = await Promise.all([
    db
      .select({ source: glossaryTerms.source, target: glossaryTerms.target })
      .from(glossaryTerms)
      .where(and(eq(glossaryTerms.novelId, novelId), eq(glossaryTerms.status, "approved"))),
    db
      .select({ source: glossaryTerms.source })
      .from(glossaryTerms)
      .where(and(eq(glossaryTerms.novelId, novelId), eq(glossaryTerms.status, "rejected"))),
  ]);

  return { approvedTerms, rejectedTerms };
}

export async function findExistingTermSources(novelId: string, sources: string[]) {
  if (sources.length === 0) return new Set<string>();
  const existingRows = await db
    .select({ source: glossaryTerms.source })
    .from(glossaryTerms)
    .where(
      and(
        eq(glossaryTerms.novelId, novelId),
        inArray(sql`lower(trim(${glossaryTerms.source}))`, sources),
      ),
    );
  return new Set(existingRows.map((r) => r.source.trim().toLowerCase()));
}

export async function insertGlossaryTerms(rowsToInsert: (typeof glossaryTerms.$inferInsert)[]) {
  if (rowsToInsert.length > 0) {
    await db.insert(glossaryTerms).values(rowsToInsert);
  }
}

export async function markChapterError(chapterId: string) {
  await db
    .update(chapters)
    .set({ status: "error", updatedAt: new Date() })
    .where(eq(chapters.id, chapterId));
}
