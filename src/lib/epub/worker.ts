import "@tanstack/react-start/server-only";

import { parseEpubArchive } from "./parser";
import {
  loadEpubImportJob,
  loadOrderedUploadChunks,
  stageImportJobItems,
  importOneStagedChapter,
  markEpubImportJobDone,
  markEpubImportJobError,
  cleanupExpiredUploads,
} from "./job-store";
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
    throw new SafeServerError("EPUB upload ID is missing from import job");
  }

  const chunks = await loadOrderedUploadChunks(job.epubUploadId);
  if (chunks.length === 0) {
    throw new SafeServerError("EPUB upload chunks not found");
  }

  // Concatenate ordered chunks into a single buffer
  const totalLength = chunks.reduce((acc, c) => acc + c.data.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk.data, offset);
    offset += chunk.data.length;
  }

  // Parse EPUB archive
  const parsed = parseEpubArchive(combined);

  // Read the destination maximum before assigning any fallback numbers.
  let currentMax = await getMaxChapterNumber(job.novelId);
  const chapterNumberPattern = /^\d+(?:\.\d{1,2})?$/;
  for (const chapter of parsed.chapters) {
    if (chapter.number === null) continue;
    if (!chapterNumberPattern.test(chapter.number)) {
      throw new SafeServerError(`Invalid chapter number: ${chapter.number}`);
    }
    const parsedNumber = Number(chapter.number);
    if (!Number.isFinite(parsedNumber) || parsedNumber < 0 || parsedNumber > 999999.99) {
      throw new SafeServerError(`Invalid chapter number: ${chapter.number}`);
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
      throw new SafeServerError(`Invalid chapter number: ${numStr}`);
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
  if (total === 0) return { skip: true };
  return { skip: false, total };
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

export async function importOneEpubChapter(
  jobId: string,
  sequence: number,
): Promise<{ stop: boolean; action?: "added" | "skipped" }> {
  log("info", "EPUB worker step import chapter", { jobId, sequence });
  return await importOneStagedChapter(jobId, sequence);
}

export async function finishEpubImportJob(jobId: string): Promise<void> {
  log("info", "EPUB worker step finish", { jobId });
  await markEpubImportJobDone(jobId);
}

export async function failEpubImportJob(jobId: string, message: string): Promise<void> {
  log("error", "EPUB worker step fail", { jobId, message });
  await markEpubImportJobError(jobId, message);
}

export async function cleanupExpiredEpubUploads(): Promise<number> {
  log("info", "EPUB cleanup expired uploads");
  return await cleanupExpiredUploads();
}
