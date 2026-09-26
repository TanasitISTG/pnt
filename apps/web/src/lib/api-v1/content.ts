import "@tanstack/react-start/server-only";

import {
  chapterBodyV1Schema,
  chapterManifestV1Schema,
  chapterSummaryV1Schema,
  novelDetailV1Schema,
  novelListV1Schema,
} from "@pnt/contracts/content";
import { listReadableNovels, getReadableNovel } from "@/lib/content/novel/novel-read.service";
import {
  getReadableChapter,
  getReadableChapterManifest,
  listReadableChapters,
} from "@/lib/content/chapter/chapter-read.service";
import { notFound } from "@/lib/api-v1/handler";

const iso = (date: Date | null) => date?.toISOString() ?? null;

export async function listNovelsV1(userId: string | null) {
  const rows = await listReadableNovels(userId);
  return rows.map((row) =>
    novelListV1Schema.parse({
      id: row.id,
      title: row.title,
      originalTitle: row.originalTitle,
      author: row.author,
      description: row.description,
      sourceLang: row.sourceLang,
      targetLang: row.targetLang,
      publishedAt: iso(row.publishedAt),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      hasCover: Boolean(row.hasCover),
      chapterCount: row.chapterCount,
      translatedCount: row.translatedCount,
    }),
  );
}

export async function getNovelV1(userId: string | null, novelId: string) {
  const row = await getReadableNovel(userId, novelId);
  if (!row) return notFound("Novel not found or unauthorized");
  return novelDetailV1Schema.parse({
    id: row.id,
    title: row.title,
    originalTitle: row.originalTitle,
    author: row.author,
    description: row.description,
    sourceLang: row.sourceLang,
    targetLang: row.targetLang,
    publishedAt: iso(row.publishedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    hasCover: row.hasCover,
  });
}

export async function listChaptersV1(userId: string | null, novelId: string) {
  const rows = await listReadableChapters(userId, novelId);
  return rows.map((row) =>
    chapterSummaryV1Schema.parse({
      id: row.id,
      novelId: row.novelId,
      number: row.number,
      title: row.title,
      translatedTitle: row.translatedTitle,
      hasTranslation: row.hasTranslation,
      status: row.status,
      publishedAt: iso(row.publishedAt),
      updatedAt: row.updatedAt.toISOString(),
    }),
  );
}

export async function getManifestV1(userId: string | null, novelId: string) {
  return chapterManifestV1Schema.parse(await getReadableChapterManifest(userId, novelId));
}

export async function getChapterV1(userId: string | null, novelId: string, chapterId: string) {
  const row = await getReadableChapter(userId, chapterId);
  if (!row || row.novelId !== novelId) return notFound("Chapter not found or unauthorized");
  return chapterBodyV1Schema.parse({
    id: row.id,
    novelId: row.novelId,
    number: row.number,
    title: row.title,
    translatedTitle: row.translatedTitle,
    rawContent: row.rawContent,
    translatedContent: row.translatedContent,
    status: row.status,
    updatedAt: row.updatedAt.toISOString(),
  });
}
