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
  // ISO-8601 UTC timestamp; legacy rows may contain a server-local time string.
  id: string;
  timestamp: string;
  level: "info" | "warn" | "error" | "success";
  message: string;
}
