import "@tanstack/react-start/server-only";

import { and, asc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { chapters, novels } from "@/lib/db/schema";
import { SafeServerError } from "@/lib/server-fn-error";
import { chapterHasTranslation } from "@/lib/content/publish/publish";
import { resolvePublicCover } from "@/lib/content/novel/cover-storage.server";
import { getGlossaryStatsForOwnedNovel } from "@/lib/glossary/service";
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
      coverKey: novels.coverKey,
      createdAt: novels.createdAt,
      updatedAt: novels.updatedAt,
    })
    .from(novels)
    .where(and(eq(novels.id, novelId), eq(novels.userId, userId)))
    .limit(1);

  if (!novel) return null;
  const cover = resolvePublicCover(novel.coverKey, novel.publishedAt);

  const chapterList = await db
    .select({
      id: chapters.id,
      novelId: chapters.novelId,
      number: chapters.number,
      title: chapters.title,
      translatedTitle: chapters.translatedTitle,
      hasTranslation: chapterHasTranslation(),
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
    .orderBy(asc(chapters.number));

  const { coverKey, ...novelRest } = novel;
  return {
    novel: {
      ...novelRest,
      sourceLang: novel.sourceLang as "en" | "zh",
      targetLang: novel.targetLang as "en" | "th",
      hasCover: coverKey !== null,
      coverUrl: cover?.url ?? null,
      coverSrcSet: cover?.srcSet ?? null,
      // This core is only ever produced for the novel's owner (the query filters on
      // `userId`), and it hydrates the same cache entry `getNovel` fills, so the flag
      // has to be present on both shapes.
      canManage: true,
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

  // The residual-script scan deliberately stays out of this bundle: it reads
  // every translated chapter body, and the admin detail query is fetched often.
  const [glossaryStats, costData] = await Promise.all([
    getGlossaryStatsForOwnedNovel(novelId),
    getNovelCostsForOwnedNovel(userId, novelId),
  ]);

  return { glossaryStats, costData };
}
