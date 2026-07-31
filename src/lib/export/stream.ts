import "@tanstack/react-start/server-only";

import { and, asc, eq, isNotNull, sql } from "drizzle-orm";

import { db, queryClient } from "@/lib/db";
import { chapters, novels } from "@/lib/db/schema";
import { contentDisposition, sanitizeFilename } from "@/lib/filename";
import { splitParagraphs } from "@/lib/translation/paragraphs";
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

async function loadExportManifest(novelId: string, userId: string) {
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

  const chapterRows = await db
    .select({
      number: chapters.number,
      title: chapters.title,
      translatedTitle: chapters.translatedTitle,
    })
    .from(chapters)
    .where(and(eq(chapters.novelId, novelId), isNotNull(chapters.translatedContent)))
    .orderBy(asc(sql`COALESCE(${chapters.number}::numeric, 0)`));
  if (chapterRows.length === 0) return null;

  return { novel, chapterTitles: chapterRows.map(chapterTitle) };
}

async function* chapterCursor(novelId: string): AsyncGenerator<ExportChapterRow> {
  const cursor = queryClient<ExportChapterRow[]>`
    SELECT
      "number"::text AS "number",
      "title",
      "translated_title" AS "translatedTitle",
      "translated_content" AS "translatedContent"
    FROM "chapters"
    WHERE "novel_id" = ${novelId} AND "translated_content" IS NOT NULL
    ORDER BY COALESCE("number"::numeric, 0)
  `.cursor(1);

  for await (const rows of cursor) {
    if (rows[0]) yield rows[0];
  }
}

function textStream(title: string, author: string | null, novelId: string) {
  const encoder = new TextEncoder();
  let cancelled = false;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        try {
          controller.enqueue(encoder.encode(`${title}\n${author ? `by ${author}\n` : ""}\n`));
          let first = true;
          for await (const chapter of chapterCursor(novelId)) {
            if (cancelled) return;
            controller.enqueue(
              encoder.encode(
                `${first ? "" : "\n"}\n${chapterTitle(chapter)}\n\n${chapter.translatedContent}\n`,
              ),
            );
            first = false;
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      })();
    },
    cancel() {
      cancelled = true;
    },
  });
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
  const manifest = await loadExportManifest(novelId, userId);
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
  return new Response(
    createEpubStream(metadata, manifest.chapterTitles, epubChapters(manifest.novel.id)),
    { headers },
  );
}
