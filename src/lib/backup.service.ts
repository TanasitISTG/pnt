import "@tanstack/react-start/server-only";

import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";

import { assertCoverMagicBytes } from "@/lib/content/novel/novel.functions";
import { coverMimeSchema } from "@/lib/content/novel/novel.schemas";
import { db } from "@/lib/db";
import { chapters, glossaryTerms, novels } from "@/lib/db/schema";
import {
  emptyRelationshipMap,
  parseRelationshipMap,
  serializeRelationshipMap,
} from "@/lib/relationships/map";
import { SafeServerError } from "@/lib/server-fn-error";
import { assertExportableBackup, parseBackup, type Backup } from "./backup.schemas";

function iso(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function dateOrNull(value: string | null): Date | null {
  return value ? new Date(value) : null;
}

// A backup only carries cover types the app can serve and restore again.
function exportableCoverMime(novelId: string, coverMime: string | null, hasCover: boolean) {
  if (coverMime === null) {
    if (hasCover) {
      throw new SafeServerError(`Novel ${novelId} has a cover image without a media type`);
    }
    return null;
  }
  const parsed = coverMimeSchema.safeParse(coverMime);
  if (!parsed.success) {
    throw new SafeServerError(`Novel ${novelId} has an unsupported cover media type: ${coverMime}`);
  }
  return parsed.data;
}

export async function exportBackupForUser(userId: string, novelId?: string): Promise<Backup> {
  const where = novelId
    ? and(eq(novels.userId, userId), eq(novels.id, novelId))
    : eq(novels.userId, userId);

  const novelRows = await db.select().from(novels).where(where).orderBy(novels.createdAt);
  if (novelId && novelRows.length === 0) throw new SafeServerError("Novel not found");

  const novelIds = novelRows.map((n) => n.id);
  const chapterRows = novelIds.length
    ? await db
        .select()
        .from(chapters)
        .where(inArray(chapters.novelId, novelIds))
        .orderBy(chapters.novelId, chapters.number)
    : [];
  const termRows = novelIds.length
    ? await db
        .select()
        .from(glossaryTerms)
        .where(inArray(glossaryTerms.novelId, novelIds))
        .orderBy(glossaryTerms.novelId, glossaryTerms.source)
    : [];
  const chaptersByNovel = new Map<string, typeof chapterRows>();
  for (const chapter of chapterRows) {
    const rows = chaptersByNovel.get(chapter.novelId);
    if (rows) {
      rows.push(chapter);
    } else {
      chaptersByNovel.set(chapter.novelId, [chapter]);
    }
  }
  const termsByNovel = new Map<string, typeof termRows>();
  for (const term of termRows) {
    const rows = termsByNovel.get(term.novelId);
    if (rows) {
      rows.push(term);
    } else {
      termsByNovel.set(term.novelId, [term]);
    }
  }

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
      coverMime: exportableCoverMime(novel.id, novel.coverMime, Boolean(novel.cover)),
      sourceLang: novel.sourceLang,
      targetLang: novel.targetLang,
      customPrompt: novel.customPrompt,
      storySummary: novel.storySummary,
      relationshipMap: parseRelationshipMap(novel.relationshipMapJson) ?? emptyRelationshipMap(),
      chunkSize: novel.chunkSize,
      contextTailLength: novel.contextTailLength,
      publishedAt: iso(novel.publishedAt),
      createdAt: iso(novel.createdAt) || new Date().toISOString(),
      updatedAt: iso(novel.updatedAt) || new Date().toISOString(),
      chapters: (chaptersByNovel.get(novel.id) ?? []).map((chapter) => ({
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
      glossaryTerms: (termsByNovel.get(novel.id) ?? []).map((term) => ({
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

  // Guarantees the invariant that matters for a backup: anything this exports,
  // the restore accepts again.
  return assertExportableBackup(backup);
}

export async function importBackupForUser(userId: string, value: unknown) {
  const backup = parseBackup(value);
  const now = new Date();

  // Covers are served to guests under the stored content type, so verify the
  // decoded bytes really are the declared image before anything is written.
  for (const sourceNovel of backup.novels) {
    if (!sourceNovel.coverBase64) continue;
    assertCoverMagicBytes(
      Buffer.from(sourceNovel.coverBase64, "base64"),
      sourceNovel.coverMime ?? "",
    );
  }

  const imported = await db.transaction(async (tx) => {
    const importedNovels = backup.novels.map((sourceNovel) => ({
      sourceNovel,
      newNovelId: nanoid(),
    }));
    const importedNovelIds = importedNovels.map(({ newNovelId }) => newNovelId);

    if (importedNovels.length) {
      await tx.insert(novels).values(
        importedNovels.map(({ sourceNovel, newNovelId }) => ({
          id: newNovelId,
          userId,
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
          relationshipMapJson: serializeRelationshipMap(
            sourceNovel.relationshipMap ?? emptyRelationshipMap(),
          ),
          chunkSize: sourceNovel.chunkSize,
          contextTailLength: sourceNovel.contextTailLength,
          publishedAt: null,
          createdAt: now,
          updatedAt: now,
        })),
      );
    }

    const importedChapters = importedNovels.flatMap(({ sourceNovel, newNovelId }) =>
      sourceNovel.chapters.map((chapter) => ({
        id: nanoid(),
        novelId: newNovelId,
        number: chapter.number,
        title: chapter.title,
        translatedTitle: chapter.translatedTitle,
        rawContent: chapter.rawContent,
        translatedContent: chapter.translatedContent,
        status:
          chapter.status === "queued" || chapter.status === "translating" ? "raw" : chapter.status,
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
    if (importedChapters.length) {
      await tx.insert(chapters).values(importedChapters);
    }

    const importedGlossaryTerms = importedNovels.flatMap(({ sourceNovel, newNovelId }) =>
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
    if (importedGlossaryTerms.length) {
      await tx.insert(glossaryTerms).values(importedGlossaryTerms);
    }

    return importedNovelIds;
  });

  return { importedNovelCount: imported.length, novelIds: imported };
}
