import { createServerFn } from "@tanstack/react-start";
import { eq, and, sql, desc } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { novels, chapters, importJobs } from "@/lib/db/schema";
import { ensureSession } from "@/lib/auth/functions";
import { nanoid } from "@/lib/utils";
import { inngest } from "@/lib/inngest/client";
import { findSource } from "@/lib/scrape";
import { fetchAndParse } from "@/lib/scrape/server";
import { withSafeHandler, SafeServerError } from "@/lib/server-fn-error";
import { log } from "@/lib/log";
import { cancelActiveImportJobsForNovel, cancelImportJobById } from "@/lib/import/job-control";

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

const startImportJobSchema = z.object({
  novelId: z.string().min(1),
  baseUrl: z.string().min(1),
  from: z.number().int().min(1),
  to: z.number().int().min(1),
  provider: providerEnum,
});

export const startImportJob = createServerFn({ method: "POST" })
  .validator(startImportJobSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      // Cheap input validation first — these errors don't need a session.
      if (data.from > data.to || data.to - data.from > 500) {
        throw new SafeServerError("Invalid range (from ≤ to, max 500 chapters)");
      }
      findSource(data.baseUrl); // validates host before the URL is stored

      const session = await ensureSession();

      const [novel] = await db
        .select({ id: novels.id })
        .from(novels)
        .where(and(eq(novels.id, data.novelId), eq(novels.userId, session.user.id)))
        .limit(1);
      if (!novel) throw new SafeServerError("Novel not found or unauthorized");

      await cancelActiveImportJobsForNovel(data.novelId);

      const jobId = nanoid();
      await db.insert(importJobs).values({
        id: jobId,
        novelId: data.novelId,
        kind: "scrape",
        baseUrl: data.baseUrl,
        fromNumber: data.from,
        toNumber: data.to,
        nextNumber: data.from,
        scrapeProvider: data.provider,
      });

      try {
        await inngest.send({ name: "scrape/import.requested", data: { jobId, runKey: nanoid() } });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        let code: string | undefined;
        if (err && typeof err === "object") {
          if ("code" in err && typeof err.code === "string") {
            code = err.code;
          } else if (
            "cause" in err &&
            err.cause &&
            typeof err.cause === "object" &&
            "code" in err.cause &&
            typeof err.cause.code === "string"
          ) {
            code = err.cause.code;
          }
        }
        log("error", "Failed to send Inngest event in startImportJob", {
          jobId,
          error: msg,
        });
        if (msg.includes("fetch failed") || code === "ECONNREFUSED") {
          throw new SafeServerError(
            "Inngest dev server is not running. Please run 'bun run inngest' in a separate terminal alongside 'bun dev'.",
          );
        }
        throw new SafeServerError(`Failed to enqueue import job: ${msg}`);
      }

      return { jobId };
    }),
  );

export const cancelImportJob = createServerFn({ method: "POST" })
  .validator(z.object({ jobId: z.string().min(1) }))
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      await cancelImportJobById(data.jobId, session.user.id);
      return { success: true };
    }),
  );

const importJobStatusSelect = {
  id: importJobs.id,
  kind: importJobs.kind,
  status: importJobs.status,
  sourceFileName: importJobs.sourceFileName,
  fromNumber: importJobs.fromNumber,
  toNumber: importJobs.toNumber,
  nextNumber: importJobs.nextNumber,
  scrapeProvider: importJobs.scrapeProvider,
  added: importJobs.added,
  skipped: importJobs.skipped,
  failed: importJobs.failed,
  error: importJobs.error,
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
