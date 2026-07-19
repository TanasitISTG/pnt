import { createServerFn } from "@tanstack/react-start";
import { eq, and, sql, desc, asc } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { novels, chapters } from "@/lib/db/schema";
import { ensureSession } from "@/lib/auth.functions";
import { nanoid } from "@/lib/utils";
import {
  createNovelSchema,
  updateNovelSchema,
  createChapterSchema,
  updateChapterSchema,
} from "@/lib/novel.schemas";

export const listNovels = createServerFn({ method: "GET" }).handler(async () => {
  const session = await ensureSession();

  const rows = await db
    .select({
      id: novels.id,
      title: novels.title,
      originalTitle: novels.originalTitle,
      author: novels.author,
      description: novels.description,
      sourceLang: novels.sourceLang,
      targetLang: novels.targetLang,
      createdAt: novels.createdAt,
      updatedAt: novels.updatedAt,
      hasCover: sql<number>`CASE WHEN ${novels.cover} IS NOT NULL THEN 1 ELSE 0 END`,
      chapterCount: sql<number>`count(${chapters.id})::int`,
      translatedCount: sql<number>`count(case when ${chapters.status} = 'translated' then 1 end)::int`,
    })
    .from(novels)
    .leftJoin(chapters, eq(chapters.novelId, novels.id))
    .where(eq(novels.userId, session.user.id))
    .groupBy(novels.id)
    .orderBy(desc(novels.createdAt));

  return rows.map((row) => ({
    ...row,
    chapterCount: Number(row.chapterCount || 0),
    translatedCount: Number(row.translatedCount || 0),
    hasCover: Number(row.hasCover || 0),
  }));
});

export const getNovel = createServerFn({ method: "GET" })
  .validator(z.object({ novelId: z.string() }))
  .handler(async ({ data }) => {
    const session = await ensureSession();

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
        cover: novels.cover,
        coverMime: novels.coverMime,
        createdAt: novels.createdAt,
        updatedAt: novels.updatedAt,
      })
      .from(novels)
      .where(and(eq(novels.id, data.novelId), eq(novels.userId, session.user.id)))
      .limit(1);

    if (!novel) return null;

    return {
      ...novel,
      sourceLang: novel.sourceLang as "en" | "zh",
      targetLang: novel.targetLang as "en" | "th",
      coverMime: (novel.coverMime as "image/jpeg" | "image/png" | "image/webp" | null) || null,
      cover: novel.cover
        ? `data:${novel.coverMime || "image/jpeg"};base64,${novel.cover.toString("base64")}`
        : null,
    };
  });

export const createNovel = createServerFn({ method: "POST" })
  .validator(createNovelSchema)
  .handler(async ({ data }) => {
    const session = await ensureSession();
    const novelId = nanoid();

    const coverBuffer = data.cover ? Buffer.from(data.cover, "base64") : null;

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

export const updateNovel = createServerFn({ method: "POST" })
  .validator(updateNovelSchema)
  .handler(async ({ data }) => {
    const session = await ensureSession();

    // Verify ownership
    const [existing] = await db
      .select({ id: novels.id })
      .from(novels)
      .where(and(eq(novels.id, data.novelId), eq(novels.userId, session.user.id)))
      .limit(1);

    if (!existing) {
      throw new Error("Novel not found or unauthorized");
    }

    const updateValues: Record<string, any> = {
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
      updateValues.cover = Buffer.from(data.cover, "base64");
      updateValues.coverMime = data.coverMime;
    }

    await db.update(novels).set(updateValues).where(eq(novels.id, data.novelId));

    return { id: data.novelId };
  });

export const deleteNovel = createServerFn({ method: "POST" })
  .validator(z.object({ novelId: z.string() }))
  .handler(async ({ data }) => {
    const session = await ensureSession();

    // Verify ownership and delete (FK constraint cascade handles chapters)
    await db
      .delete(novels)
      .where(and(eq(novels.id, data.novelId), eq(novels.userId, session.user.id)));

    return { success: true };
  });

export const listChapters = createServerFn({ method: "GET" })
  .validator(z.object({ novelId: z.string() }))
  .handler(async ({ data }) => {
    const session = await ensureSession();

    // Verify novel ownership
    const [novel] = await db
      .select({ id: novels.id })
      .from(novels)
      .where(and(eq(novels.id, data.novelId), eq(novels.userId, session.user.id)))
      .limit(1);

    if (!novel) {
      throw new Error("Novel not found or unauthorized");
    }

    const chapterList = await db
      .select({
        id: chapters.id,
        novelId: chapters.novelId,
        number: chapters.number,
        title: chapters.title,
        rawCharCount: chapters.rawCharCount,
        status: chapters.status,
        translatedAt: chapters.translatedAt,
        createdAt: chapters.createdAt,
        updatedAt: chapters.updatedAt,
      })
      .from(chapters)
      .where(eq(chapters.novelId, data.novelId))
      .orderBy(asc(sql`COALESCE(${chapters.number}::numeric, 0)`));

    return chapterList;
  });

export const getChapter = createServerFn({ method: "GET" })
  .validator(z.object({ chapterId: z.string() }))
  .handler(async ({ data }) => {
    const session = await ensureSession();

    const [chapter] = await db
      .select({
        id: chapters.id,
        novelId: chapters.novelId,
        number: chapters.number,
        title: chapters.title,
        rawContent: chapters.rawContent,
        translatedContent: chapters.translatedContent,
        status: chapters.status,
        summary: chapters.summary,
        rawCharCount: chapters.rawCharCount,
        translatedAt: chapters.translatedAt,
        createdAt: chapters.createdAt,
        updatedAt: chapters.updatedAt,
      })
      .from(chapters)
      .innerJoin(novels, eq(chapters.novelId, novels.id))
      .where(and(eq(chapters.id, data.chapterId), eq(novels.userId, session.user.id)))
      .limit(1);

    return chapter || null;
  });

export const createChapter = createServerFn({ method: "POST" })
  .validator(createChapterSchema)
  .handler(async ({ data }) => {
    const session = await ensureSession();

    // Verify novel ownership
    const [novel] = await db
      .select({ id: novels.id })
      .from(novels)
      .where(and(eq(novels.id, data.novelId), eq(novels.userId, session.user.id)))
      .limit(1);

    if (!novel) {
      throw new Error("Novel not found or unauthorized");
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

export const updateChapterRaw = createServerFn({ method: "POST" })
  .validator(updateChapterSchema)
  .handler(async ({ data }) => {
    const session = await ensureSession();

    // Verify ownership by inner joining
    const [existing] = await db
      .select({ id: chapters.id })
      .from(chapters)
      .innerJoin(novels, eq(chapters.novelId, novels.id))
      .where(and(eq(chapters.id, data.chapterId), eq(novels.userId, session.user.id)))
      .limit(1);

    if (!existing) {
      throw new Error("Chapter not found or unauthorized");
    }

    const updateValues: Record<string, any> = {
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

export const deleteChapter = createServerFn({ method: "POST" })
  .validator(z.object({ chapterId: z.string() }))
  .handler(async ({ data }) => {
    const session = await ensureSession();

    // Verify ownership by inner joining
    const [existing] = await db
      .select({ id: chapters.id })
      .from(chapters)
      .innerJoin(novels, eq(chapters.novelId, novels.id))
      .where(and(eq(chapters.id, data.chapterId), eq(novels.userId, session.user.id)))
      .limit(1);

    if (!existing) {
      throw new Error("Chapter not found or unauthorized");
    }

    await db.delete(chapters).where(eq(chapters.id, data.chapterId));

    return { success: true };
  });
