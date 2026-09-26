import "@tanstack/react-start/server-only";

import { and, eq } from "drizzle-orm";

import { db, queryClient } from "@/lib/db";
import { chapters, novels } from "@/lib/db/schema";
import { contentDisposition, sanitizeFilename } from "@/lib/filename";
import { chapterTranslationPresent } from "@/lib/content/publish/publish";
import { splitParagraphs } from "@pnt/reader-core/paragraphs";
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

  // Existence-only check with the exact nonblank predicate the body cursor uses,
  // so HEAD and body responses agree on whether any exportable chapter exists.
  const [present] = await db
    .select({ id: chapters.id })
    .from(chapters)
    .where(and(eq(chapters.novelId, novelId), chapterTranslationPresent()))
    .limit(1);
  if (!present) return null;

  return { novel };
}

async function* chapterCursor(novelId: string): AsyncGenerator<ExportChapterRow> {
  const cursor = queryClient<ExportChapterRow[]>`
    SELECT
      "number"::text AS "number",
      "title",
      "translated_title" AS "translatedTitle",
      "translated_content" AS "translatedContent"
    FROM "chapters"
    WHERE "novel_id" = ${novelId}
      AND "translated_content" IS NOT NULL
      AND regexp_replace("translated_content", '[[:space:]]', '', 'g') <> ''
    ORDER BY "chapters"."number"
  `.cursor(1);

  for await (const rows of cursor) {
    if (rows[0]) yield rows[0];
  }
}

// One chapter's serialization output may exceed the queue mark; the bound is
// "highWaterMark plus at most one pending unit", never a whole novel.
const STREAM_HIGH_WATER_MARK = 64 * 1024;

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
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    "Content-Disposition": contentDisposition(filename),
    "Content-Type": format === "txt" ? "text/plain; charset=utf-8" : "application/epub+zip",
    "X-Content-Type-Options": "nosniff",
  });
  if (!includeBody) return new Response(null, { status: 200, headers });

  if (format === "txt") {
    return new Response(
      textStream(manifest.novel.title, manifest.novel.author, manifest.novel.id),
      { headers },
    );
  }

  const metadata: EpubMetadata = {
    title: manifest.novel.title,
    author: manifest.novel.author || "Unknown",
    language: manifest.novel.targetLang || "en",
    identifier: `urn:pnt:${manifest.novel.id}`,
  };
  return new Response(createEpubStream(metadata, epubChapters(manifest.novel.id)), { headers });
}
