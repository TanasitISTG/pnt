import "@tanstack/react-start/server-only";

import { eq, and } from "drizzle-orm";

import { db } from "@/lib/db";
import { chapters, importJobs } from "@/lib/db/schema";
import { nanoid } from "@/lib/utils";
import {
  findSource,
  chapterUrlFor,
  twkanTocUrlFromReader,
  parseTwkanToc,
  biqugeTocUrlFromReader,
  parseBiqugeToc,
} from "@/lib/scrape";
import { fetchAndParse, fetchHtml } from "@/lib/scrape.server";
import { log } from "@/lib/log";

// Step logic for the "import-chapters" Inngest function. One step per chapter:
// fetch/parse failures count as `failed` and the run continues; DB errors
// propagate so Inngest retries the step instead of failing every chapter.

export async function initImportJob(jobId: string) {
  log("info", "Scrape worker step init", { jobId });
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

  const source = findSource(job.baseUrl);
  let chapterUrls: Record<number, string> | undefined;

  if (source.name === "twkan") {
    const tocUrl = twkanTocUrlFromReader(job.baseUrl);
    const tocHtml = await fetchHtml(tocUrl);
    chapterUrls = parseTwkanToc(tocHtml, tocUrl);
  } else if (source.name === "biquge") {
    const tocUrl = biqugeTocUrlFromReader(job.baseUrl);
    const tocHtml = await fetchHtml(tocUrl);
    chapterUrls = parseBiqugeToc(tocHtml, tocUrl);
  }

  return { skip: false as const, to: job.toNumber, next: job.nextNumber, chapterUrls };
}

export async function importOneChapter(
  jobId: string,
  n: number,
  chapterUrls?: Record<number, string>,
) {
  log("info", "Scrape worker step importOneChapter", { jobId, chapterNumber: n });
  const [job] = await db.select().from(importJobs).where(eq(importJobs.id, jobId)).limit(1);
  if (!job || job.status !== "running") return { stop: true as const };

  const source = findSource(job.baseUrl);

  // ponytail: fixed polite delay; twkan uses 1500ms to respect rate limit, others use 400ms.
  const delayMs = source.name === "twkan" ? 1500 : 400;
  await new Promise((r) => setTimeout(r, delayMs));

  const bump = (patch: Partial<typeof importJobs.$inferInsert>) =>
    db
      .update(importJobs)
      .set({ ...patch, nextNumber: n + 1, updatedAt: new Date() })
      .where(eq(importJobs.id, jobId));

  let targetUrl: string;
  if (source.name === "twkan" || source.name === "biquge") {
    const foundUrl = chapterUrls ? chapterUrls[n] : undefined;
    if (!foundUrl) {
      log("warn", "Scrape worker chapter import failed: missing URL in TOC", {
        jobId,
        chapterNumber: n,
      });
      await bump({
        failed: job.failed + 1,
        error: `Chapter ${n} URL missing in TOC`,
      });
      return { stop: false as const, created: false };
    }
    targetUrl = foundUrl;
  } else {
    targetUrl = chapterUrlFor(job.baseUrl, n);
  }

  let scraped;
  try {
    scraped = await fetchAndParse(targetUrl);
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    log("warn", "Scrape worker chapter import failed", {
      jobId,
      chapterNumber: n,
      error: errorMsg,
    });
    await bump({
      failed: job.failed + 1,
      error: errorMsg,
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
  log("info", "Scrape worker step finish", { jobId });
  await db
    .update(importJobs)
    .set({ status: "done", updatedAt: new Date() })
    .where(and(eq(importJobs.id, jobId), eq(importJobs.status, "running")));
}

export async function failImportJob(jobId: string, message: string) {
  log("error", "Scrape worker step fail", { jobId, error: message });
  await db
    .update(importJobs)
    .set({ status: "error", error: message, updatedAt: new Date() })
    .where(eq(importJobs.id, jobId))
    .catch(() => {});
}
