import { createServerFn } from "@tanstack/react-start";
import { and, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { ensureSession } from "@/lib/auth/functions";
import { db } from "@/lib/db";
import { chapters, glossaryTerms, novels } from "@/lib/db/schema";
import { SafeServerError, withSafeHandler } from "@/lib/server-fn-error";

const exportBackupSchema = z.object({ novelId: z.string().optional() }).optional();
const importBackupSchema = z.object({ backup: z.unknown() });

const backupChapterSchema = z.object({
  id: z.string(),
  number: z.string(),
  title: z.string(),
  translatedTitle: z.string().nullable(),
  rawContent: z.string(),
  translatedContent: z.string().nullable(),
  status: z.enum(["raw", "queued", "translating", "translated", "error"]),
  summary: z.string().nullable(),
  rawCharCount: z.number(),
  sourceRevision: z.number(),
  translationGeneration: z.number(),
  publishedAt: z.string().nullable(),
  translatedAt: z.string().nullable(),
  editedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const backupTermSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  category: z.enum(["character", "place", "skill", "item", "other"]),
  note: z.string().nullable(),
  status: z.enum(["approved", "pending", "rejected"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const backupNovelSchema = z.object({
  id: z.string(),
  title: z.string(),
  originalTitle: z.string().nullable(),
  author: z.string().nullable(),
  description: z.string().nullable(),
  coverBase64: z.string().nullable(),
  coverMime: z.string().nullable(),
  sourceLang: z.string(),
  targetLang: z.string(),
  customPrompt: z.string().nullable(),
  storySummary: z.string().nullable(),
  chunkSize: z.number(),
  contextTailLength: z.number(),
  publishedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  chapters: z.array(backupChapterSchema),
  glossaryTerms: z.array(backupTermSchema),
});

const backupSchema = z.object({
  app: z.literal("pnt"),
  schemaVersion: z.literal(1),
  exportedAt: z.string(),
  novels: z.array(backupNovelSchema),
});

type Backup = z.infer<typeof backupSchema>;

function iso(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function dateOrNull(value: string | null): Date | null {
  return value ? new Date(value) : null;
}

export const exportBackup = createServerFn({ method: "POST" })
  .validator(exportBackupSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      const where = data?.novelId
        ? and(eq(novels.userId, session.user.id), eq(novels.id, data.novelId))
        : eq(novels.userId, session.user.id);

      const novelRows = await db.select().from(novels).where(where).orderBy(novels.createdAt);
      if (data?.novelId && novelRows.length === 0) throw new SafeServerError("Novel not found");

      const novelIds = novelRows.map((n) => n.id);
      const chapterRows = novelIds.length
        ? await db
            .select()
            .from(chapters)
            .where(inArray(chapters.novelId, novelIds))
            .orderBy(chapters.novelId, sql`COALESCE(${chapters.number}::numeric, 0)`)
        : [];
      const termRows = novelIds.length
        ? await db
            .select()
            .from(glossaryTerms)
            .where(inArray(glossaryTerms.novelId, novelIds))
            .orderBy(glossaryTerms.novelId, glossaryTerms.source)
        : [];

      const backup: Backup = {
        app: "pnt",
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        novels: novelRows.map((novel) => ({
          id: novel.id,
          title: novel.title,
          originalTitle: novel.originalTitle,
          author: novel.author,
          description: novel.description,
          coverBase64: novel.cover ? Buffer.from(novel.cover).toString("base64") : null,
          coverMime: novel.coverMime,
          sourceLang: novel.sourceLang,
          targetLang: novel.targetLang,
          customPrompt: novel.customPrompt,
          storySummary: novel.storySummary,
          chunkSize: novel.chunkSize,
          contextTailLength: novel.contextTailLength,
          publishedAt: iso(novel.publishedAt),
          createdAt: iso(novel.createdAt) || new Date().toISOString(),
          updatedAt: iso(novel.updatedAt) || new Date().toISOString(),
          chapters: chapterRows
            .filter((chapter) => chapter.novelId === novel.id)
            .map((chapter) => ({
              id: chapter.id,
              number: chapter.number,
              title: chapter.title,
              translatedTitle: chapter.translatedTitle,
              rawContent: chapter.rawContent,
              translatedContent: chapter.translatedContent,
              status: chapter.status,
              summary: chapter.summary,
              rawCharCount: chapter.rawCharCount,
              sourceRevision: chapter.sourceRevision,
              translationGeneration: chapter.translationGeneration,
              publishedAt: iso(chapter.publishedAt),
              translatedAt: iso(chapter.translatedAt),
              editedAt: iso(chapter.editedAt),
              createdAt: iso(chapter.createdAt) || new Date().toISOString(),
              updatedAt: iso(chapter.updatedAt) || new Date().toISOString(),
            })),
          glossaryTerms: termRows
            .filter((term) => term.novelId === novel.id)
            .map((term) => ({
              id: term.id,
              source: term.source,
              target: term.target,
              category: term.category,
              note: term.note,
              status: term.status,
              createdAt: iso(term.createdAt) || new Date().toISOString(),
              updatedAt: iso(term.updatedAt) || new Date().toISOString(),
            })),
        })),
      };

      return backup;
    }),
  );

export const importBackup = createServerFn({ method: "POST" })
  .validator(importBackupSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      const backup = backupSchema.parse(data.backup);
      const now = new Date();

      const imported = await db.transaction(async (tx) => {
        const importedNovelIds: string[] = [];
        for (const sourceNovel of backup.novels) {
          const newNovelId = nanoid();
          importedNovelIds.push(newNovelId);
          await tx.insert(novels).values({
            id: newNovelId,
            userId: session.user.id,
            title: `${sourceNovel.title} (imported)`,
            originalTitle: sourceNovel.originalTitle,
            author: sourceNovel.author,
            description: sourceNovel.description,
            cover: sourceNovel.coverBase64 ? Buffer.from(sourceNovel.coverBase64, "base64") : null,
            coverMime: sourceNovel.coverMime,
            sourceLang: sourceNovel.sourceLang,
            targetLang: sourceNovel.targetLang,
            customPrompt: sourceNovel.customPrompt,
            storySummary: sourceNovel.storySummary,
            chunkSize: sourceNovel.chunkSize,
            contextTailLength: sourceNovel.contextTailLength,
            publishedAt: null,
            createdAt: now,
            updatedAt: now,
          });

          if (sourceNovel.chapters.length) {
            await tx.insert(chapters).values(
              sourceNovel.chapters.map((chapter) => ({
                id: nanoid(),
                novelId: newNovelId,
                number: chapter.number,
                title: chapter.title,
                translatedTitle: chapter.translatedTitle,
                rawContent: chapter.rawContent,
                translatedContent: chapter.translatedContent,
                status:
                  chapter.status === "queued" || chapter.status === "translating"
                    ? "raw"
                    : chapter.status,
                summary: chapter.summary,
                rawCharCount: chapter.rawCharCount || chapter.rawContent.length,
                sourceRevision: chapter.sourceRevision,
                translationGeneration: chapter.translationGeneration,
                activeTranslationJobId: null,
                publishedAt: null,
                translatedAt: dateOrNull(chapter.translatedAt),
                editedAt: dateOrNull(chapter.editedAt),
                createdAt: now,
                updatedAt: now,
              })),
            );
          }

          if (sourceNovel.glossaryTerms.length) {
            await tx.insert(glossaryTerms).values(
              sourceNovel.glossaryTerms.map((term) => ({
                id: nanoid(),
                novelId: newNovelId,
                source: term.source,
                target: term.target,
                category: term.category,
                note: term.note,
                status: term.status,
                createdAt: now,
                updatedAt: now,
              })),
            );
          }
        }
        return importedNovelIds;
      });

      return { importedNovelCount: imported.length, novelIds: imported };
    }),
  );
