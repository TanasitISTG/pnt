import { createServerFn } from "@tanstack/react-start";
import { eq, and, sql, desc } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { novels, chapters } from "@/lib/db/schema";
import { ensureSession, getSession } from "@/lib/auth/functions";
import { checkRateLimit, GUEST_READ_LIMIT } from "@/lib/rate-limit";
import { nanoid } from "@/lib/utils";
import { withSafeHandler, SafeServerError } from "@/lib/server-fn-error";
import { createServerTiming } from "@/lib/server-timing";
import { novelLive, chapterVisibleToGuests } from "@/lib/content/publish/publish";
import {
  createNovelSchema,
  updateNovelSchema,
  setNovelPublishedSchema,
} from "@/lib/content/novel/novel.schemas";
import { deleteNovelForUser, updateNovelForUser } from "@/lib/content/novel/novel-edit.service";
import {
  getAdminNovelDetailCoreForUser,
  getAdminNovelDetailMetricsForUser,
} from "@/lib/content/novel/admin-novel-detail.service";
import {
  deleteCoverSet,
  resolvePublicCover,
  writeCoverSet,
} from "@/lib/content/novel/cover-storage.server";
import { assertImageMagicBytes } from "@/lib/images/magic-bytes";

export interface NovelListItem {
  id: string;
  title: string;
  originalTitle: string | null;
  author: string | null;
  description: string | null;
  sourceLang: string;
  targetLang: string;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  hasCover: number;
  chapterCount: number;
  translatedCount: number;
  /** Public CDN URL; null keeps the client on the proxied cover route. */
  coverUrl: string | null;
  coverSrcSet: string | null;
}

export const listNovels = createServerFn({ method: "GET" }).handler(async () => {
  const timing = createServerTiming();
  try {
    return await withSafeHandler(async () => {
      const session = await timing.measure("auth", () => getSession());
      if (!session)
        await timing.measure("rate-limit", () => checkRateLimit("read", GUEST_READ_LIMIT));

      const rows = await timing.measure("novels", () =>
        db
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
            hasCover: sql<number>`CASE WHEN ${novels.coverKey} IS NOT NULL THEN 1 ELSE 0 END`,
            coverKey: novels.coverKey,
            chapterCount: sql<number>`count(${chapters.id})::int`,
            translatedCount: sql<number>`count(case when ${chapters.status} = 'translated' then 1 end)::int`,
          })
          .from(novels)
          .leftJoin(
            chapters,
            session
              ? eq(chapters.novelId, novels.id)
              : and(eq(chapters.novelId, novels.id), chapterVisibleToGuests()),
          )
          .where(session ? eq(novels.userId, session.user.id) : novelLive())
          .groupBy(novels.id)
          .orderBy(desc(novels.createdAt)),
      );

      return rows.map((row) => {
        const cover = resolvePublicCover(row.coverKey, row.publishedAt);
        const { coverKey: _coverKey, ...item } = row;
        return {
          ...item,
          chapterCount: Number(row.chapterCount || 0),
          translatedCount: Number(row.translatedCount || 0),
          hasCover: Number(row.hasCover || 0),
          coverUrl: cover?.url ?? null,
          coverSrcSet: cover?.srcSet ?? null,
        };
      });
    });
  } finally {
    timing.flush();
  }
});

export const getNovel = createServerFn({ method: "GET" })
  .validator(z.object({ novelId: z.string() }))
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await getSession();
      if (!session) await checkRateLimit("read", GUEST_READ_LIMIT);

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
        .where(
          session
            ? and(eq(novels.id, data.novelId), eq(novels.userId, session.user.id))
            : and(eq(novels.id, data.novelId), novelLive()),
        )
        .limit(1);

      if (!novel) return null;

      const cover = resolvePublicCover(novel.coverKey, novel.publishedAt);
      const { coverKey, ...novelRest } = novel;
      return {
        ...novelRest,
        sourceLang: novel.sourceLang as "en" | "zh",
        targetLang: novel.targetLang as "en" | "th",
        hasCover: coverKey !== null,
        coverUrl: cover?.url ?? null,
        coverSrcSet: cover?.srcSet ?? null,
        // Guests don't get admin-only settings — NovelCover fetches covers from the public /api/covers route.
        customPrompt: session ? novel.customPrompt : null,
      };
    });
  });

export const getReaderNovel = createServerFn({ method: "GET" })
  .validator(z.object({ novelId: z.string() }))
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await getSession();
      if (!session) await checkRateLimit("read", GUEST_READ_LIMIT);

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
          session
            ? and(eq(novels.id, data.novelId), eq(novels.userId, session.user.id))
            : and(eq(novels.id, data.novelId), novelLive()),
        )
        .limit(1);

      return novel ?? null;
    });
  });
export const getAdminNovelDetailCore = createServerFn({ method: "GET" })
  .validator(z.object({ novelId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const timing = createServerTiming();
    try {
      return await withSafeHandler(async () => {
        const session = await timing.measure("auth", () => ensureSession());
        return timing.measure("core", () =>
          getAdminNovelDetailCoreForUser(session.user.id, data.novelId),
        );
      });
    } finally {
      timing.flush();
    }
  });

export const getAdminNovelDetailMetrics = createServerFn({ method: "GET" })
  .validator(z.object({ novelId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const timing = createServerTiming();
    try {
      return await withSafeHandler(async () => {
        const session = await timing.measure("auth", () => ensureSession());
        return timing.measure("metrics", () =>
          getAdminNovelDetailMetricsForUser(session.user.id, data.novelId),
        );
      });
    } finally {
      timing.flush();
    }
  });

/** Cover-labelled view of the shared upload check, kept for existing callers. */
export function assertCoverMagicBytes(buffer: Uint8Array, mime: string): void {
  assertImageMagicBytes(buffer, mime, "Cover");
}

export const createNovel = createServerFn({ method: "POST" })
  .validator(createNovelSchema)
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await ensureSession();
      const novelId = nanoid();

      const coverBuffer = data.cover ? Buffer.from(data.cover, "base64") : null;
      if (coverBuffer) {
        assertCoverMagicBytes(coverBuffer, data.coverMime ?? "");
      }

      // Objects are written before the row, so a novel never points at a missing
      // cover; if the insert fails the just-written objects are removed again.
      const coverKey = coverBuffer
        ? await writeCoverSet(novelId, coverBuffer, data.coverMime ?? "image/webp")
        : null;
      try {
        await db.insert(novels).values({
          id: novelId,
          userId: session.user.id,
          title: data.title,
          originalTitle: data.originalTitle,
          author: data.author,
          description: data.description,
          coverKey,
          coverMime: coverKey ? (data.coverMime ?? null) : null,
          sourceLang: data.sourceLang,
          targetLang: data.targetLang,
          customPrompt: data.customPrompt,
          chunkSize: data.chunkSize,
          contextTailLength: data.contextTailLength,
        });
      } catch (error) {
        await deleteCoverSet(coverKey).catch(() => {});
        throw error;
      }

      return { id: novelId };
    });
  });

export const updateNovel = createServerFn({ method: "POST" })
  .validator(updateNovelSchema)
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await ensureSession();
      const coverBuffer = data.cover ? Buffer.from(data.cover, "base64") : undefined;
      if (coverBuffer) {
        assertCoverMagicBytes(coverBuffer, data.coverMime ?? "");
      }
      return updateNovelForUser(session.user.id, data, coverBuffer);
    });
  });

export const deleteNovel = createServerFn({ method: "POST" })
  .validator(z.object({ novelId: z.string() }))
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await ensureSession();

      return deleteNovelForUser(session.user.id, data.novelId);
    });
  });

export const setNovelPublished = createServerFn({ method: "POST" })
  .validator(setNovelPublishedSchema)
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await ensureSession();

      const [existing] = await db
        .select({ id: novels.id })
        .from(novels)
        .where(and(eq(novels.id, data.novelId), eq(novels.userId, session.user.id)))
        .limit(1);

      if (!existing) {
        throw new SafeServerError("Novel not found or unauthorized");
      }

      const updated = await db
        .update(novels)
        .set({ publishedAt: data.publishedAt, updatedAt: new Date() })
        .where(and(eq(novels.id, data.novelId), eq(novels.userId, session.user.id)))
        .returning({ id: novels.id });
      if (updated.length === 0) {
        throw new SafeServerError("Novel not found or unauthorized");
      }

      return { id: data.novelId };
    });
  });
