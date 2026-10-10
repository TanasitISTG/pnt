import "@tanstack/react-start/server-only";

import { and, asc, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { lockNovelForMutation } from "@/lib/db/novel-lock";
import { chapters, glossaryTerms, novels, translationJobs } from "@/lib/db/schema";
import { mapWithConcurrency } from "@/lib/async";
import { dispatchWorkflowOutboxEventBestEffort } from "@/lib/inngest/outbox";
import { cancelActiveTranslationJobsInTransaction } from "@/lib/translation/workflow/cancel";
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
export async function getGlossaryStatsForOwnedNovel(novelId: string) {
  const [row] = await db
    .select({
      total: count(glossaryTerms.id),
      approved: sql<number>`count(case when ${glossaryTerms.status} = 'approved' then 1 end)::int`,
      pending: sql<number>`count(case when ${glossaryTerms.status} = 'pending' then 1 end)::int`,
      rejected: sql<number>`count(case when ${glossaryTerms.status} = 'rejected' then 1 end)::int`,
    })
    .from(glossaryTerms)
    .where(eq(glossaryTerms.novelId, novelId));

  return {
    total: row?.total ?? 0,
    approved: row?.approved ?? 0,
    pending: row?.pending ?? 0,
    rejected: row?.rejected ?? 0,
  };
}

export async function getGlossaryStatsForUser(userId: string, novelId: string) {
  const [novel] = await db
    .select({ id: novels.id })
    .from(novels)
    .where(and(eq(novels.id, novelId), eq(novels.userId, userId)))
    .limit(1);
  if (!novel) throw new SafeServerError("Novel not found or unauthorized");
  return getGlossaryStatsForOwnedNovel(novelId);
}

type UpdateTermData = z.infer<typeof updateTermSchema>;

export async function updateGlossaryTermAtomic(
  userId: string,
  rawData: UpdateTermData,
  dispatch: (outboxId: string) => Promise<void> = dispatchWorkflowOutboxEventBestEffort,
) {
  const data = updateTermSchema.parse(rawData);
  const outboxIds = await db.transaction(async (tx) => {
    const [parent] = await tx
      .select({ novelId: glossaryTerms.novelId })
      .from(glossaryTerms)
      .where(eq(glossaryTerms.id, data.termId))
      .limit(1);
    if (!parent || !(await lockNovelForMutation(tx, parent.novelId, userId))) {
      throw new SafeServerError("Glossary term not found or unauthorized");
    }

    const [term] = await tx
      .select({
        id: glossaryTerms.id,
        novelId: glossaryTerms.novelId,
        target: glossaryTerms.target,
      })
      .from(glossaryTerms)
      .where(and(eq(glossaryTerms.id, data.termId), eq(glossaryTerms.novelId, parent.novelId)))
      .limit(1)
      .for("update", { of: glossaryTerms });

    if (!term) throw new SafeServerError("Glossary term not found or unauthorized");

    const now = new Date();
    const updateData: Partial<typeof glossaryTerms.$inferInsert> = { updatedAt: now };
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

    let propagationOutboxIds: string[] = [];
    const oldTarget = term.target;
    const newTarget = data.target?.trim();
    if (
      data.applyToChapters &&
      newTarget &&
      newTarget !== oldTarget &&
      oldTarget.trim().length > 0
    ) {
      const affectedChapters = await tx
        .select({
          id: chapters.id,
          activeTranslationJobId: chapters.activeTranslationJobId,
        })
        .from(chapters)
        .where(
          and(
            eq(chapters.novelId, term.novelId),
            sql`strpos(${chapters.translatedContent}, ${oldTarget}) > 0`,
          ),
        )
        .orderBy(asc(chapters.id))
        .for("update");
      const chapterIds = affectedChapters.map((chapter) => chapter.id);
      const activeJobIds = [
        ...new Set(
          affectedChapters.flatMap((chapter) =>
            chapter.activeTranslationJobId ? [chapter.activeTranslationJobId] : [],
          ),
        ),
      ];
      const activeJobs =
        activeJobIds.length === 0
          ? []
          : await tx
              .select({
                id: translationJobs.id,
                generation: translationJobs.generation,
                logsJson: translationJobs.logsJson,
              })
              .from(translationJobs)
              .innerJoin(
                chapters,
                and(
                  eq(translationJobs.chapterId, chapters.id),
                  eq(chapters.activeTranslationJobId, translationJobs.id),
                ),
              )
              .where(
                and(
                  inArray(translationJobs.id, activeJobIds),
                  inArray(chapters.id, chapterIds),
                  eq(chapters.novelId, term.novelId),
                ),
              )
              .for("update", { of: translationJobs });
      const cancellation = await cancelActiveTranslationJobsInTransaction(
        tx,
        activeJobs.map((job) => ({
          jobId: job.id,
          generation: job.generation,
          logsJson: job.logsJson,
          message: "Translation cancelled because glossary terms were propagated.",
        })),
        now,
      );
      propagationOutboxIds = cancellation.outboxIds;

      if (chapterIds.length > 0) {
        await tx
          .update(chapters)
          .set({
            translatedContent: sql`replace(${chapters.translatedContent}, ${oldTarget}, ${newTarget})`,
            status: "translated",
            summary: null,
            activeTranslationJobId: null,
            translatedAt: now,
            editedAt: now,
            updatedAt: now,
          })
          .where(inArray(chapters.id, chapterIds));
        await tx
          .update(novels)
          .set({ storySummary: null, updatedAt: now })
          .where(eq(novels.id, term.novelId));
      }
    }

    await tx.update(glossaryTerms).set(updateData).where(eq(glossaryTerms.id, data.termId));
    return propagationOutboxIds;
  });

  await mapWithConcurrency(outboxIds, 2, dispatch);
  return { success: true as const };
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
