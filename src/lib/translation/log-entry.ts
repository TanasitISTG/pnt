import type { LogEntry } from "./translation.types";
import { nanoid } from "@/lib/utils";

export function createLog(level: LogEntry["level"], message: string): LogEntry {
  return { id: nanoid(), timestamp: new Date().toISOString(), level, message };
}
