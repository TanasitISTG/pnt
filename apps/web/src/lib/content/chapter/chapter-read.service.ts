import "@tanstack/react-start/server-only";

import { and, asc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { chapters, novels } from "@/lib/db/schema";
import { SafeServerError } from "@/lib/server-fn-error";
import {
  chapterTranslationPresent,
  chapterVisibleToGuests,
  novelLive,
} from "@/lib/content/publish/publish";
import { normalizePunctuation } from "@/lib/translation/text/paragraphs";

export async function listReadableChapters(userId: string | null, novelId: string) {
  const [novel] = await db
    .select({ id: novels.id })
    .from(novels)
    .where(
      userId
        ? and(eq(novels.id, novelId), eq(novels.userId, userId))
        : and(eq(novels.id, novelId), novelLive()),
    )
    .limit(1);

  if (!novel) {
    throw new SafeServerError("Novel not found or unauthorized");
  }

  return db
    .select({
      id: chapters.id,
      novelId: chapters.novelId,
      number: chapters.number,
      title: chapters.title,
      translatedTitle: chapters.translatedTitle,
      hasTranslation: chapterTranslationPresent(),
      rawCharCount: chapters.rawCharCount,
      status: chapters.status,
      publishedAt: chapters.publishedAt,
      translatedAt: chapters.translatedAt,
      editedAt: chapters.editedAt,
      createdAt: chapters.createdAt,
      updatedAt: chapters.updatedAt,
    })
    .from(chapters)
    .where(
      userId
        ? eq(chapters.novelId, novelId)
        : and(eq(chapters.novelId, novelId), chapterVisibleToGuests()),
    )
    .orderBy(asc(chapters.number));
}

export async function getReadableChapterManifest(userId: string | null, novelId: string) {
  const rows = await db
    .select({
      id: chapters.id,
      number: chapters.number,
      title: chapters.title,
      translatedTitle: chapters.translatedTitle,
    })
    .from(chapters)
    .innerJoin(novels, eq(chapters.novelId, novels.id))
    .where(
      userId
        ? and(eq(chapters.novelId, novelId), eq(novels.userId, userId))
        : and(eq(chapters.novelId, novelId), novelLive(), chapterVisibleToGuests()),
    )
    .orderBy(asc(chapters.number));

  if (rows.length === 0) {
    const [novel] = await db
      .select({ id: novels.id })
      .from(novels)
      .where(
        userId
          ? and(eq(novels.id, novelId), eq(novels.userId, userId))
          : and(eq(novels.id, novelId), novelLive()),
      )
      .limit(1);
    if (!novel) throw new SafeServerError("Novel not found or unauthorized");
  }

  return rows;
}

export async function getReadableChapter(userId: string | null, chapterId: string) {
  const [chapter] = await db
    .select({
      id: chapters.id,
      novelId: chapters.novelId,
      number: chapters.number,
      title: chapters.title,
      translatedTitle: chapters.translatedTitle,
      rawContent: chapters.rawContent,
      translatedContent: chapters.translatedContent,
      status: chapters.status,
      summary: chapters.summary,
      rawCharCount: chapters.rawCharCount,
      publishedAt: chapters.publishedAt,
      translatedAt: chapters.translatedAt,
      editedAt: chapters.editedAt,
      createdAt: chapters.createdAt,
      updatedAt: chapters.updatedAt,
    })
    .from(chapters)
    .innerJoin(novels, eq(chapters.novelId, novels.id))
    .where(
      userId
        ? and(eq(chapters.id, chapterId), eq(novels.userId, userId))
        : and(eq(chapters.id, chapterId), chapterVisibleToGuests(), novelLive()),
    )
    .limit(1);

  if (!chapter) return null;

  return {
    ...chapter,
    translatedContent: chapter.translatedContent
      ? normalizePunctuation(chapter.translatedContent)
      : chapter.translatedContent,
  };
}
