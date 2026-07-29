import { createServerFn } from "@tanstack/react-start";
import { eq, and, sql, desc } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { novels, chapters } from "@/lib/db/schema";
import { ensureSession, getSession } from "@/lib/auth.functions";
import { checkRateLimit, GUEST_READ_LIMIT } from "@/lib/rate-limit";
import { nanoid } from "@/lib/utils";
import { withSafeHandler, SafeServerError } from "@/lib/server-fn-error";
import { novelLive, chapterLive } from "@/lib/publish";
import { createNovelSchema, updateNovelSchema, setNovelPublishedSchema } from "@/lib/novel.schemas";

export const listNovels = createServerFn({ method: "GET" }).handler(async () => {
  return withSafeHandler(async () => {
    const session = await getSession();
    if (!session) await checkRateLimit("read", GUEST_READ_LIMIT);

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
        session
          ? eq(chapters.novelId, novels.id)
          : and(eq(chapters.novelId, novels.id), chapterLive()),
      )
      .where(session ? eq(novels.userId, session.user.id) : novelLive())
      .groupBy(novels.id)
      .orderBy(desc(novels.createdAt));

    return rows.map((row) => ({
      ...row,
      chapterCount: Number(row.chapterCount || 0),
      translatedCount: Number(row.translatedCount || 0),
      hasCover: Number(row.hasCover || 0),
    }));
  });
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
          hasCover: sql<boolean>`${novels.cover} is not null`,
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

      return {
        ...novel,
        sourceLang: novel.sourceLang as "en" | "zh",
        targetLang: novel.targetLang as "en" | "th",
        // Guests don't get admin-only settings — NovelCover fetches covers from the public /api/covers route.
        customPrompt: session ? novel.customPrompt : null,
      };
    });
  });

export function assertCoverMagicBytes(buffer: Uint8Array, mime: string): void {
  // Defense-in-depth: callers may pass null mime if schema bypassed; reject explicitly.
  if (!mime) {
    throw new SafeServerError("Cover MIME type is required to validate cover image");
  }
  if (mime === "image/png") {
    if (
      buffer.length < 4 ||
      buffer[0] !== 0x89 ||
      buffer[1] !== 0x50 ||
      buffer[2] !== 0x4e ||
      buffer[3] !== 0x47
    ) {
      throw new SafeServerError("Cover image magic bytes do not match declared PNG MIME type");
    }
  } else if (mime === "image/jpeg") {
    if (buffer.length < 3 || buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) {
      throw new SafeServerError("Cover image magic bytes do not match declared JPEG MIME type");
    }
  } else if (mime === "image/webp") {
    const isRiff =
      buffer.length >= 12 &&
      buffer[0] === 0x52 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x46;
    const isWebp =
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50;
    if (!isRiff || !isWebp) {
      throw new SafeServerError("Cover image magic bytes do not match declared WebP MIME type");
    }
  } else {
    throw new SafeServerError(`Unsupported cover MIME type: ${mime}`);
  }
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

      await db.insert(novels).values({
        id: novelId,
        userId: session.user.id,
        title: data.title,
        originalTitle: data.originalTitle,
        author: data.author,
        description: data.description,
        cover: coverBuffer,
        coverMime: data.coverMime,
        sourceLang: data.sourceLang,
        targetLang: data.targetLang,
        customPrompt: data.customPrompt,
        chunkSize: data.chunkSize,
        contextTailLength: data.contextTailLength,
      });

      return { id: novelId };
    });
  });

export const updateNovel = createServerFn({ method: "POST" })
  .validator(updateNovelSchema)
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await ensureSession();

      // Verify ownership
      const [existing] = await db
        .select({ id: novels.id })
        .from(novels)
        .where(and(eq(novels.id, data.novelId), eq(novels.userId, session.user.id)))
        .limit(1);

      if (!existing) {
        throw new SafeServerError("Novel not found or unauthorized");
      }

      const updateValues: Record<string, unknown> = {
        title: data.title,
        originalTitle: data.originalTitle,
        author: data.author,
        description: data.description,
        sourceLang: data.sourceLang,
        targetLang: data.targetLang,
        customPrompt: data.customPrompt,
        updatedAt: new Date(),
      };

      if (data.chunkSize !== undefined) updateValues.chunkSize = data.chunkSize;
      if (data.contextTailLength !== undefined)
        updateValues.contextTailLength = data.contextTailLength;

      if (data.removeCover) {
        updateValues.cover = null;
        updateValues.coverMime = null;
      } else if (data.cover) {
        const coverBuffer = Buffer.from(data.cover, "base64");
        assertCoverMagicBytes(coverBuffer, data.coverMime ?? "");
        updateValues.cover = coverBuffer;
        updateValues.coverMime = data.coverMime;
      }

      await db.update(novels).set(updateValues).where(eq(novels.id, data.novelId));

      return { id: data.novelId };
    });
  });

export const deleteNovel = createServerFn({ method: "POST" })
  .validator(z.object({ novelId: z.string() }))
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await ensureSession();

      // Verify ownership and delete (FK constraint cascade handles chapters)
      await db
        .delete(novels)
        .where(and(eq(novels.id, data.novelId), eq(novels.userId, session.user.id)));

      return { success: true };
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

      await db
        .update(novels)
        .set({ publishedAt: data.publishedAt, updatedAt: new Date() })
        .where(eq(novels.id, data.novelId));

      return { id: data.novelId };
    });
  });
