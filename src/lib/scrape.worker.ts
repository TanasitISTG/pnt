import "@tanstack/react-start/server-only";

import { eq, and } from "drizzle-orm";

import { db } from "@/lib/db";
import { chapters, importJobs } from "@/lib/db/schema";
import { nanoid } from "@/lib/utils";
import { chapterUrlFor } from "@/lib/scrape";
import { fetchAndParse } from "@/lib/scrape.functions";

// Step logic for the "import-chapters" Inngest function. One step per chapter:
// fetch/parse failures count as `failed` and the run continues; DB errors
// propagate so Inngest retries the step instead of failing every chapter.

export async function initImportJob(jobId: string) {
  const [job] = await db.select().from(importJobs).where(eq(importJobs.id, jobId)).limit(1);
  if (!job || job.status === "cancelled" || job.status === "done" || job.status === "error") {
    return { skip: true as const };
  }
  if (job.status === "pending") {
    await db
      .update(importJobs)
      .set({ status: "running", updatedAt: new Date() })
      .where(eq(importJobs.id, jobId));
  }
  return { skip: false as const, to: job.toNumber, next: job.nextNumber };
}

export async function importOneChapter(jobId: string, n: number) {
  const [job] = await db.select().from(importJobs).where(eq(importJobs.id, jobId)).limit(1);
  if (!job || job.status !== "running") return { stop: true as const };

  // ponytail: fixed polite delay; escalate to host-adaptive backoff if quanben rate-limits.
  await new Promise((r) => setTimeout(r, 400));

  const bump = (patch: Partial<typeof importJobs.$inferInsert>) =>
    db
      .update(importJobs)
      .set({ ...patch, nextNumber: n + 1, updatedAt: new Date() })
      .where(eq(importJobs.id, jobId));

  let scraped;
  try {
    scraped = await fetchAndParse(chapterUrlFor(job.baseUrl, n));
  } catch (e) {
    await bump({
      failed: job.failed + 1,
      error: e instanceof Error ? e.message : String(e),
    });
    return { stop: false as const, created: false };
  }

  const [existing] = await db
    .select({ id: chapters.id })
    .from(chapters)
    .where(and(eq(chapters.novelId, job.novelId), eq(chapters.number, n.toString())))
    .limit(1);

  if (existing) {
    await bump({ skipped: job.skipped + 1 });
    return { stop: false as const, created: false };
  }

  await db.insert(chapters).values({
    id: nanoid(),
    novelId: job.novelId,
    number: n.toString(),
    title: scraped.title,
    rawContent: scraped.content,
    rawCharCount: scraped.content.length,
    status: "raw",
  });
  await bump({ added: job.added + 1 });
  return { stop: false as const, created: true };
}

export async function finishImportJob(jobId: string) {
  await db
    .update(importJobs)
    .set({ status: "done", updatedAt: new Date() })
    .where(and(eq(importJobs.id, jobId), eq(importJobs.status, "running")));
}

export async function failImportJob(jobId: string, message: string) {
  await db
    .update(importJobs)
    .set({ status: "error", error: message, updatedAt: new Date() })
    .where(eq(importJobs.id, jobId))
    .catch(() => {});
}
