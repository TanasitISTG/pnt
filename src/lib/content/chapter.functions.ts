import { createServerFn } from "@tanstack/react-start";
import { eq, and, sql, asc } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { novels, chapters } from "@/lib/db/schema";
import { ensureSession, getSession } from "@/lib/auth/functions";
import { checkRateLimit, GUEST_READ_LIMIT } from "@/lib/rate-limit";
import { nanoid } from "@/lib/utils";
import { withSafeHandler, SafeServerError } from "@/lib/server-fn-error";
import {
  chapterTranslationPresent,
  novelLive,
  chapterVisibleToGuests,
} from "@/lib/content/publish";
import { normalizePunctuation } from "@/lib/translation/text/paragraphs";
import {
  createChapterSchema,
  editChapterSchema,
  reorderChaptersSchema,
  updateChapterSchema,
  updateChapterTranslationSchema,
  setNovelPublishedSchema,
  setChapterPublishedSchema,
} from "@/lib/content/novel.schemas";
import {
  setAllChaptersPublishedForUser,
  setChapterPublishedForUser,
} from "@/lib/content/publish.service";
import { reorderChaptersForUser, updateChapterForUser } from "@/lib/content/chapter-edit.service";
import { deleteChapterForUser } from "@/lib/content/chapter-delete.service";

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
          session
            ? eq(chapters.novelId, data.novelId)
            : and(eq(chapters.novelId, data.novelId), chapterVisibleToGuests()),
        )
        .orderBy(asc(sql`COALESCE(${chapters.number}::numeric, 0)`));

      return chapterList;
    });
  });

export const getReaderChapterManifest = createServerFn({ method: "GET" })
  .validator(z.object({ novelId: z.string() }))
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await getSession();
      if (!session) await checkRateLimit("read", GUEST_READ_LIMIT);

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
          session
            ? and(eq(chapters.novelId, data.novelId), eq(novels.userId, session.user.id))
            : and(eq(chapters.novelId, data.novelId), novelLive(), chapterVisibleToGuests()),
        )
        .orderBy(asc(sql`COALESCE(${chapters.number}::numeric, 0)`));

      if (rows.length === 0) {
        const [novel] = await db
          .select({ id: novels.id })
          .from(novels)
          .where(
            session
              ? and(eq(novels.id, data.novelId), eq(novels.userId, session.user.id))
              : and(eq(novels.id, data.novelId), novelLive()),
          )
          .limit(1);
        if (!novel) throw new SafeServerError("Novel not found or unauthorized");
      }

      return rows;
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
            : and(eq(chapters.id, data.chapterId), chapterVisibleToGuests(), novelLive()),
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

export const updateChapter = createServerFn({ method: "POST" })
  .validator(editChapterSchema)
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await ensureSession();
      return updateChapterForUser(session.user.id, data);
    });
  });

export const reorderChapters = createServerFn({ method: "POST" })
  .validator(reorderChaptersSchema)
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await ensureSession();
      return reorderChaptersForUser(session.user.id, data);
    });
  });

export const updateChapterRaw = createServerFn({ method: "POST" })
  .validator(updateChapterSchema)
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await ensureSession();
      return updateChapterForUser(session.user.id, {
        ...data,
        sourceChangePolicy: "clear",
      });
    });
  });

export const updateChapterTranslation = createServerFn({ method: "POST" })
  .validator(updateChapterTranslationSchema)
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await ensureSession();
      return updateChapterForUser(session.user.id, data);
    });
  });

export const deleteChapter = createServerFn({ method: "POST" })
  .validator(z.object({ chapterId: z.string() }))
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      return deleteChapterForUser(session.user.id, data.chapterId);
    }),
  );

export const setChapterPublished = createServerFn({ method: "POST" })
  .validator(setChapterPublishedSchema)
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await ensureSession();
      return setChapterPublishedForUser(session.user.id, data);
    });
  });

// Bulk publish ready chapters, or unpublish every chapter of a novel.
export const setAllChaptersPublished = createServerFn({ method: "POST" })
  .validator(setNovelPublishedSchema)
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await ensureSession();
      return setAllChaptersPublishedForUser(session.user.id, data.novelId, data.publishedAt);
    });
  });
