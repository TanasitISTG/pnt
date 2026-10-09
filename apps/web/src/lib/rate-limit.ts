import "@tanstack/react-start/server-only";
import { getRequestHeaders, setResponseStatus } from "@tanstack/react-start/server";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { normalizeIpAddress } from "@/lib/scrape/network-policy.server";
import { log } from "@/lib/log";
import { RateLimitError } from "@/lib/server-fn-error";

// Guests hit read endpoints without a session; per-IP per-minute cap for scraping control.
export const GUEST_READ_LIMIT = 60;

export function extractIp(headers: Headers): string | null {
  const hops = env.RATE_LIMIT_TRUSTED_PROXY_HOPS;
  if (hops === 0) return null;
  const forwarded = headers.get("x-forwarded-for");
  if (!forwarded) return null;
  const parts = forwarded.split(",");
  if (parts.length < hops) return null;
  const addresses = parts.map((part) => normalizeIpAddress(part));
  if (addresses.some((address) => address === null)) return null;
  return addresses[parts.length - hops]?.address ?? null;
}

export function isOverLimit(count: number, limit: number): boolean {
  return count > limit;
}

// ponytail: best-effort per-IP fixed window in Postgres — fails open on DB error
// (availability over strictness for a reading app). Escalate to Upstash if abuse appears.
async function checkSubjectLimit(
  bucket: string,
  subject: string,
  limit: number,
  windowMs = 60_000,
): Promise<void> {
  const key = `${bucket}:${subject}`;
  const result = await db.execute(sql`
    INSERT INTO rate_limits (key, count, reset_at)
    VALUES (${key}, 1, now() + (${windowMs} * INTERVAL '1 millisecond'))
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limits.reset_at <= now() THEN 1 ELSE rate_limits.count + 1 END,
      reset_at = CASE WHEN rate_limits.reset_at <= now()
        THEN now() + (${windowMs} * INTERVAL '1 millisecond')
        ELSE rate_limits.reset_at END
    RETURNING count
  `);

  // postgres.js returns a row array; HTTP drivers wrap it in { rows }.
  type CountRow = { count?: number };
  const rows = (
    Array.isArray(result) ? result : (result as unknown as { rows: CountRow[] }).rows
  ) as CountRow[];
  const count = Number(rows[0]?.count);
  if (!Number.isFinite(count) || !Number.isInteger(count) || count <= 0) {
    throw new Error("Invalid rate limit result");
  }
  if (isOverLimit(count, limit)) {
    setResponseStatus(429);
    throw new RateLimitError();
  }
}

export async function checkRateLimitForSubject(
  bucket: string,
  subject: string,
  limit: number,
  windowMs = 60_000,
): Promise<void> {
  try {
    await checkSubjectLimit(bucket, subject, limit, windowMs);
  } catch (err) {
    if (err instanceof RateLimitError) throw err;
    log("error", "rate-limit check failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function cleanupExpiredRateLimits(): Promise<number> {
  const result = await db.execute(sql`
    DELETE FROM rate_limits
    WHERE key IN (
      SELECT key FROM rate_limits
      WHERE reset_at <= CURRENT_TIMESTAMP
      ORDER BY reset_at, key
      LIMIT 1000
    ) AND reset_at <= CURRENT_TIMESTAMP
    RETURNING key
  `);
  return result.length;
}

export async function checkRateLimit(bucket: string, limit: number, windowMs = 60_000) {
  try {
    const headers = getRequestHeaders();
    const ip = extractIp(headers);
    if (!ip) {
      log("warn", "rate-limit skipped without trusted client IP", {});
      return;
    }
    await checkRateLimitForSubject(bucket, ip, limit, windowMs);
  } catch (err) {
    if (err instanceof RateLimitError) throw err;
    log("error", "rate-limit check failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
