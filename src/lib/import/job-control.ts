import "@tanstack/react-start/server-only";

import { eq, and, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { cancelEpubImportJob } from "@/lib/epub/job-store";
import { importJobs, novels } from "@/lib/db/schema";
import { inngest } from "@/lib/inngest/client";
import { SafeServerError } from "@/lib/server-fn-error";

export async function cancelActiveImportJobsForNovel(novelId: string): Promise<void> {
  const active = await db
    .select({ id: importJobs.id, kind: importJobs.kind })
    .from(importJobs)
    .where(
      and(eq(importJobs.novelId, novelId), sql`${importJobs.status} IN ('pending', 'running')`),
    );

  await Promise.all(
    active.map(async (job) => {
      let cancelled = false;
      if (job.kind === "epub") {
        cancelled = await cancelEpubImportJob(job.id);
      } else {
        const updated = await db
          .update(importJobs)
          .set({ status: "cancelled", updatedAt: new Date() })
          .where(
            and(eq(importJobs.id, job.id), sql`${importJobs.status} IN ('pending', 'running')`),
          )
          .returning({ id: importJobs.id });
        cancelled = updated.length > 0;
      }

      if (!cancelled) return;
      const eventName = job.kind === "epub" ? "epub/import.cancelled" : "scrape/import.cancelled";
      await inngest.send({ name: eventName, data: { jobId: job.id } }).catch(() => {});
    }),
  );
}

export async function cancelImportJobById(jobId: string, userId: string): Promise<void> {
  const [row] = await db
    .select({ id: importJobs.id, kind: importJobs.kind })
    .from(importJobs)
    .innerJoin(novels, eq(importJobs.novelId, novels.id))
    .where(and(eq(importJobs.id, jobId), eq(novels.userId, userId)))
    .limit(1);

  if (!row) {
    throw new SafeServerError("Import job not found or unauthorized");
  }

  let cancelled = false;
  if (row.kind === "epub") {
    cancelled = await cancelEpubImportJob(row.id);
  } else {
    const updated = await db
      .update(importJobs)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(and(eq(importJobs.id, row.id), sql`${importJobs.status} IN ('pending', 'running')`))
      .returning({ id: importJobs.id });
    cancelled = updated.length > 0;
  }

  if (!cancelled) return;
  try {
    const eventName = row.kind === "epub" ? "epub/import.cancelled" : "scrape/import.cancelled";
    await inngest.send({ name: eventName, data: { jobId: row.id } });
  } catch {
    // Inngest unreachable — the status check in each worker step still stops the job.
  }
}
