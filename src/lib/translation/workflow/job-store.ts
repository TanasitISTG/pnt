import "@tanstack/react-start/server-only";

import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  chapters,
  glossaryTerms,
  novels,
  translationJobChunks,
  translationJobs,
} from "@/lib/db/schema";
import { canRunJob } from "./job-state";
import {
  mergeAutomaticRelationshipAnalysis,
  parseRelationshipMap,
  serializeRelationshipMap,
} from "@/lib/relationships/map";
import type {
  ApprovedCharacterMapping,
  RelationshipAnalysis,
  RelationshipMapV1,
} from "@/lib/relationships/schemas";

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

export async function loadJobChunk(jobId: string, index: number) {
  const row = await loadJob(jobId);
  if (!row) return null;
  const chunks = await db
    .select()
    .from(translationJobChunks)
    .where(
      and(
        eq(translationJobChunks.jobId, jobId),
        inArray(translationJobChunks.index, index > 0 ? [index - 1, index] : [index]),
      ),
    )
    .orderBy(asc(translationJobChunks.index));
  return {
    ...row,
    chunk: chunks.find((chunk) => chunk.index === index) ?? null,
    previousChunk: chunks.find((chunk) => chunk.index === index - 1) ?? null,
  };
}

export async function loadJobChunks(jobId: string) {
  return db
    .select()
    .from(translationJobChunks)
    .where(eq(translationJobChunks.jobId, jobId))
    .orderBy(asc(translationJobChunks.index));
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

async function lockRunnableJob(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  jobId: string,
  generation: number,
  expectedDoneChunks: number,
) {
  const [row] = await tx
    .select({ job: translationJobs, chapter: chapters, novel: novels })
    .from(translationJobs)
    .innerJoin(chapters, eq(translationJobs.chapterId, chapters.id))
    .innerJoin(novels, eq(chapters.novelId, novels.id))
    .where(eq(translationJobs.id, jobId))
    .limit(1)
    .for("update");

  if (
    !row ||
    row.job.status !== "running" ||
    row.job.doneChunks !== expectedDoneChunks ||
    !canRunJob(row.job, row.chapter, generation)
  ) {
    return null;
  }
  return row;
}

export async function saveChunkFailure(
  jobId: string,
  generation: number,
  index: number,
  error: string,
  logsJson: string,
) {
  return db.transaction(async (tx) => {
    const row = await lockRunnableJob(tx, jobId, generation, index);
    if (!row) return false;
    await tx
      .update(translationJobChunks)
      .set({ error })
      .where(and(eq(translationJobChunks.jobId, jobId), eq(translationJobChunks.index, index)));
    await tx
      .update(translationJobs)
      .set({ logsJson, updatedAt: new Date() })
      .where(eq(translationJobs.id, jobId));
    return true;
  });
}

export async function completeChunk(
  jobId: string,
  generation: number,
  index: number,
  result: {
    translation: string;
    promptTokens: number;
    completionTokens: number;
    latencyMs: number;
    logsJson: string;
  },
) {
  return db.transaction(async (tx) => {
    const row = await lockRunnableJob(tx, jobId, generation, index);
    if (!row) return false;
    const chunkUpdated = await tx
      .update(translationJobChunks)
      .set({
        translation: result.translation,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        latencyMs: result.latencyMs,
        error: null,
        completedAt: new Date(),
      })
      .where(and(eq(translationJobChunks.jobId, jobId), eq(translationJobChunks.index, index)))
      .returning({ jobId: translationJobChunks.jobId });
    if (chunkUpdated.length !== 1) throw new Error(`Chunk ${index} missing in job ${jobId}`);

    const updated = await tx
      .update(translationJobs)
      .set({ doneChunks: index + 1, logsJson: result.logsJson, updatedAt: new Date() })
      .where(
        and(
          eq(translationJobs.id, jobId),
          eq(translationJobs.status, "running"),
          eq(translationJobs.generation, generation),
          eq(translationJobs.doneChunks, index),
        ),
      )
      .returning({ id: translationJobs.id });
    if (updated.length !== 1) {
      throw new Error(`Job ${jobId} lost ownership while completing chunk ${index}`);
    }
    return true;
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
    .select({
      summary: chapters.summary,
      rawContent: chapters.rawContent,
      translatedContent: chapters.translatedContent,
    })
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
  const rows = await db
    .select({
      source: glossaryTerms.source,
      target: glossaryTerms.target,
      status: glossaryTerms.status,
    })
    .from(glossaryTerms)
    .where(eq(glossaryTerms.novelId, novelId));

  const approvedTerms: { source: string; target: string }[] = [];
  const existingSources: string[] = [];
  for (const row of rows) {
    existingSources.push(row.source);
    if (row.status === "approved") {
      approvedTerms.push({ source: row.source, target: row.target });
    }
  }

  return { approvedTerms, existingSources };
}

export interface ApplyRelationshipAnalysisResult {
  applied: boolean;
  map: RelationshipMapV1 | null;
  warnings: string[];
}

/** Persist automatic facts only while this chunk still owns the runnable job. */
export async function applyRelationshipAnalysis(
  jobId: string,
  generation: number,
  chunkIndex: number,
  analysis: RelationshipAnalysis,
): Promise<ApplyRelationshipAnalysisResult> {
  return db.transaction(async (tx) => {
    const row = await lockRunnableJob(tx, jobId, generation, chunkIndex);
    if (!row) return { applied: false, map: null, warnings: [] };

    const currentMap = parseRelationshipMap(row.novel.relationshipMapJson);
    if (!currentMap) {
      return {
        applied: false,
        map: null,
        warnings: ["Stored relationship map is invalid; automatic update skipped."],
      };
    }

    const glossaryRows = await tx
      .select({ source: glossaryTerms.source, target: glossaryTerms.target })
      .from(glossaryTerms)
      .where(
        and(
          eq(glossaryTerms.novelId, row.novel.id),
          eq(glossaryTerms.status, "approved"),
          eq(glossaryTerms.category, "character"),
        ),
      );
    const mappings: ApprovedCharacterMapping[] = glossaryRows.map((term) => ({
      source: term.source,
      target: term.target,
    }));
    const merged = mergeAutomaticRelationshipAnalysis(
      currentMap,
      analysis,
      mappings,
      row.chapter.number,
      new Date().toISOString(),
    );
    const serialized = serializeRelationshipMap(merged.map);
    if (serialized !== row.novel.relationshipMapJson) {
      await tx
        .update(novels)
        .set({ relationshipMapJson: serialized, updatedAt: new Date() })
        .where(eq(novels.id, row.novel.id));
    }
    return { applied: true, map: merged.map, warnings: merged.warnings };
  });
}
