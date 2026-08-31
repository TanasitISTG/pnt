import { createServerFn } from "@tanstack/react-start";
import { eq, and, sql, inArray, count } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { novels, chapters, glossaryTerms, termCategoryEnum } from "@/lib/db/schema";
import { ensureSession } from "@/lib/auth/functions";
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
  listGlossaryTermsForUser,
  rejectAllPendingGlossaryTermsForUser,
  updateGlossaryTermAtomic,
} from "@/lib/glossary/service";

export const listGlossaryTerms = createServerFn({ method: "GET" })
  .validator(listTermsSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      return listGlossaryTermsForUser(session.user.id, data);
    }),
  );

export const createGlossaryTerm = createServerFn({ method: "POST" })
  .validator(createTermSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();

      const [novel] = await db
        .select({ id: novels.id })
        .from(novels)
        .where(and(eq(novels.id, data.novelId), eq(novels.userId, session.user.id)))
        .limit(1);

      if (!novel) {
        throw new SafeServerError("Novel not found or unauthorized");
      }

      const [existing] = await db
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
        throw new SafeServerError(`Term with source "${data.source.trim()}" already exists`);
      }

      const termId = nanoid();
      await db.insert(glossaryTerms).values({
        id: termId,
        novelId: data.novelId,
        source: data.source.trim(),
        target: data.target.trim(),
        category: data.category ?? "other",
        note: data.note?.trim() || null,
        status: "approved",
      });

      return { id: termId };
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
      const session = await ensureSession();

      const [novel] = await db
        .select({ id: novels.id })
        .from(novels)
        .where(and(eq(novels.id, data.novelId), eq(novels.userId, session.user.id)))
        .limit(1);

      if (!novel) {
        throw new SafeServerError("Novel not found or unauthorized");
      }

      const [row] = await db
        .select({
          chapterCount: sql<number>`count(*)::int`,
          // ponytail: ::text cast — CockroachDB can't infer a bare placeholder's type inside length()
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

      const [term] = await db
        .select({ id: glossaryTerms.id })
        .from(glossaryTerms)
        .innerJoin(novels, eq(glossaryTerms.novelId, novels.id))
        .where(and(eq(glossaryTerms.id, data.termId), eq(novels.userId, session.user.id)))
        .limit(1);

      if (!term) {
        throw new SafeServerError("Glossary term not found or unauthorized");
      }

      await db.delete(glossaryTerms).where(eq(glossaryTerms.id, data.termId));

      return { success: true };
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
        throw new SafeServerError("Novel not found or unauthorized");
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
          errors.push(`Line ${index + 1}: Must have at least source and target (separated by tab)`);
          continue;
        }

        const source = parts[0];
        const target = parts[1];
        let category: (typeof validCategories)[number] = "other";
        let note: string | null = null;

        if (!source || !target) {
          errors.push(`Line ${index + 1}: Source and target cannot be empty`);
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

      const existingTerms = await db
        .select({ source: glossaryTerms.source })
        .from(glossaryTerms)
        .where(
          and(
            eq(glossaryTerms.novelId, data.novelId),
            inArray(glossaryTerms.source, uniqueSources),
          ),
        );

      const existingSourceSet = new Set(existingTerms.map((t) => t.source));
      let updated = 0;
      let imported = 0;
      for (const src of uniqueSources) {
        if (existingSourceSet.has(src)) {
          updated++;
        } else {
          imported++;
        }
      }

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
      // 500-row chunks keep statements small; 2 in flight bounds the
      // serverless DB burst while still overlapping round trips.
      const INSERT_CONCURRENCY = 2;
      const insertChunks: (typeof rowsToInsert)[] = [];
      for (let i = 0; i < rowsToInsert.length; i += CHUNK_SIZE) {
        insertChunks.push(rowsToInsert.slice(i, i + CHUNK_SIZE));
      }
      for (let i = 0; i < insertChunks.length; i += INSERT_CONCURRENCY) {
        await Promise.all(
          insertChunks.slice(i, i + INSERT_CONCURRENCY).map((chunk) =>
            db
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
              }),
          ),
        );
      }

      return { imported, updated, totalProcessed: imported + updated, errors };
    }),
  );

export const approveGlossaryTerm = createServerFn({ method: "POST" })
  .validator(approveTermSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();

      const [term] = await db
        .select({ id: glossaryTerms.id })
        .from(glossaryTerms)
        .innerJoin(novels, eq(glossaryTerms.novelId, novels.id))
        .where(and(eq(glossaryTerms.id, data.termId), eq(novels.userId, session.user.id)))
        .limit(1);

      if (!term) {
        throw new SafeServerError("Glossary term not found or unauthorized");
      }

      await db
        .update(glossaryTerms)
        .set({ status: "approved", updatedAt: new Date() })
        .where(eq(glossaryTerms.id, data.termId));

      return { success: true };
    }),
  );

export const approveAllPendingTerms = createServerFn({ method: "POST" })
  .validator(z.object({ novelId: z.string().min(1) }))
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();

      const [novel] = await db
        .select({ id: novels.id })
        .from(novels)
        .where(and(eq(novels.id, data.novelId), eq(novels.userId, session.user.id)))
        .limit(1);

      if (!novel) {
        throw new SafeServerError("Novel not found or unauthorized");
      }

      await db
        .update(glossaryTerms)
        .set({ status: "approved", updatedAt: new Date() })
        .where(and(eq(glossaryTerms.novelId, data.novelId), eq(glossaryTerms.status, "pending")));

      return { success: true };
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

      const [term] = await db
        .select({ id: glossaryTerms.id })
        .from(glossaryTerms)
        .innerJoin(novels, eq(glossaryTerms.novelId, novels.id))
        .where(and(eq(glossaryTerms.id, data.termId), eq(novels.userId, session.user.id)))
        .limit(1);

      if (!term) {
        throw new SafeServerError("Glossary term not found or unauthorized");
      }

      await db
        .update(glossaryTerms)
        .set({ status: "rejected", updatedAt: new Date() })
        .where(eq(glossaryTerms.id, data.termId));

      return { success: true };
    }),
  );

export const getGlossaryStats = createServerFn({ method: "GET" })
  .validator(z.object({ novelId: z.string().min(1) }))
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();

      const [row] = await db
        .select({
          total: count(glossaryTerms.id),
          approved: sql<number>`count(case when ${glossaryTerms.status} = 'approved' then 1 end)::int`,
          pending: sql<number>`count(case when ${glossaryTerms.status} = 'pending' then 1 end)::int`,
          rejected: sql<number>`count(case when ${glossaryTerms.status} = 'rejected' then 1 end)::int`,
        })
        .from(glossaryTerms)
        .innerJoin(novels, eq(glossaryTerms.novelId, novels.id))
        .where(and(eq(glossaryTerms.novelId, data.novelId), eq(novels.userId, session.user.id)));

      return {
        total: row?.total ?? 0,
        approved: row?.approved ?? 0,
        pending: row?.pending ?? 0,
        rejected: row?.rejected ?? 0,
      };
    }),
  );
