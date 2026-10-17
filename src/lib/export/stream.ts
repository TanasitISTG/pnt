import "@tanstack/react-start/server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import { db, queryClient } from "@/lib/db";
import { chapters, novels } from "@/lib/db/schema";
import { contentDisposition, sanitizeFilename } from "@/lib/filename";
import { splitParagraphs } from "@/lib/translation/text/paragraphs";
import { getPrivateStorage } from "@/lib/storage/index.server";
import {
  EXPORT_FORMATS,
  exportObjectKey,
  exportRevision,
  type ExportFormat,
  type ObjectKey,
} from "@/lib/storage/keys";
import { createEpubStream, type EpubChapter, type EpubMetadata } from "./epub";

interface ExportChapterRow {
  number: string;
  title: string;
  translatedTitle: string | null;
  translatedContent: string;
}

function chapterTitle(chapter: Pick<ExportChapterRow, "number" | "title" | "translatedTitle">) {
  return `Chapter ${Number(chapter.number)}: ${chapter.translatedTitle ?? chapter.title}`;
}

// Export eligibility requires a nonblank body. Unlike guest list queries, this path
// streams the text anyway, so reading `translated_content` costs no extra I/O here.
const nonblankTranslatedContent = () =>
  sql<boolean>`${
    chapters.translatedContent
  } IS NOT NULL AND regexp_replace(${chapters.translatedContent}, '[[:space:]]', '', 'g') <> ''`;

async function loadExportMetadata(novelId: string, userId: string) {
  const [novel] = await db
    .select({
      id: novels.id,
      title: novels.title,
      author: novels.author,
      targetLang: novels.targetLang,
    })
    .from(novels)
    .where(and(eq(novels.id, novelId), eq(novels.userId, userId)))
    .limit(1);
  if (!novel) return null;

  // Existence-only check with the same nonblank predicate the body cursor uses,
  // so HEAD and body responses agree on whether any exportable chapter exists.
  const [present] = await db
    .select({ id: chapters.id })
    .from(chapters)
    .where(and(eq(chapters.novelId, novelId), nonblankTranslatedContent()))
    .limit(1);
  if (!present) return null;

  return { novel };
}

// Chapters are read in keyset batches rather than through one held cursor: a
// cursor keeps a pool connection checked out for the whole client-paced
// download, while batches release it between fetches without ever buffering the
// whole novel. `(novel_id, number)` is unique, so `number > $last` is a stable
// keyset; chapter numbers are positive, so "0" starts the scan.
const EXPORT_BATCH_SIZE = 25;

async function* chapterCursor(novelId: string): AsyncGenerator<ExportChapterRow> {
  let lastNumber = "0";
  while (true) {
    const rows = await queryClient<ExportChapterRow[]>`
      SELECT
        "number"::text AS "number",
        "title",
        "translated_title" AS "translatedTitle",
        "translated_content" AS "translatedContent"
      FROM "chapters"
      WHERE "novel_id" = ${novelId}
        AND "number" > ${lastNumber}
        AND "translated_content" IS NOT NULL
        AND regexp_replace("translated_content", '[[:space:]]', '', 'g') <> ''
      ORDER BY "chapters"."number"
      LIMIT ${EXPORT_BATCH_SIZE}
    `;
    if (rows.length === 0) return;
    for (const row of rows) yield row;
    lastNumber = rows[rows.length - 1].number;
    if (rows.length < EXPORT_BATCH_SIZE) return;
  }
}

// One chapter's serialization output may exceed the queue mark; the bound is
// "highWaterMark plus at most one pending unit", never a whole novel.
const STREAM_HIGH_WATER_MARK = 64 * 1024;

// Cached exports are held in memory only while the client consumes them. Above
// this the response still streams normally and is simply not cached, so the
// bounded-memory guarantee never depends on the cache.
const EXPORT_CACHE_MAX_BYTES = 32 * 1024 * 1024;

/** Bounds the bulk revision lookup, so a whole bucket's worth of novels is not one `IN` clause. */
const EXPORT_REVISION_LOOKUP_CHUNK = 200;

export interface ChapterRevisionStats {
  chapterCount: number;
  maxChapterUpdatedAt: Date | null;
  maxTranslationGeneration: number;
}

/** The novel fields the fingerprint covers, read from the row that owns the export. */
export interface ExportCacheNovel {
  id: string;
  title: string;
  author: string | null;
  targetLang: string;
}

/**
 * The cache key one novel's export of one format has right now.
 *
 * The single assembly of the fingerprint's inputs. `exportRevision` owns the hash, but *which* inputs
 * feed it is the rule a sweep has to match to tell a current revision from one the content has moved
 * past, and that rule lives here so the route that writes a cached export and every sweep that
 * removes one read it from the same place.
 */
export function exportCacheKey(
  novel: ExportCacheNovel,
  stats: ChapterRevisionStats,
  format: ExportFormat,
): ObjectKey {
  return exportObjectKey(
    novel.id,
    exportRevision({
      format,
      novelTitle: novel.title,
      novelAuthor: novel.author,
      targetLang: novel.targetLang,
      chapterCount: stats.chapterCount,
      maxChapterUpdatedAt: stats.maxChapterUpdatedAt,
      maxTranslationGeneration: stats.maxTranslationGeneration,
    }),
    format,
  );
}

async function loadChapterRevisionStats(novelId: string): Promise<ChapterRevisionStats> {
  const [row] = await db
    .select({
      chapterCount: sql<number>`count(*)::int`,
      maxChapterUpdatedAt: sql<Date | null>`max(${chapters.updatedAt})`,
      maxTranslationGeneration: sql<number>`coalesce(max(${chapters.translationGeneration}), 0)::int`,
    })
    .from(chapters)
    .where(eq(chapters.novelId, novelId));
  return {
    chapterCount: Number(row?.chapterCount ?? 0),
    maxChapterUpdatedAt: row?.maxChapterUpdatedAt ?? null,
    maxTranslationGeneration: Number(row?.maxTranslationGeneration ?? 0),
  };
}

/**
 * The keys the route would compute right now, for every novel named that can be exported at all.
 *
 * The bulk twin of `loadChapterRevisionStats` for a sweep that holds a bucket listing rather than one
 * novel: same aggregate fields, grouped by novel instead of filtered to one, and the same eligibility
 * predicate the route applies (`nonblankTranslatedContent`), so a novel with nothing translated names
 * no key. That matters more than it looks: a novel with no key is one whose cached exports the route
 * cannot reach, so a sweep that reads this as "no current revision" is right to remove them, and a
 * novel that is missing from the result — a row that is gone — is the orphan prune's business
 * instead.
 */
export async function currentExportCacheKeys(novelIds: readonly string[]): Promise<Set<string>> {
  const keys = new Set<string>();
  if (novelIds.length === 0) return keys;

  for (let index = 0; index < novelIds.length; index += EXPORT_REVISION_LOOKUP_CHUNK) {
    const chunk = novelIds.slice(index, index + EXPORT_REVISION_LOOKUP_CHUNK);
    const [novelRows, statRows, exportableRows] = await Promise.all([
      db
        .select({
          id: novels.id,
          title: novels.title,
          author: novels.author,
          targetLang: novels.targetLang,
        })
        .from(novels)
        .where(inArray(novels.id, chunk)),
      db
        .select({
          novelId: chapters.novelId,
          chapterCount: sql<number>`count(*)::int`,
          maxChapterUpdatedAt: sql<Date | null>`max(${chapters.updatedAt})`,
          maxTranslationGeneration: sql<number>`coalesce(max(${chapters.translationGeneration}), 0)::int`,
        })
        .from(chapters)
        .where(inArray(chapters.novelId, chunk))
        .groupBy(chapters.novelId),
      db
        .select({ novelId: chapters.novelId })
        .from(chapters)
        .where(and(inArray(chapters.novelId, chunk), nonblankTranslatedContent()))
        .groupBy(chapters.novelId),
    ]);

    const statsByNovel = new Map(
      statRows.map((row) => [
        row.novelId,
        {
          chapterCount: Number(row.chapterCount ?? 0),
          maxChapterUpdatedAt: row.maxChapterUpdatedAt ?? null,
          maxTranslationGeneration: Number(row.maxTranslationGeneration ?? 0),
        } satisfies ChapterRevisionStats,
      ]),
    );
    const exportable = new Set(exportableRows.map((row) => row.novelId));

    for (const novel of novelRows) {
      if (!exportable.has(novel.id)) continue;
      const stats = statsByNovel.get(novel.id) ?? {
        chapterCount: 0,
        maxChapterUpdatedAt: null,
        maxTranslationGeneration: 0,
      };
      for (const format of EXPORT_FORMATS) keys.add(exportCacheKey(novel, stats, format));
    }
  }

  return keys;
}

/**
 * Tees a generated export into object storage while the client streams it, so a
 * repeat download of an unchanged novel never re-walks every chapter. Cache writes
 * are best-effort: a failure must not fail or truncate the download.
 */
function spoolExportToStorage(
  source: ReadableStream<Uint8Array>,
  key: ObjectKey,
  contentType: string,
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let overflowed = false;
  let stored = false;

  async function persist(): Promise<void> {
    if (stored || overflowed || size === 0) return;
    stored = true;
    try {
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      await getPrivateStorage().put(key, bytes, { contentType });
    } catch {
      // The download already succeeded; a missing cache entry only costs a rebuild.
    }
  }

  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          await persist();
          return;
        }
        if (!overflowed) {
          if (size + value.length > EXPORT_CACHE_MAX_BYTES) {
            overflowed = true;
            chunks.length = 0;
          } else {
            // Copy: the queued buffer is owned by the consumer. Nothing in the
            // export generators reuses one, but this keeps the spool independent.
            chunks.push(value.slice());
            size += value.length;
          }
        }
        controller.enqueue(value);
      },
      async cancel() {
        overflowed = true;
        await reader.cancel();
      },
    },
    new ByteLengthQueuingStrategy({ highWaterMark: STREAM_HIGH_WATER_MARK }),
  );
}

function textStream(title: string, author: string | null, novelId: string) {
  const encoder = new TextEncoder();
  let iterator: AsyncIterator<ExportChapterRow> | null = null;
  let closed = false;
  let headerEmitted = false;
  let emittedAny = false;

  async function closeIterator() {
    try {
      await iterator?.return?.();
    } catch {
      // Cleanup failure must not mask the original producer/consumer failure.
    } finally {
      iterator = null;
    }
  }

  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        if (closed) return;
        try {
          if (!headerEmitted) {
            // Lazily open the cursor on the first body pull; HEAD never gets here.
            iterator = chapterCursor(novelId);
            controller.enqueue(encoder.encode(`${title}\n${author ? `by ${author}\n` : ""}\n`));
            headerEmitted = true;
            return;
          }
          iterator ??= chapterCursor(novelId);
          const next = await iterator.next();
          if (closed) return;
          if (next.done) {
            closed = true;
            controller.close();
            return;
          }
          const chapter = next.value;
          controller.enqueue(
            encoder.encode(
              `${emittedAny ? "\n" : ""}\n${chapterTitle(chapter)}\n\n${chapter.translatedContent}\n`,
            ),
          );
          emittedAny = true;
        } catch (error) {
          if (closed) return;
          closed = true;
          await closeIterator();
          throw error;
        }
      },
      async cancel() {
        closed = true;
        await closeIterator();
      },
    },
    new ByteLengthQueuingStrategy({ highWaterMark: STREAM_HIGH_WATER_MARK }),
  );
}

async function* epubChapters(novelId: string): AsyncGenerator<EpubChapter> {
  for await (const chapter of chapterCursor(novelId)) {
    yield {
      title: chapterTitle(chapter),
      paragraphs: splitParagraphs(chapter.translatedContent),
    };
  }
}

export async function createNovelExportResponse(
  novelId: string,
  userId: string,
  format: "txt" | "epub",
  includeBody = true,
): Promise<Response> {
  const manifest = await loadExportMetadata(novelId, userId);
  if (!manifest)
    return new Response("Novel not found or has no translated chapters", { status: 404 });

  const filename = `${sanitizeFilename(manifest.novel.title)}.${format}`;
  const contentType = format === "txt" ? "text/plain; charset=utf-8" : "application/epub+zip";
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    "Content-Disposition": contentDisposition(filename),
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
  });
  if (!includeBody) return new Response(null, { status: 200, headers });

  const stats = await loadChapterRevisionStats(manifest.novel.id);
  const cacheKey = exportCacheKey(manifest.novel, stats, format);

  // Exports stay private: a cached object is streamed back through this
  // authenticated route, never handed to the browser as a signed URL.
  const cached = await getPrivateStorage().get(cacheKey);
  if (cached) {
    return new Response(cached.bytes as unknown as BodyInit, { headers });
  }

  const generated =
    format === "txt"
      ? textStream(manifest.novel.title, manifest.novel.author, manifest.novel.id)
      : createEpubStream(
          {
            title: manifest.novel.title,
            author: manifest.novel.author || "Unknown",
            language: manifest.novel.targetLang || "en",
            identifier: `urn:pnt:${manifest.novel.id}`,
          } satisfies EpubMetadata,
          epubChapters(manifest.novel.id),
        );

  return new Response(spoolExportToStorage(generated, cacheKey, contentType), { headers });
}
