import { createServerFn } from "@tanstack/react-start";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { chapters, novels } from "@/lib/db/schema";
import { ensureSession } from "@/lib/auth.functions";
import { buildEpub } from "@/lib/export/epub";
import { splitParagraphs } from "@/lib/translation/paragraphs";
import { withSafeHandler, SafeServerError } from "@/lib/server-fn-error";

const exportSchema = z.object({ novelId: z.string().min(1) });

function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, "").trim();
  return cleaned || "export";
}

async function loadTranslatedChapters(novelId: string, userId: string) {
  const [novel] = await db
    .select()
    .from(novels)
    .where(and(eq(novels.id, novelId), eq(novels.userId, userId)))
    .limit(1);

  if (!novel) {
    throw new SafeServerError("Novel not found or unauthorized");
  }

  // Untranslated chapters are skipped — exports contain translated content only.
  const translated = await db
    .select({
      number: chapters.number,
      title: chapters.title,
      translatedTitle: chapters.translatedTitle,
      translatedContent: chapters.translatedContent,
    })
    .from(chapters)
    .where(and(eq(chapters.novelId, novelId), isNotNull(chapters.translatedContent)))
    .orderBy(asc(sql`COALESCE(${chapters.number}::numeric, 0)`));

  if (translated.length === 0) {
    throw new SafeServerError("No translated chapters to export yet");
  }

  return { novel, translated };
}

export const exportNovelTxt = createServerFn({ method: "GET" })
  .validator(exportSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      const { novel, translated } = await loadTranslatedChapters(data.novelId, session.user.id);

      const parts = translated.map(
        (c) =>
          `Chapter ${Number(c.number)} — ${c.translatedTitle ?? c.title}\n\n${c.translatedContent}`,
      );
      const content = `${novel.title}\n${novel.author ? `by ${novel.author}\n` : ""}\n\n${parts.join("\n\n\n")}`;

      return {
        filename: `${sanitizeFilename(novel.title)}.txt`,
        content,
      };
    }),
  );

export const exportNovelEpub = createServerFn({ method: "GET" })
  .validator(exportSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      const { novel, translated } = await loadTranslatedChapters(data.novelId, session.user.id);

      const bytes = buildEpub(
        {
          title: novel.title,
          author: novel.author || "Unknown",
          language: novel.targetLang || "en",
          identifier: `urn:pnt:${novel.id}`,
        },
        translated.map((c) => ({
          title: `Chapter ${Number(c.number)} — ${c.translatedTitle ?? c.title}`,
          paragraphs: splitParagraphs(c.translatedContent!),
        })),
      );

      return {
        filename: `${sanitizeFilename(novel.title)}.epub`,
        dataBase64: Buffer.from(bytes).toString("base64"),
      };
    }),
  );
