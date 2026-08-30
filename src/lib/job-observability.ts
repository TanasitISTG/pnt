export type JobActivitySummary = {
  activeTranslationJobs: number;
  failedTranslationJobs: number;
  activeImportJobs: number;
  failedImportJobs: number;
};

type StatusRow = {
  status: string;
};

export function summarizeJobActivity(
  translationRows: readonly StatusRow[],
  importRows: readonly StatusRow[],
): JobActivitySummary {
  return {
    activeTranslationJobs: translationRows.filter(
      (job) => job.status === "pending" || job.status === "running",
    ).length,
    failedTranslationJobs: translationRows.filter((job) => job.status === "error").length,
    activeImportJobs: importRows.filter(
      (job) => job.status === "pending" || job.status === "running",
    ).length,
    failedImportJobs: importRows.filter((job) => job.status === "error").length,
  };
}

export type JobStats = {
  avgChunkLatencyMs: number;
  promptTokens: number;
  completionTokens: number;
};

type ChunkStatsRow = {
  avgLatencyMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
};

export function normalizeJobStats(chunkStats: ChunkStatsRow | null | undefined): JobStats {
  return {
    avgChunkLatencyMs: Number(chunkStats?.avgLatencyMs ?? 0),
    promptTokens: Number(chunkStats?.promptTokens ?? 0),
    completionTokens: Number(chunkStats?.completionTokens ?? 0),
  };
}
