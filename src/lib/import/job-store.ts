import "@tanstack/react-start/server-only";

import { eq, and, desc, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { chapters, importJobs } from "@/lib/db/schema";
import { nanoid } from "@/lib/utils";

// DB boundary for import Inngest steps (both scrape and epub workers)
// — tests mock this module instead of drizzle's fluent chains.

export async function loadImportJob(jobId: string) {
  const [job] = await db.select().from(importJobs).where(eq(importJobs.id, jobId)).limit(1);
  return job ?? null;
}

export async function markImportJobRunning(jobId: string): Promise<boolean> {
  const updated = await db
    .update(importJobs)
    .set({ status: "running", updatedAt: new Date() })
    .where(and(eq(importJobs.id, jobId), eq(importJobs.status, "pending")))
    .returning({ id: importJobs.id });
  return updated.length > 0;
}

export type ScrapeImportOutcome =
  | {
      kind: "added";
      number: string;
      title: string;
      content: string;
    }
  | { kind: "skipped" }
  | { kind: "failed"; error: string };

export async function commitScrapeImportChapter(
  jobId: string,
  expectedNumber: number,
  outcome: ScrapeImportOutcome,
): Promise<{ stop: boolean; created: boolean; replayed?: boolean }> {
  return db.transaction(async (tx) => {
    const [job] = await tx.select().from(importJobs).where(eq(importJobs.id, jobId)).for("update");

    if (!job || job.status !== "running") {
      return { stop: true, created: false };
    }
    if (job.nextNumber > expectedNumber) {
      return { stop: false, created: false, replayed: true };
    }
    if (job.nextNumber < expectedNumber) {
      throw new Error(
        `Import cursor out of order: expected ${job.nextNumber}, received ${expectedNumber}`,
      );
    }

    let action: "added" | "skipped" | "failed" = outcome.kind;
    if (outcome.kind === "added") {
      const inserted = await tx
        .insert(chapters)
        .values({
          id: nanoid(),
          novelId: job.novelId,
          number: outcome.number,
          title: outcome.title,
          rawContent: outcome.content,
          rawCharCount: outcome.content.length,
          status: "raw",
        })
        .onConflictDoNothing({ target: [chapters.novelId, chapters.number] })
        .returning({ id: chapters.id });
      if (inserted.length === 0) action = "skipped";
    }

    const now = new Date();
    const cursorWhere = and(
      eq(importJobs.id, jobId),
      eq(importJobs.status, "running"),
      eq(importJobs.nextNumber, expectedNumber),
    );
    if (action === "added") {
      await tx
        .update(importJobs)
        .set({
          added: sql`${importJobs.added} + 1`,
          nextNumber: expectedNumber + 1,
          updatedAt: now,
        })
        .where(cursorWhere);
    } else if (action === "skipped") {
      await tx
        .update(importJobs)
        .set({
          skipped: sql`${importJobs.skipped} + 1`,
          nextNumber: expectedNumber + 1,
          updatedAt: now,
        })
        .where(cursorWhere);
    } else {
      await tx
        .update(importJobs)
        .set({
          failed: sql`${importJobs.failed} + 1`,
          error: outcome.kind === "failed" ? outcome.error.slice(0, 2000) : null,
          nextNumber: expectedNumber + 1,
          updatedAt: now,
        })
        .where(cursorWhere);
    }

    const [updated] = await tx
      .select({ nextNumber: importJobs.nextNumber })
      .from(importJobs)
      .where(eq(importJobs.id, jobId))
      .limit(1);
    if (!updated || updated.nextNumber !== expectedNumber + 1) {
      throw new Error("Import cursor changed while committing chapter");
    }

    return { stop: false, created: action === "added" };
  });
}

export async function markImportJobDone(jobId: string): Promise<boolean> {
  const updated = await db
    .update(importJobs)
    .set({ status: "done", updatedAt: new Date() })
    .where(
      and(
        eq(importJobs.id, jobId),
        eq(importJobs.status, "running"),
        sql`${importJobs.nextNumber} > ${importJobs.toNumber}`,
      ),
    )
    .returning({ id: importJobs.id });
  return updated.length > 0;
}

export async function markImportJobError(jobId: string, message: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [job] = await tx
      .select({ status: importJobs.status })
      .from(importJobs)
      .where(eq(importJobs.id, jobId))
      .for("update");

    if (!job || (job.status !== "pending" && job.status !== "running")) return;

    await tx
      .update(importJobs)
      .set({ status: "error", error: message, updatedAt: new Date() })
      .where(and(eq(importJobs.id, jobId), sql`${importJobs.status} IN ('pending', 'running')`));
  });
}

export async function getMaxChapterNumber(novelId: string): Promise<number> {
  const [highest] = await db
    .select({ number: chapters.number })
    .from(chapters)
    .where(eq(chapters.novelId, novelId))
    .orderBy(desc(sql`COALESCE(${chapters.number}::numeric, 0)`))
    .limit(1);

  if (!highest) return 0;
  const parsed = parseFloat(highest.number);
  return Number.isNaN(parsed) ? 0 : parsed;
}
