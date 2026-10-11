import "@tanstack/react-start/server-only";

import { and, eq, sql } from "drizzle-orm";

import { db, queryClient } from "@/lib/db";
import { chapters, novels } from "@/lib/db/schema";
import { contentDisposition, sanitizeFilename } from "@/lib/filename";
import { splitParagraphs } from "@/lib/translation/text/paragraphs";
import { getPrivateStorage } from "@/lib/storage/index.server";
import { exportObjectKey, exportRevision } from "@/lib/storage/keys";
import { createEpubStream, type EpubChapter, type EpubMetadata } from "./epub";

interface ExportChapterRow {
  number: string;
  title: string;
  translatedTitle: string | null;
  translatedContent: string;
}

function chapterTitle(chapter: Pick<ExportChapterRow, "number" | "title" | "translatedTitle">) {
  return `Chapter ${Number(chapter.number)} — ${chapter.translatedTitle ?? chapter.title}`;
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

interface ChapterRevisionStats {
  chapterCount: number;
  maxChapterUpdatedAt: Date | null;
  maxTranslationGeneration: number;
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
 * Tees a generated export into object storage while the client streams it, so a
 * repeat download of an unchanged novel never re-walks every chapter. Cache writes
 * are best-effort: a failure must not fail or truncate the download.
 */
function spoolExportToStorage(
  source: ReadableStream<Uint8Array>,
  key: string,
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
  const cacheKey = exportObjectKey(
    manifest.novel.id,
    exportRevision({
      format,
      novelTitle: manifest.novel.title,
      novelAuthor: manifest.novel.author,
      targetLang: manifest.novel.targetLang,
      chapterCount: stats.chapterCount,
      maxChapterUpdatedAt: stats.maxChapterUpdatedAt,
      maxTranslationGeneration: stats.maxTranslationGeneration,
    }),
    format,
  );

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
