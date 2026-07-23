import { createServerFn } from "@tanstack/react-start";
import { eq, and, or, ilike, sql, count, desc, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { novels, glossaryTerms, termCategoryEnum } from "@/lib/db/schema";
import { ensureSession } from "@/lib/auth.functions";
import { nanoid } from "@/lib/utils";
import {
  listTermsSchema,
  createTermSchema,
  updateTermSchema,
  deleteTermSchema,
  bulkImportTermsSchema,
  approveTermSchema,
  rejectTermSchema,
} from "@/lib/glossary.schemas";

export const listGlossaryTerms = createServerFn({ method: "GET" })
  .validator(listTermsSchema)
  .handler(async ({ data }) => {
    const session = await ensureSession();

    const conditions = [
      eq(glossaryTerms.novelId, data.novelId),
      eq(novels.userId, session.user.id),
    ];

    if (data.search && data.search.trim().length > 0) {
      const pattern = `%${data.search.trim()}%`;
      conditions.push(
        or(
          ilike(glossaryTerms.source, pattern),
          ilike(glossaryTerms.target, pattern),
          ilike(glossaryTerms.note, pattern),
        )!,
      );
    }

    if (data.category && data.category !== "all") {
      conditions.push(eq(glossaryTerms.category, data.category));
    }

    if (data.status && data.status !== "all") {
      conditions.push(eq(glossaryTerms.status, data.status));
    }

    return db
      .select({
        id: glossaryTerms.id,
        novelId: glossaryTerms.novelId,
        source: glossaryTerms.source,
        target: glossaryTerms.target,
        category: glossaryTerms.category,
        note: glossaryTerms.note,
        status: glossaryTerms.status,
        createdAt: glossaryTerms.createdAt,
        updatedAt: glossaryTerms.updatedAt,
      })
      .from(glossaryTerms)
      .innerJoin(novels, eq(glossaryTerms.novelId, novels.id))
      .where(and(...conditions))
      .orderBy(desc(glossaryTerms.createdAt));
  });

export const createGlossaryTerm = createServerFn({ method: "POST" })
  .validator(createTermSchema)
  .handler(async ({ data }) => {
    const session = await ensureSession();

    // Verify novel ownership
    const [novel] = await db
      .select({ id: novels.id })
      .from(novels)
      .where(and(eq(novels.id, data.novelId), eq(novels.userId, session.user.id)))
      .limit(1);

    if (!novel) {
      throw new Error("Novel not found or unauthorized");
    }

    // Check duplicate source
    const [existing] = await db
      .select({ id: glossaryTerms.id })
      .from(glossaryTerms)
      .where(
        and(eq(glossaryTerms.novelId, data.novelId), eq(glossaryTerms.source, data.source.trim())),
      )
      .limit(1);

    if (existing) {
      throw new Error(`Term with source "${data.source.trim()}" already exists for this novel`);
    }

    const termId = nanoid();
    await db.insert(glossaryTerms).values({
      id: termId,
      novelId: data.novelId,
      source: data.source.trim(),
      target: data.target.trim(),
      category: data.category,
      note: data.note?.trim() || null,
      status: data.status,
    });

    return { id: termId, success: true };
  });

export const updateGlossaryTerm = createServerFn({ method: "POST" })
  .validator(updateTermSchema)
  .handler(async ({ data }) => {
    const session = await ensureSession();

    // Verify ownership via join
    const [term] = await db
      .select({ id: glossaryTerms.id, novelId: glossaryTerms.novelId })
      .from(glossaryTerms)
      .innerJoin(novels, eq(glossaryTerms.novelId, novels.id))
      .where(and(eq(glossaryTerms.id, data.termId), eq(novels.userId, session.user.id)))
      .limit(1);

    if (!term) {
      throw new Error("Glossary term not found or unauthorized");
    }

    const updateData: Record<string, any> = { updatedAt: new Date() };
    if (data.source !== undefined) updateData.source = data.source.trim();
    if (data.target !== undefined) updateData.target = data.target.trim();
    if (data.category !== undefined) updateData.category = data.category;
    if (data.note !== undefined) updateData.note = data.note?.trim() || null;
    if (data.status !== undefined) updateData.status = data.status;

    // Check duplicate source if source is changing
    if (data.source !== undefined) {
      const [existing] = await db
        .select({ id: glossaryTerms.id })
        .from(glossaryTerms)
        .where(
          and(
            eq(glossaryTerms.novelId, term.novelId),
            eq(glossaryTerms.source, data.source.trim()),
            sql`${glossaryTerms.id} != ${data.termId}`,
          ),
        )
        .limit(1);

      if (existing) {
        throw new Error(`Term with source "${data.source.trim()}" already exists`);
      }
    }

    await db.update(glossaryTerms).set(updateData).where(eq(glossaryTerms.id, data.termId));

    return { success: true };
  });

export const deleteGlossaryTerm = createServerFn({ method: "POST" })
  .validator(deleteTermSchema)
  .handler(async ({ data }) => {
    const session = await ensureSession();

    const [term] = await db
      .select({ id: glossaryTerms.id })
      .from(glossaryTerms)
      .innerJoin(novels, eq(glossaryTerms.novelId, novels.id))
      .where(and(eq(glossaryTerms.id, data.termId), eq(novels.userId, session.user.id)))
      .limit(1);

    if (!term) {
      throw new Error("Glossary term not found or unauthorized");
    }

    await db.delete(glossaryTerms).where(eq(glossaryTerms.id, data.termId));

    return { success: true };
  });

export const bulkImportGlossaryTerms = createServerFn({ method: "POST" })
  .validator(bulkImportTermsSchema)
  .handler(async ({ data }) => {
    const session = await ensureSession();

    // Verify novel ownership
    const [novel] = await db
      .select({ id: novels.id })
      .from(novels)
      .where(and(eq(novels.id, data.novelId), eq(novels.userId, session.user.id)))
      .limit(1);

    if (!novel) {
      throw new Error("Novel not found or unauthorized");
    }

    const lines = data.tsv
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const validCategories = termCategoryEnum.enumValues;
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
        if ((validCategories as readonly string[]).includes(catInput)) {
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
        and(eq(glossaryTerms.novelId, data.novelId), inArray(glossaryTerms.source, uniqueSources)),
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
    for (let i = 0; i < rowsToInsert.length; i += CHUNK_SIZE) {
      const chunk = rowsToInsert.slice(i, i + CHUNK_SIZE);
      await db
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
    }

    return { imported, updated, totalProcessed: imported + updated, errors };
  });

export const approveGlossaryTerm = createServerFn({ method: "POST" })
  .validator(approveTermSchema)
  .handler(async ({ data }) => {
    const session = await ensureSession();

    const [term] = await db
      .select({ id: glossaryTerms.id })
      .from(glossaryTerms)
      .innerJoin(novels, eq(glossaryTerms.novelId, novels.id))
      .where(and(eq(glossaryTerms.id, data.termId), eq(novels.userId, session.user.id)))
      .limit(1);

    if (!term) {
      throw new Error("Glossary term not found or unauthorized");
    }

    await db
      .update(glossaryTerms)
      .set({ status: "approved", updatedAt: new Date() })
      .where(eq(glossaryTerms.id, data.termId));

    return { success: true };
  });

export const approveAllPendingTerms = createServerFn({ method: "POST" })
  .validator(z.object({ novelId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const session = await ensureSession();

    const [novel] = await db
      .select({ id: novels.id })
      .from(novels)
      .where(and(eq(novels.id, data.novelId), eq(novels.userId, session.user.id)))
      .limit(1);

    if (!novel) {
      throw new Error("Novel not found or unauthorized");
    }

    await db
      .update(glossaryTerms)
      .set({ status: "approved", updatedAt: new Date() })
      .where(and(eq(glossaryTerms.novelId, data.novelId), eq(glossaryTerms.status, "pending")));

    return { success: true };
  });

export const rejectGlossaryTerm = createServerFn({ method: "POST" })
  .validator(rejectTermSchema)
  .handler(async ({ data }) => {
    const session = await ensureSession();

    const [term] = await db
      .select({ id: glossaryTerms.id })
      .from(glossaryTerms)
      .innerJoin(novels, eq(glossaryTerms.novelId, novels.id))
      .where(and(eq(glossaryTerms.id, data.termId), eq(novels.userId, session.user.id)))
      .limit(1);

    if (!term) {
      throw new Error("Glossary term not found or unauthorized");
    }

    await db.delete(glossaryTerms).where(eq(glossaryTerms.id, data.termId));

    return { success: true };
  });

export const getGlossaryStats = createServerFn({ method: "GET" })
  .validator(z.object({ novelId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const session = await ensureSession();

    const [row] = await db
      .select({
        total: count(glossaryTerms.id),
        approved: sql<number>`count(case when ${glossaryTerms.status} = 'approved' then 1 end)::int`,
        pending: sql<number>`count(case when ${glossaryTerms.status} = 'pending' then 1 end)::int`,
      })
      .from(glossaryTerms)
      .innerJoin(novels, eq(glossaryTerms.novelId, novels.id))
      .where(and(eq(glossaryTerms.novelId, data.novelId), eq(novels.userId, session.user.id)));

    return {
      total: row?.total ?? 0,
      approved: row?.approved ?? 0,
      pending: row?.pending ?? 0,
    };
  });
