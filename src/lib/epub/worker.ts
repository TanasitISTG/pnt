import "@tanstack/react-start/server-only";

import { parseEpubArchive } from "./parser";
import {
  loadEpubImportJob,
  loadEpubUploadObjectKey,
  readStagedEpubArchive,
  deleteStagedEpubArchive,
  stageImportJobItems,
  importOneStagedChapter,
  markEpubImportJobDone,
  markEpubImportJobError,
  cleanupExpiredUploads,
} from "./job-store";
import { encodeMessage } from "@/lib/i18n/message-code";
import { getMaxChapterNumber, markImportJobRunning } from "@/lib/import/job-store";
import { SafeServerError } from "@/lib/server-fn-error";
import { log } from "@/lib/log";

// Step logic for the "import-epub-chapters" Inngest function.

export async function prepareEpubImportJob(
  jobId: string,
): Promise<{ skip: boolean; total?: number }> {
  log("info", "EPUB worker step prepare", { jobId });
  const job = await loadEpubImportJob(jobId);

  if (!job || job.status === "cancelled" || job.status === "done" || job.status === "error") {
    return { skip: true };
  }

  // Idempotency: if job is already prepared and items are staged, reuse total
  if (job.toNumber > 0) {
    return { skip: false, total: job.toNumber };
  }

  if (!job.epubUploadId) {
    throw new SafeServerError(encodeMessage("errors.epubUploadIdMissing"));
  }

  const objectKey = await loadEpubUploadObjectKey(job.epubUploadId);
  if (!objectKey) {
    throw new SafeServerError(encodeMessage("errors.epubStorageKeyMissing"));
  }

  const combined = await readStagedEpubArchive(objectKey);
  if (!combined || combined.length === 0) {
    throw new SafeServerError(encodeMessage("errors.epubUploadMissing"));
  }

  // Parse EPUB archive
  const parsed = parseEpubArchive(combined);

  // Read the destination maximum before assigning any fallback numbers.
  let currentMax = await getMaxChapterNumber(job.novelId);
  const chapterNumberPattern = /^\d+(?:\.\d{1,2})?$/;
  for (const chapter of parsed.chapters) {
    if (chapter.number === null) continue;
    if (!chapterNumberPattern.test(chapter.number)) {
      throw new SafeServerError(
        encodeMessage("errors.epubInvalidChapterNumber", { number: chapter.number }),
      );
    }
    const parsedNumber = Number(chapter.number);
    if (!Number.isFinite(parsedNumber) || parsedNumber < 0 || parsedNumber > 999999.99) {
      throw new SafeServerError(
        encodeMessage("errors.epubInvalidChapterNumber", { number: chapter.number }),
      );
    }
    currentMax = Math.max(currentMax, parsedNumber);
  }

  let nextFallbackNumber = Math.floor(currentMax) + 1;
  const items: Array<{
    sequence: number;
    chapterNumber: string;
    title: string;
    rawContent: string;
    rawCharCount: number;
  }> = [];

  for (let i = 0; i < parsed.chapters.length; i++) {
    const chapter = parsed.chapters[i];
    const numStr = chapter.number === null ? String(nextFallbackNumber++) : chapter.number;
    const numericValue = Number(numStr);
    if (
      !chapterNumberPattern.test(numStr) ||
      !Number.isFinite(numericValue) ||
      numericValue < 0 ||
      numericValue > 999999.99
    ) {
      throw new SafeServerError(
        encodeMessage("errors.epubInvalidChapterNumber", { number: numStr }),
      );
    }
    items.push({
      sequence: i + 1,
      chapterNumber: numStr,
      title: chapter.title,
      rawContent: chapter.content,
      rawCharCount: chapter.content.length,
    });
  }

  const total = await stageImportJobItems(jobId, job.epubUploadId, items);
  if (total === 0) {
    await deleteStagedEpubArchive(objectKey);
    await markEpubImportJobError(jobId, "EPUB contains no importable chapters.");
    return { skip: true };
  }
  // Every chapter is staged, so the raw archive is no longer needed.
  await deleteStagedEpubArchive(objectKey);
  return { skip: false, total };
}

export const EPUB_IMPORT_CHAPTER_BATCH_SIZE = 25;
export const EPUB_IMPORT_MAX_BATCHES_PER_RUN = 900;

export interface EpubImportBatch {
  from: number;
  to: number;
}

export function planEpubImportBatches(
  next: number,
  to: number,
): { batches: EpubImportBatch[]; next: number; hasMore: boolean } {
  const batches: EpubImportBatch[] = [];
  let cursor = next;

  while (cursor <= to && batches.length < EPUB_IMPORT_MAX_BATCHES_PER_RUN) {
    const batchEnd = Math.min(cursor + EPUB_IMPORT_CHAPTER_BATCH_SIZE - 1, to);
    batches.push({ from: cursor, to: batchEnd });
    cursor = batchEnd + 1;
  }

  return { batches, next: cursor, hasMore: cursor <= to };
}

export async function initEpubImportJob(
  jobId: string,
): Promise<{ skip: boolean; next?: number; to?: number }> {
  log("info", "EPUB worker step init", { jobId });
  const job = await loadEpubImportJob(jobId);

  if (!job || job.status === "cancelled" || job.status === "done" || job.status === "error") {
    return { skip: true };
  }

  if (job.status === "pending") {
    const started = await markImportJobRunning(jobId);
    if (started === false) return { skip: true };
  }

  return { skip: false, next: job.nextNumber, to: job.toNumber };
}

export async function importEpubChapterBatch(
  jobId: string,
  fromSequence: number,
  toSequence: number,
): Promise<{ stop: boolean }> {
  log("info", "EPUB worker step import chapter batch", {
    jobId,
    fromSequence,
    toSequence,
  });

  for (let sequence = fromSequence; sequence <= toSequence; sequence++) {
    const result = await importOneStagedChapter(jobId, sequence);
    if (result.stop) return { stop: true };
  }

  return { stop: false };
}

/**
 * Removes the staged archive before its owning row is deleted, so a terminal job
 * never leaves an object that nothing can reach.
 */
async function deleteJobEpubArchive(jobId: string): Promise<void> {
  const job = await loadEpubImportJob(jobId);
  if (!job?.epubUploadId) return;
  const objectKey = await loadEpubUploadObjectKey(job.epubUploadId);
  if (objectKey) await deleteStagedEpubArchive(objectKey);
}

export async function finishEpubImportJob(jobId: string): Promise<void> {
  log("info", "EPUB worker step finish", { jobId });
  await deleteJobEpubArchive(jobId);
  await markEpubImportJobDone(jobId);
}

export async function failEpubImportJob(jobId: string, message: string): Promise<void> {
  log("error", "EPUB worker step fail", { jobId, message });
  await deleteJobEpubArchive(jobId);
  await markEpubImportJobError(jobId, message);
}

export async function cleanupExpiredEpubUploads(): Promise<number> {
  log("info", "EPUB cleanup expired uploads");
  return await cleanupExpiredUploads();
}
