import "@tanstack/react-start/server-only";

import { and, asc, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { chapters, glossaryTerms, novels } from "@/lib/db/schema";
import {
  type GlossaryListInput,
  type GlossaryListPage,
  updateTermSchema,
} from "@/lib/glossary/schemas";
import { SafeServerError } from "@/lib/server-fn-error";

function escapeIlikePattern(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

export async function listGlossaryTermsForUser(
  userId: string,
  input: GlossaryListInput,
): Promise<GlossaryListPage> {
  const [novel] = await db
    .select({ id: novels.id })
    .from(novels)
    .where(and(eq(novels.id, input.novelId), eq(novels.userId, userId)))
    .limit(1);

  if (!novel) {
    throw new SafeServerError("Novel not found or unauthorized");
  }

  const conditions = [eq(glossaryTerms.novelId, input.novelId)];
  if (input.status !== "all") {
    conditions.push(eq(glossaryTerms.status, input.status));
  }
  if (input.category !== "all") {
    conditions.push(eq(glossaryTerms.category, input.category));
  }
  if (input.q) {
    const pattern = `%${escapeIlikePattern(input.q)}%`;
    conditions.push(
      or(
        ilike(glossaryTerms.source, pattern),
        ilike(glossaryTerms.target, pattern),
        ilike(glossaryTerms.note, pattern),
      )!,
    );
  }

  const where = and(...conditions);
  const [countRow] = await db
    .select({ count: count(glossaryTerms.id) })
    .from(glossaryTerms)
    .where(where);
  const rowCount = Number(countRow?.count ?? 0);
  const maxPage = Math.max(1, Math.ceil(rowCount / input.pageSize));
  const page = Math.min(Math.max(input.page, 1), maxPage);
  const sortColumn = {
    source: sql`lower(${glossaryTerms.source})`,
    target: sql`lower(${glossaryTerms.target})`,
    category: glossaryTerms.category,
    status: glossaryTerms.status,
  }[input.sort];
  const sortOrder = input.dir === "asc" ? asc : desc;

  const rows = await db
    .select({
      id: glossaryTerms.id,
      source: glossaryTerms.source,
      target: glossaryTerms.target,
      category: glossaryTerms.category,
      note: glossaryTerms.note,
      status: glossaryTerms.status,
    })
    .from(glossaryTerms)
    .where(where)
    .orderBy(sortOrder(sortColumn), asc(glossaryTerms.id))
    .limit(input.pageSize)
    .offset((page - 1) * input.pageSize);

  return { rows, rowCount, page, pageSize: input.pageSize };
}

type UpdateTermData = z.infer<typeof updateTermSchema>;

export async function updateGlossaryTermAtomic(userId: string, data: UpdateTermData) {
  return db.transaction(async (tx) => {
    const [term] = await tx
      .select({
        id: glossaryTerms.id,
        novelId: glossaryTerms.novelId,
        target: glossaryTerms.target,
      })
      .from(glossaryTerms)
      .innerJoin(novels, eq(glossaryTerms.novelId, novels.id))
      .where(and(eq(glossaryTerms.id, data.termId), eq(novels.userId, userId)))
      .limit(1)
      .for("update");

    if (!term) throw new SafeServerError("Glossary term not found or unauthorized");

    const updateData: Partial<typeof glossaryTerms.$inferInsert> = { updatedAt: new Date() };
    if (data.source !== undefined) updateData.source = data.source.trim();
    if (data.target !== undefined) updateData.target = data.target.trim();
    if (data.category !== undefined) updateData.category = data.category;
    if (data.note !== undefined) updateData.note = data.note?.trim() || null;
    if (data.status !== undefined) updateData.status = data.status;

    if (data.source !== undefined) {
      const [existing] = await tx
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
        throw new SafeServerError(`Term with source "${data.source.trim()}" already exists`);
      }
    }

    if (data.applyToChapters && data.target !== undefined) {
      const oldTarget = term.target;
      const newTarget = data.target.trim();
      if (newTarget !== oldTarget) {
        await tx
          .update(chapters)
          .set({
            translatedContent: sql`replace(${chapters.translatedContent}, ${oldTarget}, ${newTarget})`,
            editedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(chapters.novelId, term.novelId),
              sql`strpos(${chapters.translatedContent}, ${oldTarget}) > 0`,
            ),
          );
      }
    }

    await tx.update(glossaryTerms).set(updateData).where(eq(glossaryTerms.id, data.termId));
    return { success: true as const };
  });
}

export async function deleteAllGlossaryTermsForUser(
  userId: string,
  novelId: string,
): Promise<{ deleted: number }> {
  return db.transaction(async (tx) => {
    const [novel] = await tx
      .select({ id: novels.id })
      .from(novels)
      .where(and(eq(novels.id, novelId), eq(novels.userId, userId)))
      .limit(1)
      .for("update");

    if (!novel) throw new SafeServerError("Novel not found or unauthorized");

    const deleted = await tx
      .delete(glossaryTerms)
      .where(eq(glossaryTerms.novelId, novelId))
      .returning({ id: glossaryTerms.id });
    return { deleted: deleted.length };
  });
}

export async function rejectAllPendingGlossaryTermsForUser(
  userId: string,
  novelId: string,
): Promise<{ rejected: number }> {
  return db.transaction(async (tx) => {
    const [novel] = await tx
      .select({ id: novels.id })
      .from(novels)
      .where(and(eq(novels.id, novelId), eq(novels.userId, userId)))
      .limit(1)
      .for("update");

    if (!novel) throw new SafeServerError("Novel not found or unauthorized");

    const rejected = await tx
      .update(glossaryTerms)
      .set({ status: "rejected", updatedAt: new Date() })
      .where(and(eq(glossaryTerms.novelId, novelId), eq(glossaryTerms.status, "pending")))
      .returning({ id: glossaryTerms.id });
    return { rejected: rejected.length };
  });
}
