import type { LogEntry } from "../types/workflow";
import { nanoid } from "@/lib/utils";

const MAX_LOG_ENTRIES = 500;
const MAX_LOG_MESSAGE_LENGTH = 4_000;
const LOG_LEVELS = new Set<LogEntry["level"]>(["info", "warn", "error", "success"]);

export function createLog(level: LogEntry["level"], message: string): LogEntry {
  return {
    id: nanoid(),
    timestamp: new Date().toISOString(),
    level,
    message: message.slice(0, MAX_LOG_MESSAGE_LENGTH),
  };
}

function malformedLogEntries(): LogEntry[] {
  return [createLog("warn", "Stored execution logs were malformed; valid entries were recovered.")];
}

export function parseLogEntries(value: string | null | undefined): LogEntry[] {
  if (!value) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return malformedLogEntries();
  }
  if (!Array.isArray(parsed)) return malformedLogEntries();

  let malformed = false;
  const entries = parsed.flatMap((entry): LogEntry[] => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      malformed = true;
      return [];
    }
    const record = entry as Record<string, unknown>;
    const level = record.level;
    const message = record.message;
    if (
      typeof level !== "string" ||
      !LOG_LEVELS.has(level as LogEntry["level"]) ||
      typeof message !== "string"
    ) {
      malformed = true;
      return [];
    }
    return [
      {
        id: typeof record.id === "string" && record.id.length > 0 ? record.id : nanoid(),
        timestamp:
          typeof record.timestamp === "string" && record.timestamp.length > 0
            ? record.timestamp
            : new Date().toISOString(),
        level: level as LogEntry["level"],
        message: message.slice(0, MAX_LOG_MESSAGE_LENGTH),
      },
    ];
  });

  return [...entries, ...(malformed ? malformedLogEntries() : [])].slice(-MAX_LOG_ENTRIES);
}

export function serializeLogEntries(entries: readonly LogEntry[]): string {
  return JSON.stringify(
    entries.slice(-MAX_LOG_ENTRIES).map((entry) => ({
      ...entry,
      message: entry.message.slice(0, MAX_LOG_MESSAGE_LENGTH),
    })),
  );
}

export function appendLogEntry(logsJson: string | null | undefined, entry: LogEntry): string {
  return JSON.stringify([...parseLogEntries(logsJson), entry].slice(-MAX_LOG_ENTRIES));
}
