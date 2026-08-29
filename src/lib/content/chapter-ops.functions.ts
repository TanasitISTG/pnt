import { createServerFn } from "@tanstack/react-start";
import { eq, and, sql, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { novels, chapters } from "@/lib/db/schema";
import { ensureSession } from "@/lib/auth/functions";
import { findResidualSourceChars, RESIDUAL_CJK_SQL_RE } from "@/lib/translation/prompts";
import { withSafeHandler, SafeServerError } from "@/lib/server-fn-error";
import {
  deleteAllNovelTranslationsForUser,
  translateMissingTitlesForUser,
} from "@/lib/content/chapter-ops.service";

export const translateMissingTitles = createServerFn({ method: "POST" })
  .validator(z.object({ novelId: z.string() }))
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      return translateMissingTitlesForUser(session.user.id, data.novelId);
    }),
  );

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

export const deleteAllNovelTranslations = createServerFn({ method: "POST" })
  .validator(z.object({ novelId: z.string().min(1) }))
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      return deleteAllNovelTranslationsForUser(session.user.id, data.novelId);
    }),
  );
