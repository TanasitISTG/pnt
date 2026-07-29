import { createServerFn } from "@tanstack/react-start";
import { eq, and, sql, asc } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { novels, chapters } from "@/lib/db/schema";
import { ensureSession, getSession } from "@/lib/auth.functions";
import { checkRateLimit, GUEST_READ_LIMIT } from "@/lib/rate-limit";
import { nanoid } from "@/lib/utils";
import { withSafeHandler, SafeServerError } from "@/lib/server-fn-error";
import { novelLive, chapterLive } from "@/lib/publish";
import { normalizePunctuation } from "@/lib/translation/paragraphs";
import {
  createChapterSchema,
  updateChapterSchema,
  updateChapterTranslationSchema,
  setNovelPublishedSchema,
  setChapterPublishedSchema,
} from "@/lib/novel.schemas";

export const listChapters = createServerFn({ method: "GET" })
  .validator(z.object({ novelId: z.string() }))
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await getSession();
      if (!session) await checkRateLimit("read", GUEST_READ_LIMIT);

      // Admin: verify ownership. Guest: novel must be live.
      const [novel] = await db
        .select({ id: novels.id })
        .from(novels)
        .where(
          session
            ? and(eq(novels.id, data.novelId), eq(novels.userId, session.user.id))
            : and(eq(novels.id, data.novelId), novelLive()),
        )
        .limit(1);

      if (!novel) {
        throw new SafeServerError("Novel not found or unauthorized");
      }

      const chapterList = await db
        .select({
          id: chapters.id,
          novelId: chapters.novelId,
          number: chapters.number,
          title: chapters.title,
          translatedTitle: chapters.translatedTitle,
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
          session
            ? eq(chapters.novelId, data.novelId)
            : and(eq(chapters.novelId, data.novelId), chapterLive()),
        )
        .orderBy(asc(sql`COALESCE(${chapters.number}::numeric, 0)`));

      return chapterList;
    });
  });

export const getChapter = createServerFn({ method: "GET" })
  .validator(z.object({ chapterId: z.string() }))
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await getSession();
      if (!session) await checkRateLimit("read", GUEST_READ_LIMIT);

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
          session
            ? and(eq(chapters.id, data.chapterId), eq(novels.userId, session.user.id))
            : and(eq(chapters.id, data.chapterId), chapterLive(), novelLive()),
        )
        .limit(1);

      if (!chapter) return null;

      return {
        ...chapter,
        translatedContent: chapter.translatedContent
          ? normalizePunctuation(chapter.translatedContent)
          : chapter.translatedContent,
      };
    });
  });

export const createChapter = createServerFn({ method: "POST" })
  .validator(createChapterSchema)
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await ensureSession();

      // Verify novel ownership
      const [novel] = await db
        .select({ id: novels.id })
        .from(novels)
        .where(and(eq(novels.id, data.novelId), eq(novels.userId, session.user.id)))
        .limit(1);

      if (!novel) {
        throw new SafeServerError("Novel not found or unauthorized");
      }

      const chapterId = nanoid();

      await db.insert(chapters).values({
        id: chapterId,
        novelId: data.novelId,
        number: data.number.toString(),
        title: data.title,
        rawContent: data.rawContent,
        rawCharCount: data.rawContent.length,
        status: "raw",
      });

      return { id: chapterId };
    });
  });

export const updateChapterRaw = createServerFn({ method: "POST" })
  .validator(updateChapterSchema)
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await ensureSession();

      // Verify ownership by inner joining
      const [existing] = await db
        .select({ id: chapters.id })
        .from(chapters)
        .innerJoin(novels, eq(chapters.novelId, novels.id))
        .where(and(eq(chapters.id, data.chapterId), eq(novels.userId, session.user.id)))
        .limit(1);

      if (!existing) {
        throw new SafeServerError("Chapter not found or unauthorized");
      }

      const updateValues: Record<string, unknown> = {
        updatedAt: new Date(),
      };

      if (data.number !== undefined) {
        updateValues.number = data.number.toString();
      }
      if (data.title !== undefined) {
        updateValues.title = data.title;
      }
      if (data.rawContent !== undefined) {
        updateValues.rawContent = data.rawContent;
        updateValues.rawCharCount = data.rawContent.length;
      }

      await db.update(chapters).set(updateValues).where(eq(chapters.id, data.chapterId));

      return { id: data.chapterId };
    });
  });

export const updateChapterTranslation = createServerFn({ method: "POST" })
  .validator(updateChapterTranslationSchema)
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await ensureSession();

      // Verify ownership by inner joining
      const [existing] = await db
        .select({ id: chapters.id })
        .from(chapters)
        .innerJoin(novels, eq(chapters.novelId, novels.id))
        .where(and(eq(chapters.id, data.chapterId), eq(novels.userId, session.user.id)))
        .limit(1);

      if (!existing) {
        throw new SafeServerError("Chapter not found or unauthorized");
      }

      await db
        .update(chapters)
        .set({
          translatedContent: data.translatedContent,
          editedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(chapters.id, data.chapterId));

      return { id: data.chapterId };
    });
  });

export const deleteChapter = createServerFn({ method: "POST" })
  .validator(z.object({ chapterId: z.string() }))
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await ensureSession();

      // Verify ownership by inner joining
      const [existing] = await db
        .select({ id: chapters.id })
        .from(chapters)
        .innerJoin(novels, eq(chapters.novelId, novels.id))
        .where(and(eq(chapters.id, data.chapterId), eq(novels.userId, session.user.id)))
        .limit(1);

      if (!existing) {
        throw new SafeServerError("Chapter not found or unauthorized");
      }

      await db.delete(chapters).where(eq(chapters.id, data.chapterId));

      return { success: true };
    });
  });

export const setChapterPublished = createServerFn({ method: "POST" })
  .validator(setChapterPublishedSchema)
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await ensureSession();

      const [existing] = await db
        .select({ id: chapters.id })
        .from(chapters)
        .innerJoin(novels, eq(chapters.novelId, novels.id))
        .where(and(eq(chapters.id, data.chapterId), eq(novels.userId, session.user.id)))
        .limit(1);

      if (!existing) {
        throw new SafeServerError("Chapter not found or unauthorized");
      }

      await db
        .update(chapters)
        .set({ publishedAt: data.publishedAt, updatedAt: new Date() })
        .where(eq(chapters.id, data.chapterId));

      return { id: data.chapterId };
    });
  });

// Bulk publish/unpublish every chapter of a novel (same value for all rows).
export const setAllChaptersPublished = createServerFn({ method: "POST" })
  .validator(setNovelPublishedSchema) // same shape: { novelId, publishedAt }
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await ensureSession();

      const [novel] = await db
        .select({ id: novels.id })
        .from(novels)
        .where(and(eq(novels.id, data.novelId), eq(novels.userId, session.user.id)))
        .limit(1);

      if (!novel) {
        throw new SafeServerError("Novel not found or unauthorized");
      }

      const updated = await db
        .update(chapters)
        .set({ publishedAt: data.publishedAt, updatedAt: new Date() })
        .where(eq(chapters.novelId, data.novelId))
        .returning({ id: chapters.id });

      return { id: data.novelId, count: updated.length };
    });
  });
