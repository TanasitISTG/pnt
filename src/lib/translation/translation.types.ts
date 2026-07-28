// Shared types for the translation domain. Leaf module — types only, no
// runtime imports (safe for both client and server bundles).

// -- Jobs & progress (translation.functions, use-translation-job) ------------

export interface SlimChunkProgress {
  index: number;
  textLength: number;
  hasTranslation: boolean;
  promptTokens?: number;
  completionTokens?: number;
  latencyMs?: number;
  error?: string;
}

export interface ChunkProgress {
  index: number;
  text: string;
  translation?: string;
  promptTokens?: number;
  completionTokens?: number;
  latencyMs?: number;
  error?: string;
}

export interface LogEntry {
  // Unique per entry; used as React key in the log console. Rows written
  // before this field existed are backfilled client-side on read.
  id: string;
  timestamp: string;
  level: "info" | "warn" | "error" | "success";
  message: string;
}

export interface ActiveJobState {
  jobId: string;
  chapterId: string;
  status: "pending" | "running" | "done" | "error" | "cancelled";
  doneChunks: number;
  totalChunks: number;
  error?: string | null;
}

// -- Glossary term suggestion & review (suggest-terms-prompt) ----------------

export interface SuggestedTerm {
  source: string;
  target: string;
  category: "character" | "place" | "skill" | "item" | "other";
  note?: string;
}

export type GlossaryReviewAction = "approve" | "reject" | "pending";
export type GlossaryReviewConfidence = "high" | "medium" | "low";

export interface GlossaryReviewResult {
  source: string;
  target: string;
  action: GlossaryReviewAction;
  confidence: GlossaryReviewConfidence;
  reason: string;
  matchingApprovedTerm?: string;
}

export interface TermSuggestionContext {
  rawSourceExcerpt?: string;
  translatedExcerpt?: string;
  chapterSummary?: string;
  approvedMappings?: { source: string; target: string }[];
}

export interface GlossaryTermInput {
  source: string;
  target: string;
  category?: string | null;
  note?: string | null;
}

// -- Chunking, paragraphs, residual hanzi ------------------------------------

export interface ChunkInfo {
  index: number;
  text: string;
}

export interface AlignedParagraph {
  raw?: string;
  translated?: string;
}

export interface HanziSpan {
  start: number;
  end: number; // exclusive
  text: string;
}

// -- Provider client ----------------------------------------------------------

export type ProviderType = "openai" | "gemini";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionOptions {
  messages: ChatMessage[];
  temperature?: number;
  model?: string;
  responseFormat?: { type: "json_object" | "text" };
  maxTokens?: number;
}

export interface ChatCompletionResult {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

export interface AIProviderClient {
  provider: ProviderType;
  model: string;
  fastModel?: string | null;
  temperature: number;
  baseUrl: string;
  generateChatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult>;
}

export type ProviderClientConfig = AIProviderClient;

// -- Prompts ------------------------------------------------------------------

export type LanguagePair = "en->th" | "zh->en" | "zh->th";

export interface ContextOptions {
  previousSummary?: string | null;
}
