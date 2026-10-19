import "@tanstack/react-start/server-only";

import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { encodeMessage } from "@/lib/i18n/message-code";
import { lockNovelForMutation } from "@/lib/db/novel-lock";
import { chapterTranslationVersions, chapters, novels } from "@/lib/db/schema";
import { SafeServerError } from "@/lib/server-fn-error";
import { nanoid } from "@/lib/utils";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * How many generations of one chapter are kept.
 *
 * A re-translate plus the glossary pass that prompted it is two rows; twenty leaves room for
 * a week of ordinary repair without letting a chapter that is retranslated daily grow without
 * bound. The cap is enforced by the transaction that appends, so the table never holds more
 * than this per chapter, not even briefly.
 */
export const CHAPTER_TRANSLATION_HISTORY_LIMIT = 20;

export type ChapterTranslationOrigin = (typeof chapterTranslationVersions.$inferInsert)["origin"];

export interface ChapterVersionInput {
  chapterId: string;
  generation: number;
  sourceRevision: number;
  origin: ChapterTranslationOrigin;
  jobId?: string | null;
  translatedTitle: string | null;
  content: string;
  summary: string | null;
}

/**
 * Appends one version per chapter, then trims each chapter back to the cap.
 *
 * The caller owns the transaction and has already written `chapters.translated_content` in
 * it: recording here is what makes the newest row the current text, and doing it in the same
 * transaction is what keeps a crash from leaving a translation with no history. A blank body
 * is not a version — a cleared chapter is represented by the absence of new rows, not by an
 * empty one.
 */
export async function recordChapterVersions(
  tx: DbTransaction,
  inputs: readonly ChapterVersionInput[],
): Promise<void> {
  const rows = inputs.filter((input) => input.content.trim().length > 0);
  if (rows.length === 0) return;

  await tx.insert(chapterTranslationVersions).values(
    rows.map((input) => ({
      id: nanoid(),
      chapterId: input.chapterId,
      generation: input.generation,
      sourceRevision: input.sourceRevision,
      origin: input.origin,
      jobId: input.jobId ?? null,
      translatedTitle: input.translatedTitle,
      content: input.content,
      summary: input.summary,
      charCount: input.content.length,
    })),
  );

  const chapterIds = [...new Set(rows.map((row) => row.chapterId))];
  await tx.execute(sql`
    DELETE FROM "chapter_translation_versions"
    WHERE "id" IN (
      SELECT ranked."id"
      FROM (
        SELECT
          "id",
          row_number() OVER (
            PARTITION BY "chapter_id"
            ORDER BY "created_at" DESC, "id" DESC
          ) AS "position"
        FROM "chapter_translation_versions"
        WHERE ${inArray(chapterTranslationVersions.chapterId, chapterIds)}
      ) AS ranked
      WHERE ranked."position" > ${CHAPTER_TRANSLATION_HISTORY_LIMIT}
    )
  `);
}

/** The single-chapter form of `recordChapterVersions`, for the writers that touch one row. */
export async function recordChapterVersion(
  tx: DbTransaction,
  input: ChapterVersionInput,
): Promise<void> {
  await recordChapterVersions(tx, [input]);
}

export interface ChapterVersionSummary {
  id: string;
  generation: number;
  sourceRevision: number;
  origin: ChapterTranslationOrigin;
  translatedTitle: string | null;
  charCount: number;
  createdAt: Date;
}

export interface ChapterVersionDetail extends ChapterVersionSummary {
  content: string;
  chapterId: string;
}

async function assertChapterOwnedByUser(userId: string, chapterId: string): Promise<void> {
  const [chapter] = await db
    .select({ id: chapters.id })
    .from(chapters)
    .innerJoin(novels, eq(chapters.novelId, novels.id))
    .where(and(eq(chapters.id, chapterId), eq(novels.userId, userId)))
    .limit(1);
  if (!chapter) throw new SafeServerError(encodeMessage("errors.chapterNotFoundOrUnauthorized"));
}

/**
 * The trail for one chapter, newest first.
 *
 * Metadata only: a chapter can be tens of kilobytes, and the list is read every time the
 * dialog opens. The body is fetched per selection, which is also what the diff needs.
 */
export async function listChapterTranslationVersionsForUser(
  userId: string,
  chapterId: string,
): Promise<ChapterVersionSummary[]> {
  await assertChapterOwnedByUser(userId, chapterId);
  return db
    .select({
      id: chapterTranslationVersions.id,
      generation: chapterTranslationVersions.generation,
      sourceRevision: chapterTranslationVersions.sourceRevision,
      origin: chapterTranslationVersions.origin,
      translatedTitle: chapterTranslationVersions.translatedTitle,
      charCount: chapterTranslationVersions.charCount,
      createdAt: chapterTranslationVersions.createdAt,
    })
    .from(chapterTranslationVersions)
    .where(eq(chapterTranslationVersions.chapterId, chapterId))
    .orderBy(desc(chapterTranslationVersions.createdAt), desc(chapterTranslationVersions.id))
    .limit(CHAPTER_TRANSLATION_HISTORY_LIMIT);
}

export async function getChapterTranslationVersionForUser(
  userId: string,
  versionId: string,
): Promise<ChapterVersionDetail> {
  const [row] = await db
    .select({
      id: chapterTranslationVersions.id,
      chapterId: chapterTranslationVersions.chapterId,
      generation: chapterTranslationVersions.generation,
      sourceRevision: chapterTranslationVersions.sourceRevision,
      origin: chapterTranslationVersions.origin,
      translatedTitle: chapterTranslationVersions.translatedTitle,
      content: chapterTranslationVersions.content,
      charCount: chapterTranslationVersions.charCount,
      createdAt: chapterTranslationVersions.createdAt,
    })
    .from(chapterTranslationVersions)
    .innerJoin(chapters, eq(chapterTranslationVersions.chapterId, chapters.id))
    .innerJoin(novels, eq(chapters.novelId, novels.id))
    .where(and(eq(chapterTranslationVersions.id, versionId), eq(novels.userId, userId)))
    .limit(1);

  if (!row) {
    throw new SafeServerError(encodeMessage("errors.translationVersionNotFoundOrUnauthorized"));
  }
  return row;
}

/**
 * Puts a stored generation back as the chapter's current translation.
 *
 * The restore is a write like any other: it takes the novel's mutation gate, refuses while a
 * run owns the chapter (a rollback racing a translator would be overwritten by finalization),
 * and appends its own `rollback` version so the restore is visible in the list and can itself
 * be undone. Publication is deliberately left alone — an owner restoring a live chapter's text
 * means that text is what readers should see, not that the chapter should disappear. Derived
 * artifacts that described the replaced translation (the chapter summary, the novel's rolling
 * summary) are cleared, exactly as a manual edit clears them.
 */
export async function restoreChapterTranslationForUser(
  userId: string,
  versionId: string,
): Promise<{ chapterId: string }> {
  return db.transaction(async (tx) => {
    const [parent] = await tx
      .select({ novelId: chapters.novelId })
      .from(chapterTranslationVersions)
      .innerJoin(chapters, eq(chapterTranslationVersions.chapterId, chapters.id))
      .where(eq(chapterTranslationVersions.id, versionId))
      .limit(1);

    if (!parent || !(await lockNovelForMutation(tx, parent.novelId, userId))) {
      throw new SafeServerError(encodeMessage("errors.translationVersionNotFoundOrUnauthorized"));
    }

    const [row] = await tx
      .select({
        version: {
          content: chapterTranslationVersions.content,
          translatedTitle: chapterTranslationVersions.translatedTitle,
          createdAt: chapterTranslationVersions.createdAt,
        },
        chapter: {
          id: chapters.id,
          novelId: chapters.novelId,
          translatedContent: chapters.translatedContent,
          translatedTitle: chapters.translatedTitle,
          generation: chapters.translationGeneration,
          sourceRevision: chapters.sourceRevision,
          activeTranslationJobId: chapters.activeTranslationJobId,
        },
      })
      .from(chapterTranslationVersions)
      .innerJoin(chapters, eq(chapterTranslationVersions.chapterId, chapters.id))
      .innerJoin(novels, eq(chapters.novelId, novels.id))
      .where(
        and(
          eq(chapterTranslationVersions.id, versionId),
          eq(chapters.novelId, parent.novelId),
          eq(novels.userId, userId),
        ),
      )
      .limit(1)
      .for("update", { of: chapters });

    if (!row) {
      throw new SafeServerError(encodeMessage("errors.translationVersionNotFoundOrUnauthorized"));
    }
    if (row.chapter.activeTranslationJobId) {
      throw new SafeServerError(encodeMessage("errors.chapterTranslationActive"));
    }

    const now = new Date();
    const unchanged =
      row.chapter.translatedContent === row.version.content &&
      row.chapter.translatedTitle === row.version.translatedTitle;
    if (unchanged) return { chapterId: row.chapter.id };

    await tx
      .update(chapters)
      .set({
        translatedContent: row.version.content,
        translatedTitle: row.version.translatedTitle,
        summary: null,
        status: "translated",
        translatedAt: row.version.createdAt,
        editedAt: now,
        updatedAt: now,
      })
      .where(eq(chapters.id, row.chapter.id));

    await tx
      .update(novels)
      .set({ storySummary: null, updatedAt: now })
      .where(eq(novels.id, row.chapter.novelId));

    await recordChapterVersion(tx, {
      chapterId: row.chapter.id,
      generation: row.chapter.generation,
      sourceRevision: row.chapter.sourceRevision,
      origin: "rollback",
      translatedTitle: row.version.translatedTitle,
      content: row.version.content,
      summary: null,
    });

    return { chapterId: row.chapter.id };
  });
}
