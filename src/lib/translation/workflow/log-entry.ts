import type { LogEntry } from "../types/workflow";

import { encodeMessage } from "@/lib/i18n/message-code";
import type { Messages } from "@/lib/i18n/messages";
import { nanoid } from "@/lib/utils";

const MAX_LOG_ENTRIES = 500;
const MAX_LOG_MESSAGE_LENGTH = 4_000;
const LOG_LEVELS = new Set<LogEntry["level"]>(["info", "warn", "error", "success"]);

/**
 * A log sentence the app writes itself, named rather than spelled out.
 *
 * A row is read long after it was written, and by a reader whose language the worker cannot
 * know - it is one of several requests in flight at that moment. Storing a key and its values
 * lets the drawer render the row in whatever language the reader is in, and lets a sentence
 * be reworded without rewriting history. Text that is data rather than copy - a provider's
 * warning, an error from a library - is still stored as the sentence it is.
 */
export type LogMessageKey = keyof Messages["log"];

/**
 * The values a log sentence takes. Deliberately not derived from the message: the catalogs are
 * typed as a shape rather than as literals (see `messages/en.ts`), so a key's ICU arguments are
 * not visible at compile time. A misspelled parameter loses that one value in that one row, and
 * every other line of the console still reads.
 */
export type LogMessageValues = Record<string, string | number>;

/** The stored form of one log sentence: the code the drawer resolves, or the text as-is. */
export function logMessage(key: LogMessageKey, values?: LogMessageValues): string {
  return encodeMessage(`log.${key}`, values);
}

export function createLogMessage(
  level: LogEntry["level"],
  key: LogMessageKey,
  values?: LogMessageValues,
): LogEntry {
  return createLog(level, logMessage(key, values));
}

/**
 * One stored entry. `message` is either a code from `logMessage` or a sentence that is data;
 * `parseLogEntries` and the drawer treat both the same way, and only the code is translated.
 */
export function createLog(level: LogEntry["level"], message: string): LogEntry {
  return {
    id: nanoid(),
    timestamp: new Date().toISOString(),
    level,
    message: message.slice(0, MAX_LOG_MESSAGE_LENGTH),
  };
}

function malformedLogEntries(): LogEntry[] {
  return [createLogMessage("warn", "logsMalformed")];
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
