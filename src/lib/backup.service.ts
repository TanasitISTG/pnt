import "@tanstack/react-start/server-only";

import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { assertCoverMagicBytes } from "@/lib/content/novel/novel.functions";
import { deleteCoverSet, writeCoverSet } from "@/lib/content/novel/cover-storage.server";
import { coverMimeSchema } from "@/lib/content/novel/novel.schemas";
import { getPublicStorage } from "@/lib/storage/index.server";
import { coverOriginalKey } from "@/lib/storage/keys";
import { db } from "@/lib/db";
import { chapters, glossaryTerms, novels } from "@/lib/db/schema";
import {
  emptyRelationshipMap,
  parseRelationshipMap,
  serializeRelationshipMap,
} from "@/lib/relationships/map";
import { SafeServerError } from "@/lib/server-fn-error";
import {
  assertExportableBackup,
  backupChapterSchema,
  backupNovelSchema,
  backupTermSchema,
  parseBackup,
  type Backup,
} from "./backup.schemas";

const BATCH_SIZE = 50;
// Streaming export pages chapter/term rows so a backup never holds a whole
// novel's content in memory at once.
const BACKUP_BATCH_SIZE = 100;

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

/**
 * Reads the stored cover back so backups stay self-contained: an exported file can
 * be restored into a different deployment without the original bucket.
 */
async function novelCoverForBackup(novel: typeof novels.$inferSelect) {
  if (!novel.coverKey) {
    return { coverBase64: null, coverMime: exportableCoverMime(novel.id, novel.coverMime, false) };
  }
  const object = await getPublicStorage().get(coverOriginalKey(novel.coverKey));
  if (!object) {
    throw new SafeServerError(`Novel ${novel.id} cover object is missing from storage`);
  }
  return {
    coverBase64: Buffer.from(object.bytes).toString("base64"),
    coverMime: exportableCoverMime(novel.id, object.contentType ?? novel.coverMime, true),
  };
}

async function novelToBackupScalars(novel: typeof novels.$inferSelect) {
  const relationshipMap = parseRelationshipMap(novel.relationshipMapJson);
  if (!relationshipMap) {
    throw new SafeServerError("Novel " + novel.id + " has an invalid relationship map");
  }
  const cover = await novelCoverForBackup(novel);
  return {
    id: novel.id,
    title: novel.title,
    originalTitle: novel.originalTitle,
    author: novel.author,
    description: novel.description,
    coverBase64: cover.coverBase64,
    coverMime: cover.coverMime,
    sourceLang: novel.sourceLang,
    targetLang: novel.targetLang,
    customPrompt: novel.customPrompt,
    storySummary: novel.storySummary,
    relationshipMap,
    chunkSize: novel.chunkSize,
    contextTailLength: novel.contextTailLength,
    publishedAt: iso(novel.publishedAt),
    createdAt: iso(novel.createdAt) || new Date().toISOString(),
    updatedAt: iso(novel.updatedAt) || new Date().toISOString(),
  };
}

function chapterToBackup(chapter: typeof chapters.$inferSelect) {
  return {
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
  };
}

function termToBackup(term: typeof glossaryTerms.$inferSelect) {
  return {
    id: term.id,
    source: term.source,
    target: term.target,
    category: term.category,
    note: term.note,
    status: term.status,
    createdAt: iso(term.createdAt) || new Date().toISOString(),
    updatedAt: iso(term.updatedAt) || new Date().toISOString(),
  };
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
    novels: await Promise.all(
      novelRows.map(async (novel) => ({
        ...(await novelToBackupScalars(novel)),
        chapters: (chaptersByNovel.get(novel.id) ?? []).map(chapterToBackup),
        glossaryTerms: (termsByNovel.get(novel.id) ?? []).map(termToBackup),
      })),
    ),
  };

  // Guarantees the invariant that matters for a backup: anything this exports,
  // the restore accepts again.
  return assertExportableBackup(backup);
}

// Streaming export: yields JSON fragments while paging chapters and terms by
// keyset, so a large novel never has to be materialized as one object. Scalar
// fields are validated against the backup schema up front; the array-level
// refinements are enforced incrementally as rows are read.
export async function* streamBackupForUser(
  userId: string,
  novelId?: string,
): AsyncGenerator<string> {
  const where = novelId
    ? and(eq(novels.userId, userId), eq(novels.id, novelId))
    : eq(novels.userId, userId);

  const novelRows = await db.select().from(novels).where(where).orderBy(novels.createdAt);
  if (novelId && novelRows.length === 0) throw new SafeServerError("Novel not found");

  yield `{"app":"pnt","schemaVersion":1,"exportedAt":${JSON.stringify(new Date().toISOString())},"novels":[`;

  let firstNovel = true;
  for (const novel of novelRows) {
    const scalars = await novelToBackupScalars(novel);
    // The array refinements run vacuously on empty arrays and are enforced
    // incrementally below, keeping the export/restore symmetry without
    // holding the whole novel.
    backupNovelSchema.parse({ ...scalars, chapters: [], glossaryTerms: [] });

    const base = JSON.stringify(scalars);
    yield `${firstNovel ? "" : ","}${base.slice(0, -1)},"chapters":[`;
    firstNovel = false;

    let firstChapter = true;
    let lastNumber: string | null = null;
    const seenNumbers = new Set<number>();
    for (;;) {
      const chapterConditions = [eq(chapters.novelId, novel.id)];
      if (lastNumber !== null) {
        chapterConditions.push(sql`${chapters.number} > ${lastNumber}::numeric`);
      }
      const batch = await db
        .select()
        .from(chapters)
        .where(and(...chapterConditions))
        .orderBy(asc(chapters.number))
        .limit(BACKUP_BATCH_SIZE);
      if (batch.length === 0) break;
      for (const chapter of batch) {
        const mapped = chapterToBackup(chapter);
        backupChapterSchema.parse(mapped);
        const numeric = Number(mapped.number);
        if (seenNumbers.has(numeric)) {
          throw new SafeServerError("Backup export failed validation — duplicate chapter numbers");
        }
        seenNumbers.add(numeric);
        yield `${firstChapter ? "" : ","}${JSON.stringify(mapped)}`;
        firstChapter = false;
      }
      lastNumber = batch[batch.length - 1].number;
      if (batch.length < BACKUP_BATCH_SIZE) break;
    }

    yield `],"glossaryTerms":[`;
    let firstTerm = true;
    let lastSource: string | null = null;
    const seenSources = new Set<string>();
    for (;;) {
      const termConditions = [eq(glossaryTerms.novelId, novel.id)];
      if (lastSource !== null) {
        termConditions.push(gt(glossaryTerms.source, lastSource));
      }
      const batch = await db
        .select()
        .from(glossaryTerms)
        .where(and(...termConditions))
        .orderBy(asc(glossaryTerms.source))
        .limit(BACKUP_BATCH_SIZE);
      if (batch.length === 0) break;
      for (const term of batch) {
        const mapped = termToBackup(term);
        backupTermSchema.parse(mapped);
        if (seenSources.has(mapped.source)) {
          throw new SafeServerError("Backup export failed validation — duplicate glossary sources");
        }
        seenSources.add(mapped.source);
        yield `${firstTerm ? "" : ","}${JSON.stringify(mapped)}`;
        firstTerm = false;
      }
      lastSource = batch[batch.length - 1].source;
      if (batch.length < BACKUP_BATCH_SIZE) break;
    }

    yield `]}`;
  }

  yield `]}`;
}

export async function importBackupForUser(userId: string, value: unknown) {
  const backup = parseBackup(value);
  const now = new Date();

  // Covers are served to guests under the stored content type, so verify the
  // decoded bytes really are the declared image before anything is written. The
  // images are staged to storage ahead of the transaction, matching the cover
  // upload path: objects first, then the rows that reference them.
  const staged: Array<{
    sourceNovel: Backup["novels"][number];
    newNovelId: string;
    coverKey: string | null;
  }> = [];
  try {
    for (const sourceNovel of backup.novels) {
      const newNovelId = nanoid();
      let coverKey: string | null = null;
      if (sourceNovel.coverBase64) {
        const buffer = Buffer.from(sourceNovel.coverBase64, "base64");
        assertCoverMagicBytes(buffer, sourceNovel.coverMime ?? "");
        coverKey = await writeCoverSet(newNovelId, buffer, sourceNovel.coverMime ?? "image/webp");
      }
      staged.push({ sourceNovel, newNovelId, coverKey });
    }
  } catch (error) {
    await Promise.all(staged.map((entry) => deleteCoverSet(entry.coverKey).catch(() => {})));
    throw error;
  }

  let imported: string[];
  try {
    imported = await db.transaction(async (tx) => {
      const importedNovelIds: string[] = [];
      for (const { sourceNovel, newNovelId, coverKey } of staged) {
        await tx.insert(novels).values({
          id: newNovelId,
          userId,
          title: `${sourceNovel.title} (imported)`,
          originalTitle: sourceNovel.originalTitle,
          author: sourceNovel.author,
          description: sourceNovel.description,
          coverKey,
          coverMime: coverKey ? sourceNovel.coverMime : null,
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
        });
        importedNovelIds.push(newNovelId);

        for (let offset = 0; offset < sourceNovel.chapters.length; offset += BATCH_SIZE) {
          await tx.insert(chapters).values(
            sourceNovel.chapters.slice(offset, offset + BATCH_SIZE).map((chapter) => ({
              id: nanoid(),
              novelId: newNovelId,
              number: chapter.number,
              title: chapter.title,
              translatedTitle: chapter.translatedTitle,
              rawContent: chapter.rawContent,
              translatedContent: chapter.translatedContent,
              status:
                chapter.status === "queued" || chapter.status === "translating"
                  ? chapter.translatedContent !== null
                    ? "translated"
                    : "raw"
                  : chapter.status,
              summary: chapter.summary,
              rawCharCount: chapter.rawCharCount,
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

        for (let offset = 0; offset < sourceNovel.glossaryTerms.length; offset += BATCH_SIZE) {
          await tx.insert(glossaryTerms).values(
            sourceNovel.glossaryTerms.slice(offset, offset + BATCH_SIZE).map((term) => ({
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
  } catch (error) {
    await Promise.all(staged.map((entry) => deleteCoverSet(entry.coverKey).catch(() => {})));
    throw error;
  }

  return { importedNovelCount: imported.length, novelIds: imported };
}
