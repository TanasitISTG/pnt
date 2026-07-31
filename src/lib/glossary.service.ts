import "@tanstack/react-start/server-only";

import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { chapters, glossaryTerms, novels } from "@/lib/db/schema";
import { updateTermSchema } from "@/lib/glossary.schemas";
import { SafeServerError } from "@/lib/server-fn-error";

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
