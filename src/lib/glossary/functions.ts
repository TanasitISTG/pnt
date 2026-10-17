import { createServerFn } from "@tanstack/react-start";
import { eq, and, sql, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { encodeMessage } from "@/lib/i18n/message-code";
import { lockNovelForMutation, type NovelMutationTransaction } from "@/lib/db/novel-lock";
import { novels, chapters, glossaryTerms, termCategoryEnum } from "@/lib/db/schema";
// Terms, stats, and replacement previews are owner-scoped reads; they authenticate
// with `ensureSessionForRead` so an operator's read-only view still renders them.
import { ensureSession, ensureSessionForRead } from "@/lib/auth/functions";
import { nanoid } from "@/lib/utils";
import {
  listTermsSchema,
  createTermSchema,
  updateTermSchema,
  deleteTermSchema,
  approveTermSchema,
  rejectTermSchema,
  bulkImportTermsSchema,
  previewTermReplacementSchema,
} from "@/lib/glossary/schemas";
import { withSafeHandler, SafeServerError } from "@/lib/server-fn-error";
import {
  deleteAllGlossaryTermsForUser,
  getGlossaryStatsForUser,
  listGlossaryTermsForUser,
  rejectAllPendingGlossaryTermsForUser,
  updateGlossaryTermAtomic,
} from "@/lib/glossary/service";

async function lockOwnedTerm(tx: NovelMutationTransaction, userId: string, termId: string) {
  const [parent] = await tx
    .select({ novelId: glossaryTerms.novelId })
    .from(glossaryTerms)
    .where(eq(glossaryTerms.id, termId))
    .limit(1);
  if (!parent || !(await lockNovelForMutation(tx, parent.novelId, userId))) {
    throw new SafeServerError(encodeMessage("errors.glossaryTermNotFoundOrUnauthorized"));
  }
  const [term] = await tx
    .select({ id: glossaryTerms.id })
    .from(glossaryTerms)
    .where(and(eq(glossaryTerms.id, termId), eq(glossaryTerms.novelId, parent.novelId)))
    .limit(1)
    .for("update", { of: glossaryTerms });
  if (!term) throw new SafeServerError(encodeMessage("errors.glossaryTermNotFoundOrUnauthorized"));
  return term;
}

export const listGlossaryTerms = createServerFn({ method: "GET" })
  .validator(listTermsSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSessionForRead();
      return listGlossaryTermsForUser(session.user.id, data);
    }),
  );

export const createGlossaryTerm = createServerFn({ method: "POST" })
  .validator(createTermSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();

      return db.transaction(async (tx) => {
        if (!(await lockNovelForMutation(tx, data.novelId, session.user.id))) {
          throw new SafeServerError(encodeMessage("errors.novelNotFoundOrUnauthorized"));
        }

        const [existing] = await tx
          .select({ id: glossaryTerms.id })
          .from(glossaryTerms)
          .where(
            and(
              eq(glossaryTerms.novelId, data.novelId),
              eq(glossaryTerms.source, data.source.trim()),
            ),
          )
          .limit(1);

        if (existing) {
          throw new SafeServerError(
            encodeMessage("errors.glossaryTermExists", { source: data.source.trim() }),
          );
        }

        const termId = nanoid();
        await tx.insert(glossaryTerms).values({
          id: termId,
          novelId: data.novelId,
          source: data.source.trim(),
          target: data.target.trim(),
          category: data.category ?? "other",
          note: data.note?.trim() || null,
          status: "approved",
        });

        return { id: termId };
      });
    }),
  );

export const updateGlossaryTerm = createServerFn({ method: "POST" })
  .validator(updateTermSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      return updateGlossaryTermAtomic(session.user.id, data);
    }),
  );

export const previewTermReplacement = createServerFn({ method: "GET" })
  .validator(previewTermReplacementSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSessionForRead();

      const [novel] = await db
        .select({ id: novels.id })
        .from(novels)
        .where(and(eq(novels.id, data.novelId), eq(novels.userId, session.user.id)))
        .limit(1);

      if (!novel) {
        throw new SafeServerError(encodeMessage("errors.novelNotFoundOrUnauthorized"));
      }

      const [row] = await db
        .select({
          chapterCount: sql<number>`count(*)::int`,
          // ponytail: ::text cast — a bare placeholder's type can't be inferred inside length()
          occurrences: sql<number>`coalesce(sum((length(${chapters.translatedContent}) - length(replace(${chapters.translatedContent}, ${data.oldTarget}, ''))) / length(${data.oldTarget}::text)), 0)::int`,
        })
        .from(chapters)
        .where(
          and(
            eq(chapters.novelId, data.novelId),
            sql`strpos(${chapters.translatedContent}, ${data.oldTarget}) > 0`,
          ),
        );

      return { chapterCount: row?.chapterCount ?? 0, occurrences: row?.occurrences ?? 0 };
    }),
  );

export const deleteGlossaryTerm = createServerFn({ method: "POST" })
  .validator(deleteTermSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();

      return db.transaction(async (tx) => {
        const term = await lockOwnedTerm(tx, session.user.id, data.termId);
        await tx.delete(glossaryTerms).where(eq(glossaryTerms.id, term.id));
        return { success: true };
      });
    }),
  );

export const bulkImportGlossaryTerms = createServerFn({ method: "POST" })
  .validator(bulkImportTermsSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();

      const [novel] = await db
        .select({ id: novels.id })
        .from(novels)
        .where(and(eq(novels.id, data.novelId), eq(novels.userId, session.user.id)))
        .limit(1);

      if (!novel) {
        throw new SafeServerError(encodeMessage("errors.novelNotFoundOrUnauthorized"));
      }

      const lines = data.tsv
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      const validCategories = termCategoryEnum.enumValues;
      const validCategorySet = new Set<string>(validCategories);
      const errors: string[] = [];

      const parsedMap = new Map<
        string,
        {
          source: string;
          target: string;
          category: (typeof validCategories)[number];
          note: string | null;
        }
      >();

      for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        const parts = line.split("\t").map((p) => p.trim());

        if (parts.length < 2) {
          errors.push(encodeMessage("errors.glossaryImportColumnsMissing", { line: index + 1 }));
          continue;
        }

        const source = parts[0];
        const target = parts[1];
        let category: (typeof validCategories)[number] = "other";
        let note: string | null = null;

        if (!source || !target) {
          errors.push(encodeMessage("errors.glossaryImportValueEmpty", { line: index + 1 }));
          continue;
        }

        if (parts[2]) {
          const catInput = parts[2].toLowerCase();
          if (validCategorySet.has(catInput)) {
            category = catInput as (typeof validCategories)[number];
          }
        }

        if (parts[3]) {
          note = parts[3];
        }

        parsedMap.set(source, { source, target, category, note });
      }

      const uniqueSources = Array.from(parsedMap.keys());
      if (uniqueSources.length === 0) {
        return { imported: 0, updated: 0, totalProcessed: 0, errors };
      }

      let updated = 0;
      let imported = 0;

      const rowsToInsert = Array.from(parsedMap.values()).map((row) => ({
        id: nanoid(),
        novelId: data.novelId,
        source: row.source,
        target: row.target,
        category: row.category,
        note: row.note,
        status: "approved" as const,
        updatedAt: new Date(),
      }));

      const CHUNK_SIZE = 500;
      // Each batch commits independently, sequentially under the novel gate.
      for (let i = 0; i < rowsToInsert.length; i += CHUNK_SIZE) {
        const chunk = rowsToInsert.slice(i, i + CHUNK_SIZE);
        const existingCount = await db.transaction(async (tx) => {
          if (!(await lockNovelForMutation(tx, data.novelId, session.user.id))) {
            throw new SafeServerError(encodeMessage("errors.novelNotFoundOrUnauthorized"));
          }
          const existingTerms = await tx
            .select({ source: glossaryTerms.source })
            .from(glossaryTerms)
            .where(
              and(
                eq(glossaryTerms.novelId, data.novelId),
                inArray(
                  glossaryTerms.source,
                  chunk.map((row) => row.source),
                ),
              ),
            );
          await tx
            .insert(glossaryTerms)
            .values(chunk)
            .onConflictDoUpdate({
              target: [glossaryTerms.novelId, glossaryTerms.source],
              set: {
                target: sql`excluded.target`,
                category: sql`excluded.category`,
                note: sql`coalesce(excluded.note, ${glossaryTerms.note})`,
                status: "approved",
                updatedAt: new Date(),
              },
            });
          return existingTerms.length;
        });
        updated += existingCount;
        imported += chunk.length - existingCount;
      }

      return { imported, updated, totalProcessed: imported + updated, errors };
    }),
  );

export const approveGlossaryTerm = createServerFn({ method: "POST" })
  .validator(approveTermSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();

      return db.transaction(async (tx) => {
        const term = await lockOwnedTerm(tx, session.user.id, data.termId);
        await tx
          .update(glossaryTerms)
          .set({ status: "approved", updatedAt: new Date() })
          .where(eq(glossaryTerms.id, term.id));
        return { success: true };
      });
    }),
  );

export const approveAllPendingTerms = createServerFn({ method: "POST" })
  .validator(z.object({ novelId: z.string().min(1) }))
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();

      return db.transaction(async (tx) => {
        if (!(await lockNovelForMutation(tx, data.novelId, session.user.id))) {
          throw new SafeServerError(encodeMessage("errors.novelNotFoundOrUnauthorized"));
        }
        await tx
          .update(glossaryTerms)
          .set({ status: "approved", updatedAt: new Date() })
          .where(and(eq(glossaryTerms.novelId, data.novelId), eq(glossaryTerms.status, "pending")));
        return { success: true };
      });
    }),
  );

export const rejectAllPendingTerms = createServerFn({ method: "POST" })
  .validator(z.object({ novelId: z.string().min(1) }))
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      return rejectAllPendingGlossaryTermsForUser(session.user.id, data.novelId);
    }),
  );

export const deleteAllGlossaryTerms = createServerFn({ method: "POST" })
  .validator(z.object({ novelId: z.string().min(1) }))
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      return deleteAllGlossaryTermsForUser(session.user.id, data.novelId);
    }),
  );

export const rejectGlossaryTerm = createServerFn({ method: "POST" })
  .validator(rejectTermSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();

      return db.transaction(async (tx) => {
        const term = await lockOwnedTerm(tx, session.user.id, data.termId);
        await tx
          .update(glossaryTerms)
          .set({ status: "rejected", updatedAt: new Date() })
          .where(eq(glossaryTerms.id, term.id));
        return { success: true };
      });
    }),
  );

export const getGlossaryStats = createServerFn({ method: "GET" })
  .validator(z.object({ novelId: z.string().min(1) }))
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSessionForRead();
      return getGlossaryStatsForUser(session.user.id, data.novelId);
    }),
  );
