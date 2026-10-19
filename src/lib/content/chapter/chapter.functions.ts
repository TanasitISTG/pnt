import { createServerFn } from "@tanstack/react-start";
import { eq, and, asc, exists, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { encodeMessage } from "@/lib/i18n/message-code";
import { lockNovelForMutation } from "@/lib/db/novel-lock";
import { novels, chapters, chapterTranslationVersions } from "@/lib/db/schema";
import { ensureSession, getSession } from "@/lib/auth/functions";
import { checkRateLimit, GUEST_READ_LIMIT } from "@/lib/rate-limit";
import { nanoid } from "@/lib/utils";
import { withSafeHandler, SafeServerError } from "@/lib/server-fn-error";
import {
  chapterHasTranslation,
  novelReadable,
  chapterReadable,
} from "@/lib/content/publish/publish";
import { normalizePunctuation } from "@/lib/translation/text/paragraphs";
import {
  createChapterSchema,
  editChapterSchema,
  reorderChaptersSchema,
  updateChapterSchema,
  updateChapterTranslationSchema,
  setNovelPublishedSchema,
  setChapterPublishedSchema,
} from "@/lib/content/novel/novel.schemas";
import {
  setAllChaptersPublishedForUser,
  setChapterPublishedForUser,
} from "@/lib/content/publish/publish.service";
import {
  reorderChaptersForUser,
  updateChapterForUser,
} from "@/lib/content/chapter/chapter-edit.service";
import { deleteChapterForUser } from "@/lib/content/chapter/chapter-delete.service";

export const listChapters = createServerFn({ method: "GET" })
  .validator(z.object({ novelId: z.string() }))
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await getSession();
      if (!session) await checkRateLimit("read", GUEST_READ_LIMIT);

      // Readable = owned by the viewer (any state) or live for everyone else.
      const viewerId = session?.user.id ?? null;
      const [novel] = await db
        .select({ id: novels.id })
        .from(novels)
        .where(and(eq(novels.id, data.novelId), novelReadable(viewerId)))
        .limit(1);

      if (!novel) {
        throw new SafeServerError(encodeMessage("errors.novelNotFoundOrUnauthorized"));
      }

      const chapterList = await db
        .select({
          id: chapters.id,
          novelId: chapters.novelId,
          number: chapters.number,
          title: chapters.title,
          translatedTitle: chapters.translatedTitle,
          hasTranslation: chapterHasTranslation(),
          // The trail outlives the text: a cleared chapter still has versions to restore,
          // and the row needs to say so without a second request for every chapter.
          hasHistory: sql<boolean>`${exists(
            db
              .select({ id: chapterTranslationVersions.id })
              .from(chapterTranslationVersions)
              .where(eq(chapterTranslationVersions.chapterId, chapters.id)),
          )}`,
          rawCharCount: chapters.rawCharCount,
          status: chapters.status,
          publishedAt: chapters.publishedAt,
          translatedAt: chapters.translatedAt,
          editedAt: chapters.editedAt,
          createdAt: chapters.createdAt,
          updatedAt: chapters.updatedAt,
        })
        .from(chapters)
        // The join is what makes the owner branch expressible: ownership lives on the
        // novel, so a viewer's own draft chapters are visible without a second query.
        .innerJoin(novels, eq(chapters.novelId, novels.id))
        .where(and(eq(chapters.novelId, data.novelId), chapterReadable(viewerId)))
        .orderBy(asc(chapters.number));

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
        .where(and(eq(chapters.novelId, data.novelId), chapterReadable(session?.user.id ?? null)))
        .orderBy(asc(chapters.number));

      if (rows.length === 0) {
        const [novel] = await db
          .select({ id: novels.id })
          .from(novels)
          .where(and(eq(novels.id, data.novelId), novelReadable(session?.user.id ?? null)))
          .limit(1);
        if (!novel) throw new SafeServerError(encodeMessage("errors.novelNotFoundOrUnauthorized"));
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
          userId: novels.userId,
        })
        .from(chapters)
        .innerJoin(novels, eq(chapters.novelId, novels.id))
        .where(and(eq(chapters.id, data.chapterId), chapterReadable(session?.user.id ?? null)))
        .limit(1);

      if (!chapter) return null;

      const { userId, ...chapterRest } = chapter;
      const canManage = session?.user.id === userId;
      return {
        ...chapterRest,
        // The rolling summary is a consistency-engine input, not reader-facing content,
        // so it stays with the owner even when the chapter itself is public.
        summary: canManage ? chapter.summary : null,
        translatedContent: chapter.translatedContent
          ? normalizePunctuation(chapter.translatedContent)
          : chapter.translatedContent,
        canManage,
      };
    });
  });

export const createChapter = createServerFn({ method: "POST" })
  .validator(createChapterSchema)
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await ensureSession();

      return db.transaction(async (tx) => {
        if (!(await lockNovelForMutation(tx, data.novelId, session.user.id))) {
          throw new SafeServerError(encodeMessage("errors.novelNotFoundOrUnauthorized"));
        }
        const chapterId = nanoid();
        await tx.insert(chapters).values({
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
