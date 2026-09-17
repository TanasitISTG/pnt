import { z } from "zod";

import type { ScrapeProvider } from "@/lib/scrape/types";

export const jobHistoryTypeSchema = z.enum(["all", "translation", "scrape", "epub"]);
export const jobHistoryStatusSchema = z.enum([
  "all",
  "pending",
  "running",
  "done",
  "error",
  "cancelled",
]);
export const jobHistorySortSchema = z.enum([
  "updatedAt",
  "createdAt",
  "novelTitle",
  "status",
  "type",
]);
export const jobHistoryDirectionSchema = z.enum(["asc", "desc"]);

export const jobHistorySearchSchema = z.object({
  q: z.string().trim().max(100).default(""),
  type: jobHistoryTypeSchema.default("all"),
  status: jobHistoryStatusSchema.default("all"),
  sort: jobHistorySortSchema.default("updatedAt"),
  dir: jobHistoryDirectionSchema.default("desc"),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce
    .number()
    .int()
    .refine((value): value is 10 | 25 | 50 => value === 10 || value === 25 || value === 50, {
      message: "Page size must be 10, 25, or 50",
    })
    .default(25),
});

export type JobHistorySearch = z.infer<typeof jobHistorySearchSchema>;
export type JobHistoryType = Exclude<z.infer<typeof jobHistoryTypeSchema>, "all">;
export type JobHistoryStatus = Exclude<z.infer<typeof jobHistoryStatusSchema>, "all">;
export type JobHistorySort = z.infer<typeof jobHistorySortSchema>;
export type JobHistoryDirection = z.infer<typeof jobHistoryDirectionSchema>;
export type JobHistoryPageSize = JobHistorySearch["pageSize"];

export type JobHistoryDate = Date | string;

export type JobHistoryProgress = {
  completed: number;
  total: number;
  percent: number;
  preparing: boolean;
};

type JobHistoryRowBase = {
  id: string;
  status: JobHistoryStatus;
  novelId: string;
  novelTitle: string;
  error: string | null;
  createdAt: JobHistoryDate;
  updatedAt: JobHistoryDate;
  progress: JobHistoryProgress;
  canCancel: boolean;
  canRetry: boolean;
};

export type JobHistoryTranslationRow = JobHistoryRowBase & {
  type: "translation";
  chapterId: string;
  chapterNumber: string;
  chapterTitle: string;
  totalChunks: number;
  doneChunks: number;
  provider: string | null;
  model: string | null;
  isLegacyProviderFallback: boolean;
};

export type JobHistoryScrapeRow = JobHistoryRowBase & {
  type: "scrape";
  baseUrl: string;
  scrapeProvider: ScrapeProvider | null;
  fromNumber: number;
  toNumber: number;
  nextNumber: number;
  added: number;
  skipped: number;
  failed: number;
  completedWithFailures: boolean;
};

export type JobHistoryEpubRow = JobHistoryRowBase & {
  type: "epub";
  sourceFileName: string | null;
  fromNumber: number;
  toNumber: number;
  nextNumber: number;
  added: number;
  skipped: number;
  failed: number;
};

export type JobHistoryRow = JobHistoryTranslationRow | JobHistoryScrapeRow | JobHistoryEpubRow;

export type JobHistoryPage = {
  rows: JobHistoryRow[];
  rowCount: number;
  page: number;
  pageSize: JobHistoryPageSize;
};

export type JobStats = {
  avgChunkLatencyMs: number;
  promptTokens: number;
  completionTokens: number;
  activeTranslationJobs: number;
  failedTranslationJobs: number;
  activeImportJobs: number;
  failedImportJobs: number;
};

export type JobActivity = {
  id: string;
  type: JobHistoryType;
  status: JobHistoryStatus;
  novelId: string;
  error: string | null;
  updatedAt: JobHistoryDate;
  progress: JobHistoryProgress;
  doneChunks?: number;
  totalChunks?: number;
  added?: number;
  skipped?: number;
  failed?: number;
};

export const jobActivityTypeSchema = z.enum(["translation", "scrape", "epub"]);

export const jobActivityIdentitySchema = z.object({
  id: z.string().trim().min(1).max(200),
  type: jobActivityTypeSchema,
});

/**
 * The activity endpoint projects the identities the caller is actually
 * rendering (at most one history page) instead of truncating a global active
 * list. Bounded by the existing maximum history page size of 50.
 */
export const jobActivityInputSchema = z.object({
  jobs: z.array(jobActivityIdentitySchema).max(50).default([]),
});

export type JobActivityIdentity = z.infer<typeof jobActivityIdentitySchema>;
export type JobActivityInput = z.infer<typeof jobActivityInputSchema>;

export type JobActivitySnapshot = {
  activities: JobActivity[];
  activeTranslationJobs: number;
  activeImportJobs: number;
  /**
   * Opaque exact-database change fingerprint across every retained owned job
   * (terminal rows included). It is an invalidation signal, not an event feed.
   */
  revision: string;
};

function compareActivityIdentities(left: JobActivityIdentity, right: JobActivityIdentity): number {
  if (left.type !== right.type) return left.type < right.type ? -1 : 1;
  if (left.id !== right.id) return left.id < right.id ? -1 : 1;
  return 0;
}

export function normalizeJobActivityInput(
  jobs: readonly JobActivityIdentity[],
): JobActivityIdentity[] {
  const seen = new Set<string>();
  const normalized: JobActivityIdentity[] = [];
  for (const job of jobs.toSorted(compareActivityIdentities)) {
    const key = `${job.type}:${job.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ id: job.id, type: job.type });
  }
  return normalized;
}

type ChunkStatsRow = {
  avgLatencyMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
};

type JobCountStatsRow = {
  activeJobs: number | null;
  failedJobs: number | null;
};

export function normalizeJobStats(
  chunkStats: ChunkStatsRow | null | undefined,
  translationStats?: JobCountStatsRow | null,
  importStats?: JobCountStatsRow | null,
): JobStats {
  return {
    avgChunkLatencyMs: Number(chunkStats?.avgLatencyMs ?? 0),
    promptTokens: Number(chunkStats?.promptTokens ?? 0),
    completionTokens: Number(chunkStats?.completionTokens ?? 0),
    activeTranslationJobs: Number(translationStats?.activeJobs ?? 0),
    failedTranslationJobs: Number(translationStats?.failedJobs ?? 0),
    activeImportJobs: Number(importStats?.activeJobs ?? 0),
    failedImportJobs: Number(importStats?.failedJobs ?? 0),
  };
}
