import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { importJobs, novels } from "@/lib/db/schema";
// Import status is polled through owner-scoped reads, so they use
// `ensureSessionForRead` and keep working while an operator views the account.
import { ensureSession, ensureSessionForRead } from "@/lib/auth/functions";
import { withSafeHandler } from "@/lib/server-fn-error";
import { cancelImportJobForUser } from "@/lib/import/commands";

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
      const session = await ensureSessionForRead();

      const [row] = await db
        .select(importJobStatusSelect)
        .from(importJobs)
        .innerJoin(novels, eq(importJobs.novelId, novels.id))
        .where(and(eq(importJobs.id, data.jobId), eq(novels.userId, session.user.id)))
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
  .validator(z.object({ novelId: z.string().min(1) }))
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSessionForRead();

      const [row] = await db
        .select(importJobStatusSelect)
        .from(importJobs)
        .innerJoin(novels, eq(importJobs.novelId, novels.id))
        .where(
          and(
            eq(importJobs.novelId, data.novelId),
            eq(novels.userId, session.user.id),
            sql`${importJobs.kind} = 'epub'`,
          ),
        )
        .orderBy(desc(importJobs.createdAt), desc(importJobs.id))
        .limit(1);

      return row ?? null;
    }),
  );
