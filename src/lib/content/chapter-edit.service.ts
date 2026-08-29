import "@tanstack/react-start/server-only";

import { and, asc, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { chapters, novels, translationJobs, translationOutbox } from "@/lib/db/schema";
import { SafeServerError } from "@/lib/server-fn-error";
import { dispatchTranslationOutboxEventBestEffort } from "@/lib/translation/workflow/outbox";
import { translationRunIdentity } from "@/lib/translation/workflow/job-state";
import { nanoid } from "@/lib/utils";
import type { ReorderChaptersInput } from "@/lib/content/novel.schemas";

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

function normalizeTranslatedTitle(value: string | null): string | null {
  return value === null || value.trim().length === 0 ? null : value;
}

export async function updateChapterForUser(
  userId: string,
  input: ChapterUpdateInput,
  dispatch: OutboxDispatch = dispatchTranslationOutboxEventBestEffort,
): Promise<{ id: string }> {
  const outboxId = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ chapter: chapters })
      .from(chapters)
      .innerJoin(novels, eq(chapters.novelId, novels.id))
      .where(and(eq(chapters.id, input.chapterId), eq(novels.userId, userId)))
      .limit(1)
      .for("update");

    if (!existing) throw new SafeServerError("Chapter not found or unauthorized");

    const chapter = existing.chapter;
    if (input.title !== undefined && input.title.trim().length === 0) {
      throw new SafeServerError("Source title is required");
    }
    if (input.rawContent !== undefined && input.rawContent.trim().length === 0) {
      throw new SafeServerError("Source content is required");
    }
    if (
      input.translatedContent !== undefined &&
      input.translatedContent !== null &&
      input.translatedContent.trim().length === 0
    ) {
      throw new SafeServerError("Translation cannot be empty");
    }
    const numberChanged =
      input.number !== undefined && Number(input.number) !== Number(chapter.number);
    const titleChanged = input.title !== undefined && input.title !== chapter.title;
    const rawContentChanged =
      input.rawContent !== undefined && input.rawContent !== chapter.rawContent;
    const sourceChanged = numberChanged || titleChanged || rawContentChanged;

    if (sourceChanged && input.sourceChangePolicy === undefined) {
      throw new SafeServerError("Choose whether to keep or clear the translation");
    }

    if (
      input.translatedContent === null &&
      !(sourceChanged && input.sourceChangePolicy === "clear")
    ) {
      throw new SafeServerError(
        "Translated content can only be cleared when clearing a source translation",
      );
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
      throw new SafeServerError("Translation cannot be empty");
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

    let cancelledJob: { id: string; generation: number } | undefined;
    if (chapter.activeTranslationJobId) {
      const [job] = await tx
        .update(translationJobs)
        .set({ status: "cancelled", updatedAt: now })
        .where(
          and(
            eq(translationJobs.id, chapter.activeTranslationJobId),
            sql`${translationJobs.status} IN ('pending', 'running')`,
          ),
        )
        .returning({ id: translationJobs.id, generation: translationJobs.generation });
      cancelledJob = job;
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

    await tx.update(chapters).set(updateValues).where(eq(chapters.id, input.chapterId));

    if (clearDerivedArtifacts) {
      await tx
        .update(novels)
        .set({ storySummary: null, updatedAt: now })
        .where(eq(novels.id, chapter.novelId));
    }

    if (!cancelledJob) return null;

    const id = nanoid();
    await tx.insert(translationOutbox).values({
      id,
      eventName: "translation/job.cancelled",
      payloadJson: JSON.stringify(translationRunIdentity(cancelledJob)),
    });
    return id;
  });

  if (outboxId) await dispatch(outboxId);
  return { id: input.chapterId };
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

    if (!novel) throw new SafeServerError("Novel not found or unauthorized");

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
      throw new SafeServerError("Chapter order is stale; refresh and try again");
    }

    if (novelChapters.some((chapter) => chapter.activeTranslationJobId !== null)) {
      throw new SafeServerError("Chapter order cannot change while translation is active");
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
      throw new SafeServerError("Chapter order requires positive chapter numbers");
    }

    const slotById = new Map(novelChapters.map((chapter) => [chapter.id, chapter.number]));
    const targets = input.chapterIds.map((chapterId) => slotById.get(chapterId));
    if (targets.some((number) => number === undefined)) {
      throw new SafeServerError("Chapter order is stale; refresh and try again");
    }

    const changed = novelChapters.filter((chapter) => {
      const target = slotById.get(chapter.id);
      const targetIndex = input.chapterIds.indexOf(chapter.id);
      return target !== undefined && novelChapters[targetIndex]?.number !== target;
    });
    const now = new Date();

    for (const [index, chapter] of changed.entries()) {
      await tx
        .update(chapters)
        .set({ number: `${-(index + 1)}` })
        .where(eq(chapters.id, chapter.id));
    }

    for (const chapter of changed) {
      const targetIndex = input.chapterIds.indexOf(chapter.id);
      const target = novelChapters[targetIndex]?.number;
      if (target === undefined) {
        throw new SafeServerError("Chapter order is stale; refresh and try again");
      }
      await tx
        .update(chapters)
        .set({
          number: target,
          sourceRevision: sql`${chapters.sourceRevision} + 1`,
          updatedAt: now,
        })
        .where(eq(chapters.id, chapter.id));
    }

    await tx
      .update(novels)
      .set({ storySummary: null, updatedAt: now })
      .where(eq(novels.id, input.novelId));

    return { reordered: changed.length };
  });
}
