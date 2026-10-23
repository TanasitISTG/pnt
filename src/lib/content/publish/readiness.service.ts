import "@tanstack/react-start/server-only";

import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { lockNovelForMutation } from "@/lib/db/novel-lock";
import {
  chapterTranslationVersions,
  chapters,
  novels,
  translationJobChunks,
  translationJobs,
} from "@/lib/db/schema";
import { encodeMessage } from "@/lib/i18n/message-code";
import { SafeServerError } from "@/lib/server-fn-error";
import {
  evaluatePublication,
  paragraphCount,
  type PublicationBlock,
  type PublicationChunkFacts,
  type PublicationFacts,
  type PublicationRunFacts,
  type PublicationVerdict,
} from "./readiness";

/**
 * A read handle.
 *
 * The publish path already holds a transaction (and the novel lock that serializes it against
 * every translation write), while the studio's readiness read and the sweep start from the
 * pooled client. Both satisfy this, so one set of queries serves all three and a verdict can
 * never be computed from a different rule in a different place.
 */
type PublicationReader = Pick<typeof db, "select">;

const jobFactColumns = {
  id: translationJobs.id,
  chapterId: translationJobs.chapterId,
  status: translationJobs.status,
  doneChunks: translationJobs.doneChunks,
  totalChunks: translationJobs.totalChunks,
  generation: translationJobs.generation,
  sourceRevision: translationJobs.sourceRevision,
};

type ChapterRunCursor = {
  id: string;
  translationGeneration: number;
  sourceRevision: number;
};

function runFacts(job: {
  id: string;
  status: string;
  doneChunks: number;
  totalChunks: number;
}): PublicationRunFacts {
  return {
    id: job.id,
    status: job.status,
    doneChunks: job.doneChunks,
    totalChunks: job.totalChunks,
  };
}

/**
 * The run behind each chapter's current text, plus its chunk rows in one aggregate.
 *
 * Provenance is the newest history row, because that row *is* the current text by
 * construction. Only a `translation` origin names a run: a manual save, a rollback, an
 * imported body or a glossary pass produced its text without one, so those chapters have no
 * run to judge and are left to the paragraph test. A legacy chapter with no history at all
 * falls back to the newest job that matches its generation and source revision.
 */
async function loadRunFacts(
  reader: PublicationReader,
  rows: readonly ChapterRunCursor[],
): Promise<{
  runs: Map<string, PublicationRunFacts>;
  chunks: Map<string, PublicationChunkFacts>;
}> {
  const runs = new Map<string, PublicationRunFacts>();
  const chunks = new Map<string, PublicationChunkFacts>();
  if (rows.length === 0) return { runs, chunks };

  const ids = rows.map((row) => row.id);
  const versions = await reader
    .select({
      chapterId: chapterTranslationVersions.chapterId,
      origin: chapterTranslationVersions.origin,
      jobId: chapterTranslationVersions.jobId,
      generation: chapterTranslationVersions.generation,
    })
    .from(chapterTranslationVersions)
    .where(inArray(chapterTranslationVersions.chapterId, ids))
    // Newest first within a chapter; the history is bounded per chapter, and no content
    // column is read, so this stays a metadata scan.
    .orderBy(
      asc(chapterTranslationVersions.chapterId),
      desc(chapterTranslationVersions.createdAt),
      desc(chapterTranslationVersions.id),
    );

  const newest = new Map<string, { origin: string; jobId: string | null; generation: number }>();
  for (const version of versions) {
    if (!newest.has(version.chapterId)) {
      newest.set(version.chapterId, {
        origin: version.origin,
        jobId: version.jobId,
        generation: version.generation,
      });
    }
  }

  const provenanceJobIds = [
    ...new Set(
      [...newest.values()].flatMap((version) =>
        version.origin === "translation" && version.jobId ? [version.jobId] : [],
      ),
    ),
  ];
  const provenanceJobs =
    provenanceJobIds.length > 0
      ? await reader
          .select(jobFactColumns)
          .from(translationJobs)
          .where(inArray(translationJobs.id, provenanceJobIds))
      : [];
  const jobById = new Map(provenanceJobs.map((job) => [job.id, job]));

  for (const row of rows) {
    const version = newest.get(row.id);
    if (version?.origin !== "translation" || !version.jobId) continue;
    const job = jobById.get(version.jobId);
    // A version row whose run was pruned by retention is still proof of a completed
    // finalization, so an unverifiable id leaves the chapter without a run rather than
    // blocking it.
    if (!job || job.chapterId !== row.id || job.generation !== version.generation) continue;
    runs.set(row.id, runFacts(job));
  }

  const fallbackIds = rows.filter((row) => !newest.has(row.id)).map((row) => row.id);
  if (fallbackIds.length > 0) {
    const rowById = new Map(rows.map((row) => [row.id, row]));
    const candidates = await reader
      .select(jobFactColumns)
      .from(translationJobs)
      .where(inArray(translationJobs.chapterId, fallbackIds))
      .orderBy(desc(translationJobs.updatedAt));
    for (const job of candidates) {
      if (runs.has(job.chapterId)) continue;
      const row = rowById.get(job.chapterId);
      if (!row) continue;
      if (job.status !== "done") continue;
      if (job.generation !== row.translationGeneration) continue;
      if (job.sourceRevision !== row.sourceRevision) continue;
      runs.set(job.chapterId, runFacts(job));
    }
  }

  const jobIds = [...runs.values()].map((run) => run.id);
  if (jobIds.length > 0) {
    const aggregates = await reader
      .select({
        jobId: translationJobChunks.jobId,
        total: count(),
        // One condition, one row: a chunk that failed is also one with no text, and counting
        // the two facts separately would report the same lost chunk twice.
        unusable: sql<number>`count(*) filter (where ${translationJobChunks.error} is not null or ${translationJobChunks.translation} is null or btrim(${translationJobChunks.translation}) = '')`,
      })
      .from(translationJobChunks)
      .where(inArray(translationJobChunks.jobId, jobIds))
      .groupBy(translationJobChunks.jobId);
    for (const aggregate of aggregates) {
      chunks.set(aggregate.jobId, {
        total: Number(aggregate.total),
        unusable: Number(aggregate.unusable),
      });
    }
  }

  return { runs, chunks };
}

/** The verdict for every chapter named, keyed by chapter id. */
export async function loadPublicationVerdicts(
  reader: PublicationReader,
  chapterIds: readonly string[],
): Promise<Map<string, PublicationVerdict>> {
  const verdicts = new Map<string, PublicationVerdict>();
  const ids = [...new Set(chapterIds)];
  if (ids.length === 0) return verdicts;

  const chapterRows = await reader
    .select({
      id: chapters.id,
      status: chapters.status,
      rawContent: chapters.rawContent,
      translatedContent: chapters.translatedContent,
      activeTranslationJobId: chapters.activeTranslationJobId,
      translationGeneration: chapters.translationGeneration,
      sourceRevision: chapters.sourceRevision,
    })
    .from(chapters)
    .where(inArray(chapters.id, ids));

  const { runs, chunks } = await loadRunFacts(reader, chapterRows);

  for (const row of chapterRows) {
    const run = runs.get(row.id) ?? null;
    const facts: PublicationFacts = {
      status: row.status,
      hasBody: Boolean(row.translatedContent?.trim()),
      activeTranslationJobId: row.activeTranslationJobId,
      rawParagraphs: paragraphCount(row.rawContent),
      translatedParagraphs: paragraphCount(row.translatedContent),
      run,
      chunks: run ? (chunks.get(run.id) ?? null) : null,
    };
    verdicts.set(row.id, evaluatePublication(facts));
  }

  return verdicts;
}

export interface PublicationReadinessRow {
  chapterId: string;
  blockers: readonly PublicationBlock[];
}

// Bodies are read here, so the scan walks a novel in batches for the same reason the residual
// scan does: one request should never hold a whole shelf of text at once.
const READINESS_BATCH_SIZE = 25;

export async function getPublicationReadinessForUser(
  userId: string,
  novelId: string,
): Promise<PublicationReadinessRow[]> {
  const [novel] = await db
    .select({ id: novels.id })
    .from(novels)
    .where(and(eq(novels.id, novelId), eq(novels.userId, userId)))
    .limit(1);
  if (!novel) throw new SafeServerError(encodeMessage("errors.novelNotFoundOrUnauthorized"));

  const rows = await db
    .select({ id: chapters.id })
    .from(chapters)
    .where(and(eq(chapters.novelId, novelId), eq(chapters.status, "translated")))
    .orderBy(asc(chapters.number), asc(chapters.id));

  const blocked: PublicationReadinessRow[] = [];
  for (let index = 0; index < rows.length; index += READINESS_BATCH_SIZE) {
    const batch = rows.slice(index, index + READINESS_BATCH_SIZE);
    const verdicts = await loadPublicationVerdicts(
      db,
      batch.map((row) => row.id),
    );
    for (const { id } of batch) {
      const verdict = verdicts.get(id);
      if (verdict && !verdict.publishable) {
        blocked.push({ chapterId: id, blockers: verdict.blockers });
      }
    }
  }
  return blocked;
}

/**
 * How far ahead the clock's publication check looks.
 *
 * A scheduled chapter has no write behind it at its publication time: reads simply start
 * returning it. So the promise is kept by pre-flighting the chapters about to arrive, one
 * sweep ahead of them, instead of trusting that nothing changed between scheduling and the
 * day itself.
 */
export const PUBLICATION_WITHHOLD_WINDOW_MS = 15 * 60_000;

const WITHHOLD_BATCH_SIZE = 50;

/**
 * Withdraw the schedule of a chapter that can no longer be published.
 *
 * Only entry is governed, so this never touches a chapter that is already live: a chapter
 * that breaks while live keeps serving the text readers already have. A chapter with a run
 * in flight is skipped too — the run will settle, and until then the chapter's status
 * already keeps it out of the catalog.
 */
export async function withholdIncompleteScheduledPublications(
  now: Date = new Date(),
): Promise<{ checked: number; withheld: number }> {
  const due = await db
    .select({ id: chapters.id, novelId: chapters.novelId })
    .from(chapters)
    .where(
      and(
        isNotNull(chapters.publishedAt),
        gt(chapters.publishedAt, now),
        lte(chapters.publishedAt, new Date(now.getTime() + PUBLICATION_WITHHOLD_WINDOW_MS)),
        isNull(chapters.activeTranslationJobId),
        eq(chapters.status, "translated"),
      ),
    )
    .orderBy(asc(chapters.publishedAt), asc(chapters.id))
    .limit(WITHHOLD_BATCH_SIZE);

  if (due.length === 0) return { checked: 0, withheld: 0 };

  const byNovel = new Map<string, string[]>();
  for (const row of due) {
    const ids = byNovel.get(row.novelId);
    if (ids) ids.push(row.id);
    else byNovel.set(row.novelId, [row.id]);
  }

  let withheld = 0;
  for (const [novelId, chapterIds] of byNovel) {
    withheld += await db.transaction(async (tx) => {
      if (!(await lockNovelForMutation(tx, novelId))) return 0;
      const stillDue = await tx
        .select({ id: chapters.id })
        .from(chapters)
        .where(
          and(
            inArray(chapters.id, chapterIds),
            gt(chapters.publishedAt, now),
            eq(chapters.status, "translated"),
            isNull(chapters.activeTranslationJobId),
          ),
        )
        .for("update", { of: chapters });
      if (stillDue.length === 0) return 0;

      const verdicts = await loadPublicationVerdicts(
        tx,
        stillDue.map((row) => row.id),
      );
      const failing = stillDue.filter((row) => {
        const verdict = verdicts.get(row.id);
        return verdict !== undefined && !verdict.publishable;
      });
      if (failing.length === 0) return 0;

      await tx
        .update(chapters)
        .set({ publishedAt: null, updatedAt: now })
        .where(
          inArray(
            chapters.id,
            failing.map((row) => row.id),
          ),
        );
      return failing.length;
    });
  }

  return { checked: due.length, withheld };
}
