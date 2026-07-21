import { createServerFn } from "@tanstack/react-start";
import { eq, and, sql, desc } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { novels, chapters, importJobs } from "@/lib/db/schema";
import { ensureSession } from "@/lib/auth.functions";
import { nanoid } from "@/lib/utils";
import { inngest } from "@/lib/inngest/client";
import { findSource, parseChapter, type ScrapedChapter } from "@/lib/scrape";

const FETCH_TIMEOUT_MS = 10_000;
const MAX_HTML_CHARS = 2_000_000;

export async function fetchAndParse(url: string): Promise<ScrapedChapter> {
  findSource(url); // host whitelist before any network I/O (SSRF guard)

  const res = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      Accept: "text/html",
    },
  });
  if (!res.ok) throw new Error(`Source site returned HTTP ${res.status}`);

  const html = await res.text();
  if (html.length > MAX_HTML_CHARS) throw new Error("Page too large");

  return parseChapter(html, url);
}

export const scrapeChapter = createServerFn({ method: "POST" })
  .validator(z.object({ url: z.string().min(1) }))
  .handler(async ({ data }) => {
    await ensureSession();
    return fetchAndParse(data.url);
  });

export const importChapter = createServerFn({ method: "POST" })
  .validator(z.object({ novelId: z.string().min(1), url: z.string().min(1) }))
  .handler(async ({ data }) => {
    const session = await ensureSession();

    const [novel] = await db
      .select({ id: novels.id })
      .from(novels)
      .where(and(eq(novels.id, data.novelId), eq(novels.userId, session.user.id)))
      .limit(1);
    if (!novel) throw new Error("Novel not found or unauthorized");

    const scraped = await fetchAndParse(data.url);

    const [existing] = await db
      .select({ id: chapters.id })
      .from(chapters)
      .where(
        and(eq(chapters.novelId, data.novelId), eq(chapters.number, scraped.number.toString())),
      )
      .limit(1);
    if (existing) return { created: false as const, ...scraped };

    const id = nanoid();
    await db.insert(chapters).values({
      id,
      novelId: data.novelId,
      number: scraped.number.toString(),
      title: scraped.title,
      rawContent: scraped.content,
      rawCharCount: scraped.content.length,
      status: "raw",
    });

    return { created: true as const, id, ...scraped };
  });

const startImportJobSchema = z.object({
  novelId: z.string().min(1),
  baseUrl: z.string().min(1),
  from: z.number().int().min(1),
  to: z.number().int().min(1),
});

// Enqueues a durable bulk import (executed by Inngest, see scrape.worker.ts) —
// the browser only creates the job row and sends the event, so a refresh can
// never interrupt or duplicate the work. One active job per novel.
export const startImportJob = createServerFn({ method: "POST" })
  .validator(startImportJobSchema)
  .handler(async ({ data }) => {
    const session = await ensureSession();

    if (data.from > data.to || data.to - data.from > 500) {
      throw new Error("Invalid range (from ≤ to, max 500 chapters)");
    }
    findSource(data.baseUrl); // validates host before the URL is stored

    const [novel] = await db
      .select({ id: novels.id })
      .from(novels)
      .where(and(eq(novels.id, data.novelId), eq(novels.userId, session.user.id)))
      .limit(1);
    if (!novel) throw new Error("Novel not found or unauthorized");

    const active = await db
      .select({ id: importJobs.id })
      .from(importJobs)
      .where(
        and(
          eq(importJobs.novelId, data.novelId),
          sql`${importJobs.status} IN ('pending', 'running')`,
        ),
      );
    for (const j of active) {
      await db
        .update(importJobs)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(importJobs.id, j.id));
      await inngest
        .send({ name: "scrape/import.cancelled", data: { jobId: j.id } })
        .catch(() => {});
    }

    const jobId = nanoid();
    await db.insert(importJobs).values({
      id: jobId,
      novelId: data.novelId,
      baseUrl: data.baseUrl,
      fromNumber: data.from,
      toNumber: data.to,
      nextNumber: data.from,
    });

    await inngest.send({ name: "scrape/import.requested", data: { jobId, runKey: nanoid() } });

    return { jobId };
  });

export const cancelImportJob = createServerFn({ method: "POST" })
  .validator(z.object({ jobId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const session = await ensureSession();

    const [row] = await db
      .select({ id: importJobs.id })
      .from(importJobs)
      .innerJoin(novels, eq(importJobs.novelId, novels.id))
      .where(and(eq(importJobs.id, data.jobId), eq(novels.userId, session.user.id)))
      .limit(1);
    if (!row) throw new Error("Import job not found or unauthorized");

    await db
      .update(importJobs)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(importJobs.id, row.id));

    // Best-effort: DB status is the real cancel — worker steps re-check it.
    try {
      await inngest.send({ name: "scrape/import.cancelled", data: { jobId: row.id } });
    } catch {
      // Inngest unreachable — the status check in each step still stops the job.
    }

    return { success: true };
  });

const importJobStatusSelect = {
  id: importJobs.id,
  status: importJobs.status,
  fromNumber: importJobs.fromNumber,
  toNumber: importJobs.toNumber,
  nextNumber: importJobs.nextNumber,
  added: importJobs.added,
  skipped: importJobs.skipped,
  failed: importJobs.failed,
  error: importJobs.error,
} as const;

export const getImportJobStatus = createServerFn({ method: "GET" })
  .validator(z.object({ jobId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const session = await ensureSession();

    const [row] = await db
      .select(importJobStatusSelect)
      .from(importJobs)
      .innerJoin(novels, eq(importJobs.novelId, novels.id))
      .where(and(eq(importJobs.id, data.jobId), eq(novels.userId, session.user.id)))
      .limit(1);

    return row || null;
  });

// Latest active import for a novel — lets the UI re-attach after a refresh.
export const getActiveImportJob = createServerFn({ method: "GET" })
  .validator(z.object({ novelId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const session = await ensureSession();

    const [row] = await db
      .select(importJobStatusSelect)
      .from(importJobs)
      .innerJoin(novels, eq(importJobs.novelId, novels.id))
      .where(
        and(
          eq(importJobs.novelId, data.novelId),
          eq(novels.userId, session.user.id),
          sql`${importJobs.status} IN ('pending', 'running')`,
        ),
      )
      .orderBy(desc(importJobs.createdAt))
      .limit(1);

    return row || null;
  });
