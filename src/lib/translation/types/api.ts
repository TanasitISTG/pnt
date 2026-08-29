export interface SlimChunkProgress {
  index: number;
  textLength: number;
  hasTranslation: boolean;
  promptTokens?: number;
  completionTokens?: number;
  latencyMs?: number;
  error?: string;
}

export interface ActiveJobState {
  jobId: string;
  chapterId: string;
  status: "pending" | "running" | "done" | "error" | "cancelled";
  doneChunks: number;
  totalChunks: number;
  error?: string | null;
}

export interface NovelCostEntry {
  promptTokens: number;
  completionTokens: number;
  cost: number | null;
}

export interface NovelCostData {
  costs: Record<string, NovelCostEntry>;
  totals: {
    promptTokens: number;
    completionTokens: number;
    cost: number | null;
  };
}
