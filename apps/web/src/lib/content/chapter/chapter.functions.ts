import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { db } from "@/lib/db";
import { lockNovelForMutation } from "@/lib/db/novel-lock";
import { chapters } from "@/lib/db/schema";
import { ensureSession, getSession } from "@/lib/auth/functions";
import { checkRateLimit, GUEST_READ_LIMIT } from "@/lib/rate-limit";
import { nanoid } from "@/lib/utils";
import { withSafeHandler, SafeServerError } from "@/lib/server-fn-error";
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
import {
  listReadableChapters,
  getReadableChapterManifest,
  getReadableChapter,
} from "@/lib/content/chapter/chapter-read.service";

export const listChapters = createServerFn({ method: "GET" })
  .validator(z.object({ novelId: z.string() }))
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await getSession();
      if (!session) await checkRateLimit("read", GUEST_READ_LIMIT);

      return listReadableChapters(session?.user.id ?? null, data.novelId);
    });
  });

export const getReaderChapterManifest = createServerFn({ method: "GET" })
  .validator(z.object({ novelId: z.string() }))
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await getSession();
      if (!session) await checkRateLimit("read", GUEST_READ_LIMIT);

      return getReadableChapterManifest(session?.user.id ?? null, data.novelId);
    });
  });

export const getChapter = createServerFn({ method: "GET" })
  .validator(z.object({ chapterId: z.string() }))
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await getSession();
      if (!session) await checkRateLimit("read", GUEST_READ_LIMIT);

      return getReadableChapter(session?.user.id ?? null, data.chapterId);
    });
  });

export const createChapter = createServerFn({ method: "POST" })
  .validator(createChapterSchema)
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await ensureSession();

      return db.transaction(async (tx) => {
        if (!(await lockNovelForMutation(tx, data.novelId, session.user.id))) {
          throw new SafeServerError("Novel not found or unauthorized");
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
