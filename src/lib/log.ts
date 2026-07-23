export type LogLevel = "info" | "warn" | "error";

export function log(level: LogLevel, msg: string, meta?: Record<string, unknown>) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...meta,
  };

  console[level](JSON.stringify(payload));
}
