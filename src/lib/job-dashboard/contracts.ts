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
