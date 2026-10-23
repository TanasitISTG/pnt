import "@tanstack/react-start/server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { encodeMessage } from "@/lib/i18n/message-code";
import { lockNovelForMutation } from "@/lib/db/novel-lock";
import { chapters, novels, translationJobs } from "@/lib/db/schema";
import { SafeServerError } from "@/lib/server-fn-error";
import { dispatchWorkflowOutboxEventBestEffort } from "@/lib/inngest/outbox";
import { cancelActiveTranslationJobsInTransaction } from "@/lib/translation/workflow/cancel";
import { recordChapterVersion } from "@/lib/content/chapter/chapter-history.service";
import { evaluatePublicationText, type PublicationBlock } from "@/lib/content/publish/readiness";
import type { ReorderChaptersInput } from "@/lib/content/novel/novel.schemas";

type OutboxDispatch = (outboxId: string) => Promise<void>;

export type ChapterUpdateInput = {
  chapterId: string;
  number?: number;
  title?: string;
  translatedTitle?: string | null;
  rawContent?: string;
  translatedContent?: string | null;
  sourceChangePolicy?: "keep" | "clear";
};

export type ChapterUpdateResult = {
  id: string;
  /**
   * The block that withdrew a still-future publication, or null.
   *
   * A schedule is a promise the clock keeps without another write, so the only way it can be
   * broken before its time is a text change — and this is the path where the owner is present
   * to be told. The studio also re-reads the verdict afterwards, which is what marks the row.
   */
  withheld: PublicationBlock | null;
};

function normalizeTranslatedTitle(value: string | null): string | null {
  return value === null || value.trim().length === 0 ? null : value;
}

export async function updateChapterForUser(
  userId: string,
  input: ChapterUpdateInput,
  dispatch: OutboxDispatch = dispatchWorkflowOutboxEventBestEffort,
): Promise<ChapterUpdateResult> {
  const outcome = await db.transaction(async (tx) => {
    const [parent] = await tx
      .select({ novelId: chapters.novelId })
      .from(chapters)
      .where(eq(chapters.id, input.chapterId))
      .limit(1);
    if (!parent || !(await lockNovelForMutation(tx, parent.novelId, userId))) {
      throw new SafeServerError(encodeMessage("errors.chapterNotFoundOrUnauthorized"));
    }
    const [existing] = await tx
      .select({ chapter: chapters })
      .from(chapters)
      .innerJoin(novels, eq(chapters.novelId, novels.id))
      .where(
        and(
          eq(chapters.id, input.chapterId),
          eq(chapters.novelId, parent.novelId),
          eq(novels.userId, userId),
        ),
      )
      .limit(1)
      .for("update", { of: chapters });

    if (!existing) throw new SafeServerError(encodeMessage("errors.chapterNotFoundOrUnauthorized"));

    const chapter = existing.chapter;
    if (input.title !== undefined && input.title.trim().length === 0) {
      throw new SafeServerError(encodeMessage("validation.sourceTitleRequired"));
    }
    if (input.rawContent !== undefined && input.rawContent.trim().length === 0) {
      throw new SafeServerError(encodeMessage("validation.sourceContentRequired"));
    }
    if (
      input.translatedContent !== undefined &&
      input.translatedContent !== null &&
      input.translatedContent.trim().length === 0
    ) {
      throw new SafeServerError(encodeMessage("validation.translationRequired"));
    }
    const numberChanged =
      input.number !== undefined && Number(input.number) !== Number(chapter.number);
    const titleChanged = input.title !== undefined && input.title !== chapter.title;
    const rawContentChanged =
      input.rawContent !== undefined && input.rawContent !== chapter.rawContent;
    const sourceChanged = numberChanged || titleChanged || rawContentChanged;

    if (sourceChanged && input.sourceChangePolicy === undefined) {
      throw new SafeServerError(encodeMessage("errors.chapterTranslationDecisionRequired"));
    }

    if (
      input.translatedContent === null &&
      !(sourceChanged && input.sourceChangePolicy === "clear")
    ) {
      throw new SafeServerError(encodeMessage("errors.translationClearRequiresSourceClear"));
    }

    const nextTranslatedTitle =
      sourceChanged && input.sourceChangePolicy === "clear"
        ? null
        : input.translatedTitle !== undefined
          ? normalizeTranslatedTitle(input.translatedTitle)
          : chapter.translatedTitle;
    const nextTranslatedContent =
      sourceChanged && input.sourceChangePolicy === "clear"
        ? null
        : input.translatedContent !== undefined
          ? input.translatedContent
          : chapter.translatedContent;

    if (nextTranslatedContent === "") {
      throw new SafeServerError(encodeMessage("validation.translationRequired"));
    }

    const translatedTitleChanged = nextTranslatedTitle !== chapter.translatedTitle;
    const translatedContentChanged = nextTranslatedContent !== chapter.translatedContent;
    const hasChange = sourceChanged || translatedTitleChanged || translatedContentChanged;

    if (!hasChange) return null;

    const now = new Date();
    const clearingSourceTranslation = sourceChanged && input.sourceChangePolicy === "clear";
    const keptTranslation =
      sourceChanged &&
      input.sourceChangePolicy === "keep" &&
      (nextTranslatedTitle !== null || nextTranslatedContent !== null);
    const manualTranslationChanged =
      !clearingSourceTranslation && (translatedTitleChanged || translatedContentChanged);
    const resultingStatus = nextTranslatedContent === null ? "raw" : "translated";
    const nextTranslatedAt =
      nextTranslatedContent === null ? null : translatedContentChanged ? now : chapter.translatedAt;
    const nextEditedAt =
      nextTranslatedContent === null && nextTranslatedTitle === null
        ? null
        : manualTranslationChanged || keptTranslation
          ? now
          : chapter.editedAt;
    const clearDerivedArtifacts = sourceChanged || translatedContentChanged;

    // Withdrawing a not-yet-visible schedule is the one publication side effect an edit may
    // have: the chapter never reached readers, so nothing is taken away from them.
    const withheld =
      chapter.publishedAt !== null &&
      chapter.publishedAt > now &&
      nextTranslatedContent !== null &&
      clearDerivedArtifacts
        ? evaluatePublicationText(input.rawContent ?? chapter.rawContent, nextTranslatedContent)
        : null;

    let cancellationOutboxId: string | null = null;
    if (chapter.activeTranslationJobId) {
      const [activeJob] = await tx
        .select({
          id: translationJobs.id,
          generation: translationJobs.generation,
          logsJson: translationJobs.logsJson,
        })
        .from(translationJobs)
        .where(
          and(
            eq(translationJobs.id, chapter.activeTranslationJobId),
            eq(translationJobs.chapterId, chapter.id),
          ),
        )
        .for("update");
      if (activeJob) {
        const cancellation = await cancelActiveTranslationJobsInTransaction(
          tx,
          [
            {
              jobId: activeJob.id,
              generation: activeJob.generation,
              logsJson: activeJob.logsJson,
              message: encodeMessage("log.cancelledChapterEdited"),
            },
          ],
          now,
        );
        cancellationOutboxId = cancellation.outboxIds[0] ?? null;
      }
    }

    const updateValues: Record<string, unknown> = {
      translatedTitle: nextTranslatedTitle,
      translatedContent: nextTranslatedContent,
      status: resultingStatus,
      translatedAt: nextTranslatedAt,
      editedAt: nextEditedAt,
      activeTranslationJobId: null,
      updatedAt: now,
    };
    if (sourceChanged) {
      updateValues.number = input.number !== undefined ? input.number.toString() : chapter.number;
      updateValues.title = input.title ?? chapter.title;
      updateValues.rawContent = input.rawContent ?? chapter.rawContent;
      updateValues.sourceRevision = sql`${chapters.sourceRevision} + 1`;
      if (rawContentChanged) updateValues.rawCharCount = input.rawContent?.length;
    }
    if (clearDerivedArtifacts) updateValues.summary = null;
    if (withheld) updateValues.publishedAt = null;

    await tx.update(chapters).set(updateValues).where(eq(chapters.id, input.chapterId));

    if (clearDerivedArtifacts) {
      await tx
        .update(novels)
        .set({ storySummary: null, updatedAt: now })
        .where(eq(novels.id, chapter.novelId));
    }

    // A manual edit is a generation too, and it is the one history matters most for: this is
    // the write an owner wants back after a mistaken save. The title alone counts, because
    // the snapshot is what the reader was shown, heading included.
    if (nextTranslatedContent !== null && (translatedContentChanged || translatedTitleChanged)) {
      await recordChapterVersion(tx, {
        chapterId: chapter.id,
        generation: chapter.translationGeneration,
        // The update above already advanced the revision when the source changed; the version
        // has to name the revision the text belongs to, not the one it replaced.
        sourceRevision: chapter.sourceRevision + (sourceChanged ? 1 : 0),
        origin: "manual",
        translatedTitle: nextTranslatedTitle,
        content: nextTranslatedContent,
        summary: clearDerivedArtifacts ? null : chapter.summary,
      });
    }

    return { cancellationOutboxId, withheld };
  });

  if (!outcome) return { id: input.chapterId, withheld: null };
  if (outcome.cancellationOutboxId) await dispatch(outcome.cancellationOutboxId);
  return { id: input.chapterId, withheld: outcome.withheld };
}

export async function reorderChaptersForUser(
  userId: string,
  input: ReorderChaptersInput,
): Promise<{ reordered: number }> {
  return db.transaction(async (tx) => {
    const [novel] = await tx
      .select({ id: novels.id })
      .from(novels)
      .where(and(eq(novels.id, input.novelId), eq(novels.userId, userId)))
      .limit(1)
      .for("update");

    if (!novel) throw new SafeServerError(encodeMessage("errors.novelNotFoundOrUnauthorized"));

    const novelChapters = await tx
      .select()
      .from(chapters)
      .where(eq(chapters.novelId, input.novelId))
      .orderBy(asc(chapters.number), asc(chapters.id))
      .for("update");

    const submittedIds = new Set(input.chapterIds);
    if (
      novelChapters.length !== input.chapterIds.length ||
      submittedIds.size !== novelChapters.length ||
      novelChapters.some((chapter) => !submittedIds.has(chapter.id))
    ) {
      throw new SafeServerError(encodeMessage("errors.chapterOrderStale"));
    }

    if (novelChapters.some((chapter) => chapter.activeTranslationJobId !== null)) {
      throw new SafeServerError(encodeMessage("errors.chapterOrderTranslationActive"));
    }

    if (novelChapters.every((chapter, index) => chapter.id === input.chapterIds[index])) {
      return { reordered: 0 };
    }

    if (
      novelChapters.some((chapter) => {
        const number = Number(chapter.number);
        return !Number.isFinite(number) || number <= 0;
      })
    ) {
      throw new SafeServerError(encodeMessage("errors.chapterOrderPositiveNumbers"));
    }

    const slotById = new Map(novelChapters.map((chapter) => [chapter.id, chapter.number]));
    const targets = input.chapterIds.map((chapterId) => slotById.get(chapterId));
    if (targets.some((number) => number === undefined)) {
      throw new SafeServerError(encodeMessage("errors.chapterOrderStale"));
    }

    const changed = novelChapters.filter((chapter) => {
      const target = slotById.get(chapter.id);
      const targetIndex = input.chapterIds.indexOf(chapter.id);
      return target !== undefined && novelChapters[targetIndex]?.number !== target;
    });
    const now = new Date();
    const changedIds = changed.map((chapter) => chapter.id);
    const finalNumbers = changed.map((chapter) => {
      const targetIndex = input.chapterIds.indexOf(chapter.id);
      const target = novelChapters[targetIndex]?.number;
      if (target === undefined) {
        throw new SafeServerError(encodeMessage("errors.chapterOrderStale"));
      }
      return { id: chapter.id, number: target };
    });

    if (changedIds.length > 0) {
      const temporaryNumberCase = sql.join(
        changed.map((chapter, index) => sql`WHEN ${chapter.id} THEN ${-(index + 1)}`),
        sql` `,
      );
      await tx
        .update(chapters)
        .set({
          number: sql`CASE ${chapters.id} ${temporaryNumberCase} ELSE ${chapters.number} END`,
        })
        .where(inArray(chapters.id, changedIds));

      const finalNumberCase = sql.join(
        finalNumbers.map(({ id, number }) => sql`WHEN ${id} THEN ${number}`),
        sql` `,
      );
      await tx
        .update(chapters)
        .set({
          number: sql`CASE ${chapters.id} ${finalNumberCase} ELSE ${chapters.number} END`,
          sourceRevision: sql`${chapters.sourceRevision} + 1`,
          updatedAt: now,
        })
        .where(inArray(chapters.id, changedIds));
    }

    await tx
      .update(novels)
      .set({ storySummary: null, updatedAt: now })
      .where(eq(novels.id, input.novelId));

    return { reordered: changed.length };
  });
}
