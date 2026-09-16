import "@tanstack/react-start/server-only";

import { and, asc, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { chapters, novels } from "@/lib/db/schema";
import { SafeServerError } from "@/lib/server-fn-error";
import { chapterTranslationPresent } from "@/lib/content/publish/publish";
import { getGlossaryStatsForOwnedNovel } from "@/lib/glossary/service";
import {
  getResidualScriptChaptersForOwnedNovel,
  type ResidualScriptChapter,
} from "@/lib/content/chapter/chapter-ops.service";
import { getNovelCostsForOwnedNovel } from "@/lib/translation/cost-service";

export async function getAdminNovelDetailCoreForUser(userId: string, novelId: string) {
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
    .where(and(eq(novels.id, novelId), eq(novels.userId, userId)))
    .limit(1);

  if (!novel) return null;

  const chapterList = await db
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
    .where(eq(chapters.novelId, novelId))
    .orderBy(asc(sql`COALESCE(${chapters.number}::numeric, 0)`));

  return {
    novel: {
      ...novel,
      sourceLang: novel.sourceLang as "en" | "zh",
      targetLang: novel.targetLang as "en" | "th",
    },
    chapters: chapterList,
  };
}

export type AdminNovelDetailCore = NonNullable<
  Awaited<ReturnType<typeof getAdminNovelDetailCoreForUser>>
>;

export interface AdminNovelDetailMetrics {
  glossaryStats: Awaited<ReturnType<typeof getGlossaryStatsForOwnedNovel>>;
  costData: Awaited<ReturnType<typeof getNovelCostsForOwnedNovel>>;
  residualScriptChapters: ResidualScriptChapter[];
}

export async function getAdminNovelDetailMetricsForUser(
  userId: string,
  novelId: string,
): Promise<AdminNovelDetailMetrics> {
  const [novel] = await db
    .select({ id: novels.id })
    .from(novels)
    .where(and(eq(novels.id, novelId), eq(novels.userId, userId)))
    .limit(1);
  if (!novel) throw new SafeServerError("Novel not found or unauthorized");

  const [glossaryStats, costData, residualScriptChapters] = await Promise.all([
    getGlossaryStatsForOwnedNovel(novelId),
    getNovelCostsForOwnedNovel(userId, novelId),
    getResidualScriptChaptersForOwnedNovel(novelId),
  ]);

  return { glossaryStats, costData, residualScriptChapters };
}
