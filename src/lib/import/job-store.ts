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

/** Advance the resume cursor and merge progress counters/errors. */
export async function bumpImportJob(
  jobId: string,
  nextNumber: number,
  patch: Partial<typeof importJobs.$inferInsert>,
) {
  await db
    .update(importJobs)
    .set({ ...patch, nextNumber, updatedAt: new Date() })
    .where(eq(importJobs.id, jobId));
}

export async function findChapterByNumber(novelId: string, number: string) {
  const [existing] = await db
    .select({ id: chapters.id })
    .from(chapters)
    .where(and(eq(chapters.novelId, novelId), eq(chapters.number, number)))
    .limit(1);
  return existing ?? null;
}

export async function insertRawChapter(values: {
  novelId: string;
  number: string;
  title: string;
  content: string;
}) {
  await db.insert(chapters).values({
    id: nanoid(),
    novelId: values.novelId,
    number: values.number,
    title: values.title,
    rawContent: values.content,
    rawCharCount: values.content.length,
    status: "raw",
  });
}

export async function markImportJobDone(jobId: string) {
  await db
    .update(importJobs)
    .set({ status: "done", updatedAt: new Date() })
    .where(and(eq(importJobs.id, jobId), eq(importJobs.status, "running")));
}

export async function markImportJobError(jobId: string, message: string) {
  await db
    .update(importJobs)
    .set({ status: "error", error: message, updatedAt: new Date() })
    .where(eq(importJobs.id, jobId))
    .catch(() => {});
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
