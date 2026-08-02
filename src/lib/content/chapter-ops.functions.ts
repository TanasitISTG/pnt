import { createServerFn } from "@tanstack/react-start";
import { eq, and, sql, asc, isNull, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { novels, chapters } from "@/lib/db/schema";
import { ensureSession } from "@/lib/auth/functions";
import { createProviderClient } from "@/lib/translation/provider-client";
import { translateChapterTitle } from "@/lib/translation/title";
import { findResidualSourceChars, RESIDUAL_CJK_SQL_RE } from "@/lib/translation/prompts";
import { withSafeHandler, SafeServerError } from "@/lib/server-fn-error";

/** Split items into consecutive fixed-size batches, preserving order. */
export function batchesOf<T>(items: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
}

export const translateMissingTitles = createServerFn({ method: "POST" })
  .validator(z.object({ novelId: z.string() }))
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await ensureSession();

      const [novel] = await db
        .select()
        .from(novels)
        .where(and(eq(novels.id, data.novelId), eq(novels.userId, session.user.id)))
        .limit(1);

      if (!novel) {
        throw new SafeServerError("Novel not found or unauthorized");
      }

      const missing = await db
        .select({ id: chapters.id, title: chapters.title })
        .from(chapters)
        .where(
          and(
            eq(chapters.novelId, data.novelId),
            eq(chapters.status, "translated"),
            isNull(chapters.translatedTitle),
          ),
        )
        .orderBy(asc(sql`COALESCE(${chapters.number}::numeric, 0)`))
        // One serverless request can't hold a big backlog of sequential
        // LLM calls — cap per click; the UI re-clicks for the next batch.
        .limit(20);

      if (missing.length === 0) {
        return { translated: 0 };
      }

      const providerConfig = await createProviderClient(session.user.id);
      const pair = `${novel.sourceLang}->${novel.targetLang}`;

      // Small parallel batches: 20 sequential LLM calls is slow, 20 parallel
      // is a provider rate-limit burst. 5 at a time.
      let translated = 0;
      for (const batch of batchesOf(missing, 5)) {
        const results = await Promise.all(
          batch.map(async (ch) => {
            const { translated: title } = await translateChapterTitle(
              providerConfig,
              pair,
              ch.title,
            );
            if (!title) return false;
            await db
              .update(chapters)
              .set({ translatedTitle: title, updatedAt: new Date() })
              .where(eq(chapters.id, ch.id));
            return true;
          }),
        );
        translated += results.filter(Boolean).length;
      }

      return { translated };
    });
  });

export const getResidualHanziChapters = createServerFn({ method: "GET" })
  .validator(z.object({ novelId: z.string() }))
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await ensureSession();

      const [novel] = await db
        .select({
          id: novels.id,
          sourceLang: novels.sourceLang,
          targetLang: novels.targetLang,
        })
        .from(novels)
        .where(and(eq(novels.id, data.novelId), eq(novels.userId, session.user.id)))
        .limit(1);

      if (!novel) {
        throw new SafeServerError("Novel not found or unauthorized");
      }

      // DB-side pre-filter: which translated chapters contain ANY residual CJK
      // char. Chapter bodies stay in Postgres — clean chapters (the common
      // case) never cross the wire. RESIDUAL_CJK_SQL_RE is the same char class
      // findResidualSourceChars uses, so detection matches exactly.
      const flagged = await db
        .select({ id: chapters.id, number: chapters.number })
        .from(chapters)
        .where(
          and(
            eq(chapters.novelId, data.novelId),
            eq(chapters.status, "translated"),
            sql`${chapters.translatedContent} ~ ${RESIDUAL_CJK_SQL_RE}`,
          ),
        );

      if (flagged.length === 0) return [];

      // Exact counts come from the JS scanner — fetched for flagged rows only.
      const contents = await db
        .select({ id: chapters.id, translatedContent: chapters.translatedContent })
        .from(chapters)
        .where(
          inArray(
            chapters.id,
            flagged.map((c) => c.id),
          ),
        );
      const contentById = new Map(contents.map((c) => [c.id, c.translatedContent]));

      const pair = `${novel.sourceLang}->${novel.targetLang}`;
      const residualChapters: { chapterId: string; number: string; count: number }[] = [];
      for (const ch of flagged) {
        const result = {
          chapterId: ch.id,
          number: ch.number,
          count: findResidualSourceChars(pair, contentById.get(ch.id) ?? "").length,
        };
        if (result.count > 0) residualChapters.push(result);
      }
      return residualChapters;
    });
  });
