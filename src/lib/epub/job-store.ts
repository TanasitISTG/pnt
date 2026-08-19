import "@tanstack/react-start/server-only";

import { eq, and, asc, count, lt, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  chapters,
  importJobs,
  importJobItems,
  epubUploads,
  epubUploadChunks,
} from "@/lib/db/schema";
import { nanoid } from "@/lib/utils";

export async function loadEpubImportJob(jobId: string) {
  const [job] = await db.select().from(importJobs).where(eq(importJobs.id, jobId)).limit(1);
  return job ?? null;
}

export async function loadOrderedUploadChunks(uploadId: string) {
  return await db
    .select({
      chunkIndex: epubUploadChunks.chunkIndex,
      data: epubUploadChunks.data,
    })
    .from(epubUploadChunks)
    .where(eq(epubUploadChunks.uploadId, uploadId))
    .orderBy(asc(epubUploadChunks.chunkIndex));
}

export async function stageImportJobItems(
  jobId: string,
  uploadId: string,
  items: Array<{
    sequence: number;
    chapterNumber: string;
    title: string;
    rawContent: string;
    rawCharCount: number;
  }>,
): Promise<number> {
  return await db.transaction(async (tx) => {
    const [job] = await tx
      .select({ status: importJobs.status })
      .from(importJobs)
      .where(eq(importJobs.id, jobId))
      .for("update");
    if (!job || (job.status !== "pending" && job.status !== "running")) {
      return 0;
    }

    // Check if items are already staged (for retry idempotency)
    const [existingCount] = await tx
      .select({ count: count(importJobItems.id) })
      .from(importJobItems)
      .where(eq(importJobItems.jobId, jobId));
    const stagedCount = Number(existingCount?.count ?? 0);
    if (stagedCount > 0) return stagedCount;
    // Keep one transaction connection ordered; batches bound statement size.
    const BATCH_SIZE = 50;
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const batch = items.slice(i, i + BATCH_SIZE).map((item) => ({
        id: nanoid(),
        jobId,
        sequence: item.sequence,
        chapterNumber: item.chapterNumber,
        title: item.title,
        rawContent: item.rawContent,
        rawCharCount: item.rawCharCount,
        status: "pending" as const,
      }));
      await tx.insert(importJobItems).values(batch);
    }

    await tx
      .update(importJobs)
      .set({
        toNumber: items.length,
        nextNumber: 1,
        updatedAt: new Date(),
      })
      .where(eq(importJobs.id, jobId));

    await tx
      .update(epubUploads)
      .set({
        status: "staged",
        updatedAt: new Date(),
      })
      .where(eq(epubUploads.id, uploadId));

    // Delete raw chunks atomically after successful staging
    await tx.delete(epubUploadChunks).where(eq(epubUploadChunks.uploadId, uploadId));

    return items.length;
  });
}

export async function importOneStagedChapter(
  jobId: string,
  sequence: number,
): Promise<{ stop: boolean; action?: "added" | "skipped" }> {
  return await db.transaction(async (tx) => {
    // Lock job row to ensure it is still running
    const [job] = await tx
      .select({
        id: importJobs.id,
        novelId: importJobs.novelId,
        status: importJobs.status,
        added: importJobs.added,
        skipped: importJobs.skipped,
      })
      .from(importJobs)
      .where(eq(importJobs.id, jobId))
      .for("update");

    if (!job || job.status !== "running") {
      return { stop: true };
    }

    // Lock staged item row
    const [item] = await tx
      .select()
      .from(importJobItems)
      .where(and(eq(importJobItems.jobId, jobId), eq(importJobItems.sequence, sequence)))
      .for("update");

    if (!item) {
      return { stop: true };
    }

    if (item.status !== "pending") {
      // Already processed in earlier run
      return { stop: false, action: item.status === "imported" ? "added" : "skipped" };
    }

    // Attempt to insert raw chapter
    const inserted = await tx
      .insert(chapters)
      .values({
        id: nanoid(),
        novelId: job.novelId,
        number: item.chapterNumber,
        title: item.title,
        rawContent: item.rawContent,
        rawCharCount: item.rawCharCount,
        status: "raw",
      })
      .onConflictDoNothing({ target: [chapters.novelId, chapters.number] })
      .returning({ id: chapters.id });

    if (inserted.length > 0) {
      await tx
        .update(importJobItems)
        .set({ status: "imported", updatedAt: new Date() })
        .where(eq(importJobItems.id, item.id));

      await tx
        .update(importJobs)
        .set({
          added: job.added + 1,
          nextNumber: sequence + 1,
          updatedAt: new Date(),
        })
        .where(eq(importJobs.id, jobId));

      return { stop: false, action: "added" };
    }

    // Conflict: chapter with this number already exists -> skip
    await tx
      .update(importJobItems)
      .set({ status: "skipped", updatedAt: new Date() })
      .where(eq(importJobItems.id, item.id));

    await tx
      .update(importJobs)
      .set({
        skipped: job.skipped + 1,
        nextNumber: sequence + 1,
        updatedAt: new Date(),
      })
      .where(eq(importJobs.id, jobId));

    return { stop: false, action: "skipped" };
  });
}

type EpubTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function cleanupEpubResources(
  tx: EpubTransaction,
  jobId: string,
  uploadId: string | null,
): Promise<void> {
  await tx.delete(importJobItems).where(eq(importJobItems.jobId, jobId));
  if (!uploadId) return;
  await tx.delete(epubUploadChunks).where(eq(epubUploadChunks.uploadId, uploadId));
  await tx.delete(epubUploads).where(eq(epubUploads.id, uploadId));
}

export async function cancelEpubImportJob(jobId: string): Promise<boolean> {
  return await db.transaction(async (tx) => {
    const [job] = await tx
      .select({
        id: importJobs.id,
        status: importJobs.status,
        epubUploadId: importJobs.epubUploadId,
      })
      .from(importJobs)
      .where(eq(importJobs.id, jobId))
      .for("update");

    if (!job || (job.status !== "pending" && job.status !== "running")) {
      return false;
    }

    await tx
      .update(importJobs)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(importJobs.id, jobId));
    await cleanupEpubResources(tx, job.id, job.epubUploadId);
    return true;
  });
}

export async function markEpubImportJobDone(jobId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [job] = await tx
      .select({
        id: importJobs.id,
        status: importJobs.status,
        epubUploadId: importJobs.epubUploadId,
      })
      .from(importJobs)
      .where(eq(importJobs.id, jobId))
      .for("update");

    if (!job || job.status !== "running") return;

    await tx
      .update(importJobs)
      .set({ status: "done", updatedAt: new Date() })
      .where(eq(importJobs.id, jobId));
    await cleanupEpubResources(tx, job.id, job.epubUploadId);
  });
}

export async function markEpubImportJobError(jobId: string, message: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [job] = await tx
      .select({
        id: importJobs.id,
        status: importJobs.status,
        epubUploadId: importJobs.epubUploadId,
      })
      .from(importJobs)
      .where(eq(importJobs.id, jobId))
      .for("update");

    if (!job) return;
    if (job.status === "cancelled" || job.status === "done" || job.status === "error") {
      await cleanupEpubResources(tx, job.id, job.epubUploadId);
      return;
    }

    await tx
      .update(importJobs)
      .set({ status: "error", error: message, updatedAt: new Date() })
      .where(eq(importJobs.id, jobId));
    await cleanupEpubResources(tx, job.id, job.epubUploadId);
  });
}

export async function markEpubEnqueueError(jobId: string, message: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [job] = await tx
      .select({
        id: importJobs.id,
        status: importJobs.status,
        epubUploadId: importJobs.epubUploadId,
      })
      .from(importJobs)
      .where(eq(importJobs.id, jobId))
      .for("update");

    if (!job || (job.status !== "pending" && job.status !== "running")) return;

    await tx
      .update(importJobs)
      .set({ status: "error", error: message, updatedAt: new Date() })
      .where(eq(importJobs.id, jobId));
    if (!job.epubUploadId) return;
    await tx.delete(epubUploadChunks).where(eq(epubUploadChunks.uploadId, job.epubUploadId));
    await tx
      .update(epubUploads)
      .set({ status: "error", updatedAt: new Date() })
      .where(eq(epubUploads.id, job.epubUploadId));
  });
}

export async function cleanupExpiredUploads(): Promise<number> {
  return await db.transaction(async (tx) => {
    const now = new Date();
    const expired = await tx
      .select({ id: epubUploads.id })
      .from(epubUploads)
      .where(and(lt(epubUploads.expiresAt, now), eq(epubUploads.status, "uploading")));
    const uploadIds = expired.map((upload) => upload.id);
    if (uploadIds.length === 0) return 0;

    await tx.delete(epubUploadChunks).where(inArray(epubUploadChunks.uploadId, uploadIds));
    await tx.delete(epubUploads).where(inArray(epubUploads.id, uploadIds));
    return uploadIds.length;
  });
}
