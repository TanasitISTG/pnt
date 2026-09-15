import { createServerFn } from "@tanstack/react-start";
import { eq, and, sql, desc } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { novels, chapters, importJobs } from "@/lib/db/schema";
import { ensureSession } from "@/lib/auth/functions";
import { nanoid } from "@/lib/utils";
import { findSource } from "@/lib/scrape";
import { fetchAndParse } from "@/lib/scrape/server";
import { withSafeHandler, SafeServerError } from "@/lib/server-fn-error";
import { cancelImportJobForUser, startScrapeImportForUser } from "@/lib/import/commands";
import { MAX_IMPORT_CHAPTER_NUMBER, MAX_IMPORT_RANGE_LENGTH } from "@/lib/import/range";

const providerEnum = z
  .enum(["auto", "direct", "zenrows", "scrapingbee", "firecrawl"])
  .default("auto");

export const scrapeChapter = createServerFn({ method: "POST" })
  .validator(z.object({ url: z.string().min(1), provider: providerEnum }))
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      await ensureSession();
      findSource(data.url);
      return fetchAndParse(data.url, data.provider);
    }),
  );

export const importChapter = createServerFn({ method: "POST" })
  .validator(
    z.object({
      novelId: z.string().min(1),
      url: z.string().min(1),
      provider: providerEnum,
    }),
  )
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      findSource(data.url);

      const [novel] = await db
        .select({ id: novels.id })
        .from(novels)
        .where(and(eq(novels.id, data.novelId), eq(novels.userId, session.user.id)))
        .limit(1);
      if (!novel) throw new SafeServerError("Novel not found or unauthorized");

      const scraped = await fetchAndParse(data.url, data.provider);

      const id = nanoid();
      const [inserted] = await db
        .insert(chapters)
        .values({
          id,
          novelId: data.novelId,
          number: scraped.number.toString(),
          title: scraped.title,
          rawContent: scraped.content,
          rawCharCount: scraped.content.length,
          status: "raw",
        })
        .onConflictDoNothing({ target: [chapters.novelId, chapters.number] })
        .returning({ id: chapters.id });

      if (!inserted) return { created: false as const, ...scraped };

      return { created: true as const, id: inserted.id, ...scraped };
    }),
  );

const importChapterNumberSchema = z.number().int().min(1).max(MAX_IMPORT_CHAPTER_NUMBER);

export const startImportJobSchema = z
  .object({
    novelId: z.string().min(1),
    baseUrl: z.string().min(1),
    from: importChapterNumberSchema,
    to: importChapterNumberSchema,
    provider: providerEnum,
  })
  .refine(({ from, to }) => from <= to && to - from + 1 <= MAX_IMPORT_RANGE_LENGTH, {
    path: ["to"],
    message: "Invalid range (from ≤ to, max 500 chapters)",
  });

export const startImportJob = createServerFn({ method: "POST" })
  .validator(startImportJobSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      return startScrapeImportForUser(session.user.id, data);
    }),
  );

export const cancelImportJob = createServerFn({ method: "POST" })
  .validator(z.object({ jobId: z.string().min(1) }))
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      await cancelImportJobForUser(session.user.id, data.jobId);
      return { success: true };
    }),
  );

const importJobStatusSelect = {
  id: importJobs.id,
  kind: importJobs.kind,
  status: importJobs.status,
  baseUrl: importJobs.baseUrl,
  novelId: novels.id,
  novelTitle: novels.title,
  sourceFileName: importJobs.sourceFileName,
  fromNumber: importJobs.fromNumber,
  toNumber: importJobs.toNumber,
  nextNumber: importJobs.nextNumber,
  scrapeProvider: importJobs.scrapeProvider,
  added: importJobs.added,
  skipped: importJobs.skipped,
  failed: importJobs.failed,
  error: importJobs.error,
  createdAt: importJobs.createdAt,
  updatedAt: importJobs.updatedAt,
};

export const getImportJobStatus = createServerFn({ method: "GET" })
  .validator(z.object({ jobId: z.string().min(1) }))
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();

      const [row] = await db
        .select(importJobStatusSelect)
        .from(importJobs)
        .innerJoin(novels, eq(importJobs.novelId, novels.id))
        .where(and(eq(importJobs.id, data.jobId), eq(novels.userId, session.user.id)))
        .limit(1);

      return row ?? null;
    }),
  );

export const getActiveImportJob = createServerFn({ method: "GET" })
  .validator(
    z.object({
      novelId: z.string().min(1),
      kind: z.enum(["scrape", "epub"]).default("scrape"),
    }),
  )
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();

      const [row] = await db
        .select(importJobStatusSelect)
        .from(importJobs)
        .innerJoin(novels, eq(importJobs.novelId, novels.id))
        .where(
          and(
            eq(importJobs.novelId, data.novelId),
            eq(novels.userId, session.user.id),
            eq(importJobs.kind, data.kind),
            sql`${importJobs.status} IN ('pending', 'running')`,
          ),
        )
        .orderBy(desc(importJobs.createdAt))
        .limit(1);

      return row ?? null;
    }),
  );

/**
 * Return the newest import row without filtering by status. EPUB recovery uses
 * this deliberately broad query so a newer completed job prevents an older
 * failed or cancelled job from being resurrected after refresh.
 */
export const getLatestImportJob = createServerFn({ method: "GET" })
  .validator(
    z.object({
      novelId: z.string().min(1),
      kind: z.enum(["scrape", "epub"]).default("scrape"),
    }),
  )
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();

      const [row] = await db
        .select(importJobStatusSelect)
        .from(importJobs)
        .innerJoin(novels, eq(importJobs.novelId, novels.id))
        .where(
          and(
            eq(importJobs.novelId, data.novelId),
            eq(novels.userId, session.user.id),
            eq(importJobs.kind, data.kind),
          ),
        )
        .orderBy(desc(importJobs.createdAt), desc(importJobs.id))
        .limit(1);

      return row ?? null;
    }),
  );
