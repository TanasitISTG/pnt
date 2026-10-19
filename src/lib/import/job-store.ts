import "@tanstack/react-start/server-only";

import { eq, and, desc, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { chapters, importJobs } from "@/lib/db/schema";

// DB boundary for import Inngest steps — tests mock this module instead of
// drizzle's fluent chains.

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
    .orderBy(desc(chapters.number))
    .limit(1);

  if (!highest) return 0;
  const parsed = parseFloat(highest.number);
  return Number.isNaN(parsed) ? 0 : parsed;
}
