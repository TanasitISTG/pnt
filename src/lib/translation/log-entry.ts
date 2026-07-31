import type { LogEntry } from "./translation.types";
import { nanoid } from "@/lib/utils";

export function createLog(level: LogEntry["level"], message: string): LogEntry {
  const time = new Date().toLocaleTimeString("en-US", { hour12: false });
  return { id: nanoid(), timestamp: time, level, message };
}
