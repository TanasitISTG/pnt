import "@tanstack/react-start/server-only";

import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { chapters, novels } from "@/lib/db/schema";
import { chapterVisibleToGuests, novelLive } from "@/lib/content/publish/publish";

export async function listReadableNovels(userId: string | null) {
  const rows = await db
    .select({
      id: novels.id,
      title: novels.title,
      originalTitle: novels.originalTitle,
      author: novels.author,
      description: novels.description,
      sourceLang: novels.sourceLang,
      targetLang: novels.targetLang,
      publishedAt: novels.publishedAt,
      createdAt: novels.createdAt,
      updatedAt: novels.updatedAt,
      hasCover: sql<number>`CASE WHEN ${novels.cover} IS NOT NULL THEN 1 ELSE 0 END`,
      chapterCount: sql<number>`count(${chapters.id})::int`,
      translatedCount: sql<number>`count(case when ${chapters.status} = 'translated' then 1 end)::int`,
    })
    .from(novels)
    .leftJoin(
      chapters,
      userId
        ? eq(chapters.novelId, novels.id)
        : and(eq(chapters.novelId, novels.id), chapterVisibleToGuests()),
    )
    .where(userId ? eq(novels.userId, userId) : novelLive())
    .groupBy(novels.id)
    .orderBy(desc(novels.createdAt));

  return rows.map((row) => ({
    ...row,
    chapterCount: Number(row.chapterCount || 0),
    translatedCount: Number(row.translatedCount || 0),
    hasCover: Number(row.hasCover || 0),
  }));
}

export async function getReadableNovel(userId: string | null, novelId: string) {
  const [novel] = await db
    .select({
      id: novels.id,
      title: novels.title,
      originalTitle: novels.originalTitle,
      author: novels.author,
      description: novels.description,
      sourceLang: novels.sourceLang,
      targetLang: novels.targetLang,
      customPrompt: novels.customPrompt,
      chunkSize: novels.chunkSize,
      contextTailLength: novels.contextTailLength,
      publishedAt: novels.publishedAt,
      hasCover: sql<boolean>`${novels.cover} is not null`,
      createdAt: novels.createdAt,
      updatedAt: novels.updatedAt,
    })
    .from(novels)
    .where(
      userId
        ? and(eq(novels.id, novelId), eq(novels.userId, userId))
        : and(eq(novels.id, novelId), novelLive()),
    )
    .limit(1);

  if (!novel) return null;

  return {
    ...novel,
    sourceLang: novel.sourceLang as "en" | "zh",
    targetLang: novel.targetLang as "en" | "th",
    // Guests don't get admin-only settings — NovelCover fetches covers from the public /api/covers route.
    customPrompt: userId ? novel.customPrompt : null,
  };
}

export async function getReadableReaderNovel(userId: string | null, novelId: string) {
  const [novel] = await db
    .select({
      id: novels.id,
      title: novels.title,
      description: novels.description,
      sourceLang: novels.sourceLang,
      targetLang: novels.targetLang,
    })
    .from(novels)
    .where(
      userId
        ? and(eq(novels.id, novelId), eq(novels.userId, userId))
        : and(eq(novels.id, novelId), novelLive()),
    )
    .limit(1);

  return novel ?? null;
}
