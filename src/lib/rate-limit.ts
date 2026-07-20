import "@tanstack/react-start/server-only";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db";

export class RateLimitError extends Error {
  constructor() {
    super("Too many requests");
    this.name = "RateLimitError";
  }
}

// ponytail: best-effort per-IP fixed window in Postgres — fails open on DB error
// (availability over strictness for a reading app). Escalate to Upstash if abuse appears.
export async function checkRateLimit(bucket: string, limit: number, windowMs = 60_000) {
  try {
    const headers = getRequestHeaders();
    const ip = headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const key = `${bucket}:${ip}`;

    const result = await db.execute(sql`
      INSERT INTO rate_limits (key, count, reset_at)
      VALUES (${key}, 1, now() + (${windowMs}::text || ' milliseconds')::interval)
      ON CONFLICT (key) DO UPDATE SET
        count = CASE WHEN rate_limits.reset_at <= now() THEN 1 ELSE rate_limits.count + 1 END,
        reset_at = CASE WHEN rate_limits.reset_at <= now()
          THEN now() + (${windowMs}::text || ' milliseconds')::interval
          ELSE rate_limits.reset_at END
      RETURNING count
    `);

    const rows = (result as any).rows ?? result;
    const count = Number(rows[0]?.count ?? 1);
    if (count > limit) throw new RateLimitError();
  } catch (err) {
    if (err instanceof RateLimitError) throw err;
    console.error("[rate-limit] check failed, allowing request:", err);
  }
}
