import "@tanstack/react-start/server-only";

import { and, asc, desc, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  epubUploadChunks,
  epubUploads,
  importJobItems,
  importJobs,
  novels,
  workflowOutbox,
} from "@/lib/db/schema";
import { dispatchWorkflowOutboxEventBestEffort } from "@/lib/inngest/outbox";
import { SafeServerError } from "@/lib/server-fn-error";
import { findSource } from "@/lib/scrape";
import type { ScrapeProvider } from "@/lib/scrape/types";
import { nanoid } from "@/lib/utils";
import { MAX_IMPORT_CHAPTER_NUMBER, MAX_IMPORT_RANGE_LENGTH } from "@/lib/import/range";

function assertValidScrapeImportRange(from: number, to: number): void {
  if (
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    from < 1 ||
    to < 1 ||
    from > MAX_IMPORT_CHAPTER_NUMBER ||
    to > MAX_IMPORT_CHAPTER_NUMBER ||
    from > to ||
    to - from + 1 > MAX_IMPORT_RANGE_LENGTH
  ) {
    throw new SafeServerError("Invalid range (from ≤ to, max 500 chapters)");
  }
}

export type ImportTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type ImportOutboxDispatch = (outboxId: string) => Promise<void>;

const ACTIVE_IMPORT_STATUS = sql`${importJobs.status} IN ('pending', 'running')`;

function cancellationEventName(kind: "scrape" | "epub") {
  return kind === "epub" ? "epub/import.cancelled" : "scrape/import.cancelled";
}

async function dispatchAfterCommit(
  outboxIds: readonly string[],
  dispatch: ImportOutboxDispatch,
): Promise<void> {
  await Promise.all(
    outboxIds.map(async (outboxId) => {
      try {
        await dispatch(outboxId);
      } catch {
        // The committed outbox row is authoritative; the recovery cron retries it.
      }
    }),
  );
}

async function cleanupEpubResources(
  tx: ImportTransaction,
  jobId: string,
  uploadId: string | null,
): Promise<void> {
  await tx.delete(importJobItems).where(eq(importJobItems.jobId, jobId));
  if (!uploadId) return;
  await tx.delete(epubUploadChunks).where(eq(epubUploadChunks.uploadId, uploadId));
  await tx.delete(epubUploads).where(eq(epubUploads.id, uploadId));
}

async function cancelActiveImportsInTransaction(
  tx: ImportTransaction,
  novelId: string,
  now: Date,
): Promise<string[]> {
  const activeJobs = await tx
    .select({
      id: importJobs.id,
      kind: importJobs.kind,
      epubUploadId: importJobs.epubUploadId,
    })
    .from(importJobs)
    .where(and(eq(importJobs.novelId, novelId), ACTIVE_IMPORT_STATUS))
    .orderBy(asc(importJobs.createdAt), asc(importJobs.id))
    .for("update");

  const outboxIds: string[] = [];
  for (const job of activeJobs) {
    const updated = await tx
      .update(importJobs)
      .set({ status: "cancelled", updatedAt: now })
      .where(and(eq(importJobs.id, job.id), ACTIVE_IMPORT_STATUS))
      .returning({ id: importJobs.id });
    if (updated.length === 0) continue;

    if (job.kind === "epub") {
      await cleanupEpubResources(tx, job.id, job.epubUploadId);
    }

    const outboxId = nanoid();
    await tx.insert(workflowOutbox).values({
      id: outboxId,
      eventName: cancellationEventName(job.kind),
      payloadJson: JSON.stringify({ jobId: job.id }),
    });
    outboxIds.push(outboxId);
  }
  return outboxIds;
}

export async function startScrapeImportForUser(
  userId: string,
  input: {
    novelId: string;
    baseUrl: string;
    from: number;
    to: number;
    provider: ScrapeProvider;
  },
  dispatch: ImportOutboxDispatch = dispatchWorkflowOutboxEventBestEffort,
): Promise<{ jobId: string; outboxIds: string[] }> {
  assertValidScrapeImportRange(input.from, input.to);
  findSource(input.baseUrl);

  const result = await db.transaction(async (tx) => {
    const [novel] = await tx
      .select({ id: novels.id })
      .from(novels)
      .where(and(eq(novels.id, input.novelId), eq(novels.userId, userId)))
      .limit(1)
      .for("update");
    if (!novel) throw new SafeServerError("Novel not found or unauthorized");

    const now = new Date();
    const outboxIds = await cancelActiveImportsInTransaction(tx, input.novelId, now);
    const jobId = nanoid();
    const runKey = nanoid();

    await tx.insert(importJobs).values({
      id: jobId,
      novelId: input.novelId,
      kind: "scrape",
      baseUrl: input.baseUrl,
      fromNumber: input.from,
      toNumber: input.to,
      nextNumber: input.from,
      scrapeProvider: input.provider,
    });

    const requestOutboxId = nanoid();
    await tx.insert(workflowOutbox).values({
      id: requestOutboxId,
      eventName: "scrape/import.requested",
      payloadJson: JSON.stringify({ jobId, runKey }),
    });
    outboxIds.push(requestOutboxId);

    return { jobId, outboxIds };
  });

  await dispatchAfterCommit(result.outboxIds, dispatch);
  return result;
}

export async function completeEpubImportForUser(
  userId: string,
  uploadId: string,
  dispatch: ImportOutboxDispatch = dispatchWorkflowOutboxEventBestEffort,
): Promise<{ jobId: string; outboxIds: string[] }> {
  const result = await db.transaction(async (tx) => {
    const [upload] = await tx
      .select({
        id: epubUploads.id,
        novelId: epubUploads.novelId,
        fileName: epubUploads.fileName,
        fileSize: epubUploads.fileSize,
        chunkCount: epubUploads.chunkCount,
        receivedBytes: epubUploads.receivedBytes,
        status: epubUploads.status,
        expiresAt: epubUploads.expiresAt,
      })
      .from(epubUploads)
      .innerJoin(novels, eq(epubUploads.novelId, novels.id))
      .where(and(eq(epubUploads.id, uploadId), eq(novels.userId, userId)))
      .limit(1);

    if (!upload) throw new SafeServerError("Upload not found or unauthorized");

    const [novel] = await tx
      .select({ id: novels.id })
      .from(novels)
      .where(and(eq(novels.id, upload.novelId), eq(novels.userId, userId)))
      .limit(1)
      .for("update");
    if (!novel) throw new SafeServerError("Novel not found or unauthorized");

    const [lockedUpload] = await tx
      .select({
        id: epubUploads.id,
        novelId: epubUploads.novelId,
        fileName: epubUploads.fileName,
        fileSize: epubUploads.fileSize,
        chunkCount: epubUploads.chunkCount,
        receivedBytes: epubUploads.receivedBytes,
        status: epubUploads.status,
        expiresAt: epubUploads.expiresAt,
      })
      .from(epubUploads)
      .where(eq(epubUploads.id, uploadId))
      .limit(1)
      .for("update");
    if (!lockedUpload) throw new SafeServerError("Upload not found or unauthorized");

    if (lockedUpload.status !== "uploading") {
      const [existingJob] = await tx
        .select({ id: importJobs.id })
        .from(importJobs)
        .where(
          and(eq(importJobs.novelId, lockedUpload.novelId), eq(importJobs.epubUploadId, uploadId)),
        )
        .orderBy(desc(importJobs.createdAt))
        .limit(1);
      if (existingJob) return { jobId: existingJob.id, outboxIds: [] };
      throw new SafeServerError("Upload is no longer in uploading state");
    }
    if (lockedUpload.expiresAt < new Date()) {
      throw new SafeServerError("Upload session has expired");
    }

    const chunks = await tx
      .select({ chunkIndex: epubUploadChunks.chunkIndex })
      .from(epubUploadChunks)
      .where(eq(epubUploadChunks.uploadId, uploadId))
      .orderBy(asc(epubUploadChunks.chunkIndex));
    const complete =
      chunks.length === lockedUpload.chunkCount &&
      chunks.every((chunk, index) => chunk.chunkIndex === index) &&
      lockedUpload.receivedBytes === lockedUpload.fileSize;
    if (!complete) throw new SafeServerError("Upload is incomplete: missing chunks");

    const now = new Date();
    const outboxIds = await cancelActiveImportsInTransaction(tx, lockedUpload.novelId, now);
    const jobId = nanoid();
    const runKey = nanoid();

    await tx.insert(importJobs).values({
      id: jobId,
      novelId: lockedUpload.novelId,
      kind: "epub",
      baseUrl: `epub://${lockedUpload.id}`,
      sourceFileName: lockedUpload.fileName,
      epubUploadId: lockedUpload.id,
      fromNumber: 1,
      toNumber: 0,
      nextNumber: 1,
      scrapeProvider: "epub",
    });
    await tx
      .update(epubUploads)
      .set({ status: "queued", updatedAt: now })
      .where(eq(epubUploads.id, lockedUpload.id));

    const requestOutboxId = nanoid();
    await tx.insert(workflowOutbox).values({
      id: requestOutboxId,
      eventName: "epub/import.requested",
      payloadJson: JSON.stringify({ jobId, runKey }),
    });
    outboxIds.push(requestOutboxId);

    return { jobId, outboxIds };
  });

  await dispatchAfterCommit(result.outboxIds, dispatch);
  return result;
}

export async function cancelImportJobForUser(
  userId: string,
  jobId: string,
  dispatch: ImportOutboxDispatch = dispatchWorkflowOutboxEventBestEffort,
): Promise<{ cancelled: boolean; outboxIds: string[] }> {
  const result = await db.transaction(async (tx) => {
    const [candidate] = await tx
      .select({
        id: importJobs.id,
        novelId: importJobs.novelId,
        kind: importJobs.kind,
        epubUploadId: importJobs.epubUploadId,
      })
      .from(importJobs)
      .innerJoin(novels, eq(importJobs.novelId, novels.id))
      .where(and(eq(importJobs.id, jobId), eq(novels.userId, userId)))
      .limit(1);
    if (!candidate) throw new SafeServerError("Import job not found or unauthorized");

    const [novel] = await tx
      .select({ id: novels.id })
      .from(novels)
      .where(and(eq(novels.id, candidate.novelId), eq(novels.userId, userId)))
      .limit(1)
      .for("update");
    if (!novel) throw new SafeServerError("Import job not found or unauthorized");

    const [job] = await tx
      .select({
        id: importJobs.id,
        kind: importJobs.kind,
        epubUploadId: importJobs.epubUploadId,
        status: importJobs.status,
      })
      .from(importJobs)
      .where(eq(importJobs.id, candidate.id))
      .limit(1)
      .for("update");
    if (!job || (job.status !== "pending" && job.status !== "running")) {
      return { cancelled: false, outboxIds: [] };
    }

    const now = new Date();
    await tx
      .update(importJobs)
      .set({ status: "cancelled", updatedAt: now })
      .where(eq(importJobs.id, job.id));
    if (job.kind === "epub") await cleanupEpubResources(tx, job.id, job.epubUploadId);

    const outboxId = nanoid();
    await tx.insert(workflowOutbox).values({
      id: outboxId,
      eventName: cancellationEventName(job.kind),
      payloadJson: JSON.stringify({ jobId: job.id }),
    });
    return { cancelled: true, outboxIds: [outboxId] };
  });

  await dispatchAfterCommit(result.outboxIds, dispatch);
  return result;
}
