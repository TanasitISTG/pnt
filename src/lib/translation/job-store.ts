import "@tanstack/react-start/server-only";

import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { chapters, glossaryTerms, novels, translationJobs } from "@/lib/db/schema";
import { canRunJob } from "./job-state";

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

export async function beginJob(jobId: string, generation: number) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ job: translationJobs, chapter: chapters, novel: novels })
      .from(translationJobs)
      .innerJoin(chapters, eq(translationJobs.chapterId, chapters.id))
      .innerJoin(novels, eq(chapters.novelId, novels.id))
      .where(eq(translationJobs.id, jobId))
      .limit(1)
      .for("update");

    if (!row || !canRunJob(row.job, row.chapter, generation)) return null;

    if (row.job.status === "pending") {
      const updated = await tx
        .update(translationJobs)
        .set({ status: "running", updatedAt: new Date() })
        .where(
          and(
            eq(translationJobs.id, jobId),
            eq(translationJobs.status, "pending"),
            eq(translationJobs.generation, generation),
          ),
        )
        .returning({ id: translationJobs.id });
      if (updated.length === 0) return null;

      const chapterUpdated = await tx
        .update(chapters)
        .set({ status: "translating", updatedAt: new Date() })
        .where(
          and(
            eq(chapters.id, row.chapter.id),
            eq(chapters.activeTranslationJobId, jobId),
            eq(chapters.translationGeneration, generation),
            eq(chapters.sourceRevision, row.job.sourceRevision),
          ),
        )
        .returning({ id: chapters.id });
      if (chapterUpdated.length !== 1) {
        throw new Error(`Job ${jobId} lost chapter ownership during initialization`);
      }
      row.job.status = "running";
    }

    return row;
  });
}

export async function saveJobProgress(
  jobId: string,
  generation: number,
  expectedDoneChunks: number,
  patch: Partial<typeof translationJobs.$inferInsert>,
) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ job: translationJobs, chapter: chapters })
      .from(translationJobs)
      .innerJoin(chapters, eq(translationJobs.chapterId, chapters.id))
      .where(eq(translationJobs.id, jobId))
      .limit(1)
      .for("update");

    if (
      !row ||
      row.job.status !== "running" ||
      row.job.doneChunks !== expectedDoneChunks ||
      !canRunJob(row.job, row.chapter, generation)
    ) {
      return false;
    }

    const updated = await tx
      .update(translationJobs)
      .set({ ...patch, updatedAt: new Date() })
      .where(
        and(
          eq(translationJobs.id, jobId),
          eq(translationJobs.status, "running"),
          eq(translationJobs.generation, generation),
          eq(translationJobs.doneChunks, expectedDoneChunks),
        ),
      )
      .returning({ id: translationJobs.id });
    return updated.length === 1;
  });
}

export interface CompleteJobInput {
  jobId: string;
  generation: number;
  fullTranslation: string;
  translatedTitle?: string;
  chapterSummary?: string;
  storySummary?: string;
  glossaryRows: (typeof glossaryTerms.$inferInsert)[];
  chunksJson: string;
  logsJson: string;
  usageJson: string;
}

export async function completeJob(input: CompleteJobInput) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ job: translationJobs, chapter: chapters, novel: novels })
      .from(translationJobs)
      .innerJoin(chapters, eq(translationJobs.chapterId, chapters.id))
      .innerJoin(novels, eq(chapters.novelId, novels.id))
      .where(eq(translationJobs.id, input.jobId))
      .limit(1)
      .for("update");

    if (
      !row ||
      row.job.status !== "running" ||
      row.job.doneChunks !== row.job.totalChunks ||
      !canRunJob(row.job, row.chapter, input.generation)
    ) {
      return false;
    }

    const chapterUpdated = await tx
      .update(chapters)
      .set({
        translatedContent: input.fullTranslation,
        translatedTitle: input.translatedTitle ?? row.chapter.translatedTitle,
        summary: input.chapterSummary ?? row.chapter.summary,
        status: "translated",
        activeTranslationJobId: null,
        translatedAt: new Date(),
        editedAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(chapters.id, row.chapter.id),
          eq(chapters.activeTranslationJobId, input.jobId),
          eq(chapters.translationGeneration, input.generation),
          eq(chapters.sourceRevision, row.job.sourceRevision),
        ),
      )
      .returning({ id: chapters.id });
    if (chapterUpdated.length !== 1) {
      throw new Error(`Job ${input.jobId} lost chapter ownership during finalization`);
    }

    if (input.storySummary) {
      await tx
        .update(novels)
        .set({ storySummary: input.storySummary, updatedAt: new Date() })
        .where(eq(novels.id, row.novel.id));
    }

    if (input.glossaryRows.length > 0) {
      await tx.insert(glossaryTerms).values(input.glossaryRows).onConflictDoNothing();
    }

    const completed = await tx
      .update(translationJobs)
      .set({
        status: "done",
        chunksJson: input.chunksJson,
        logsJson: input.logsJson,
        usageJson: input.usageJson,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(translationJobs.id, input.jobId),
          eq(translationJobs.status, "running"),
          eq(translationJobs.generation, input.generation),
        ),
      )
      .returning({ id: translationJobs.id });
    return completed.length === 1;
  });
}

export async function failActiveJob(
  jobId: string,
  generation: number,
  message: string,
  logsJson: string,
) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ job: translationJobs, chapter: chapters })
      .from(translationJobs)
      .innerJoin(chapters, eq(translationJobs.chapterId, chapters.id))
      .where(eq(translationJobs.id, jobId))
      .limit(1)
      .for("update");

    if (!row || !canRunJob(row.job, row.chapter, generation)) return false;

    await tx
      .update(translationJobs)
      .set({ status: "error", error: message, logsJson, updatedAt: new Date() })
      .where(
        and(
          eq(translationJobs.id, jobId),
          eq(translationJobs.generation, generation),
          sql`${translationJobs.status} IN ('pending', 'running')`,
        ),
      );
    const chapterUpdated = await tx
      .update(chapters)
      .set({ status: "error", activeTranslationJobId: null, updatedAt: new Date() })
      .where(
        and(
          eq(chapters.id, row.chapter.id),
          eq(chapters.activeTranslationJobId, jobId),
          eq(chapters.translationGeneration, generation),
        ),
      )
      .returning({ id: chapters.id });
    if (chapterUpdated.length !== 1) {
      throw new Error(`Job ${jobId} lost chapter ownership while recording failure`);
    }
    return true;
  });
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
  return new Set(existingRows.map((row) => row.source.trim().toLowerCase()));
}
