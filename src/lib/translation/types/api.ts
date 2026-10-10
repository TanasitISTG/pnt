import type { LogEntry } from "@/lib/translation/types/workflow";

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

export type NovelCostSource = "historical" | "current-settings-estimate" | "unpriced";

export interface NovelCostEntry {
  promptTokens: number;
  completionTokens: number;
  cost: number | null;
  source: NovelCostSource;
}

export interface NovelCostData {
  costs: Record<string, NovelCostEntry>;
  totals: {
    promptTokens: number;
    completionTokens: number;
    cost: number | null;
    pricedCost: number;
    estimatedCost: number;
    pricedChapterCount: number;
    estimatedChapterCount: number;
    unpricedChapterCount: number;
  };
}

export type TranslationBatchPreviewSkipReason =
  | "already-translated"
  | "active"
  | "empty"
  | "not-found";

export interface TranslationBatchPreview {
  eligibleIds: string[];
  skipped: Array<{ id: string; reason: TranslationBatchPreviewSkipReason }>;
  rawCharacterTotal: number;
  existingTranslationCount: number;
  manualEditCount: number;
  activeCount: number;
  estimate: {
    sampleSize: number;
    promptTokens: number;
    completionTokens: number;
    cost: number | null;
  } | null;
}

export type TranslationJobStatus = "pending" | "running" | "done" | "error" | "cancelled";

export interface TranslationJobProgress {
  id: string;
  chapterId: string;
  status: TranslationJobStatus;
  doneChunks: number;
  totalChunks: number;
  error: string | null;
  updatedAt: Date;
}

export interface TranslationJobDetails extends TranslationJobProgress {
  chapterTitle: string;
  logs: LogEntry[];
  chunks: SlimChunkProgress[];
  usageJson: string | null;
  provider: string | null;
  model: string;
  isLegacyProviderFallback: boolean;
  inputPricePer1M: number | null;
  outputPricePer1M: number | null;
}
