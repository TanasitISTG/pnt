import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as RateLimit from "@/lib/rate-limit";
import { RateLimitError } from "@/lib/server-fn-error";

const { setResponseStatus } = vi.hoisted(() => ({ setResponseStatus: vi.fn() }));

vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeaders: () => new Headers(),
  setResponseStatus,
}));

const database = { current: undefined as unknown as Pick<PostgresJsDatabase, "execute"> };
vi.mock("@/lib/db", () => ({
  get db() {
    return database.current;
  },
}));

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationDescribe = testDatabaseUrl ? describe : describe.skip;
let client: Sql;
let limiter: typeof RateLimit;

integrationDescribe("PostgreSQL rate limits", () => {
  beforeAll(async () => {
    const url = new URL(testDatabaseUrl!);
    const databaseName = url.pathname.slice(1);
    if (
      !/^[a-z0-9_]+$/.test(databaseName) ||
      !/(^|_)(test|integration|e2e)(_|$)/.test(databaseName)
    ) {
      throw new Error(
        "Rate-limit integration tests require a disposable test/integration/e2e database",
      );
    }
    process.env.DATABASE_URL = testDatabaseUrl!;
    client = postgres(testDatabaseUrl!, { max: 4, onnotice: () => {} });
    database.current = drizzle(client);
    // Load after redirecting DATABASE_URL: env is evaluated at module initialization.
    limiter = await import("@/lib/rate-limit");
  });

  beforeEach(async () => {
    setResponseStatus.mockReset();
    // The cleanup API is intentionally global. Run only in the dedicated disposable DB.
    await client`DELETE FROM rate_limits`;
  });

  afterAll(async () => {
    if (client) {
      await client`DELETE FROM rate_limits`;
      await client.end({ timeout: 1 });
    }
  });

  it("atomically accepts sixty concurrent requests and rejects only the sixty-first", async () => {
    const subject = randomUUID();
    const results = await Promise.allSettled(
      Array.from({ length: 61 }, () => limiter.checkRateLimitForSubject("quota", subject, 60)),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(60);
    const failures = results.filter((result) => result.status === "rejected");
    expect(failures).toHaveLength(1);
    expect(failures[0]?.reason).toBeInstanceOf(RateLimitError);
    expect(failures[0]?.reason.message).toBe("Too many requests");
    expect(setResponseStatus).not.toHaveBeenCalled();
    const [row] = await client`SELECT count FROM rate_limits WHERE key = ${`quota:${subject}`}`;
    expect(row?.count).toBe(61);
  });

  it("resets at the exact window boundary, not one instant before, using database time", async () => {
    const pooled = drizzle(client);
    try {
      await pooled.transaction(async (tx) => {
        database.current = tx;
        // PostgreSQL now() is fixed for the transaction, so equality is deterministic.
        await tx.execute(sql`
          INSERT INTO rate_limits (key, count, reset_at)
          VALUES ('boundary:subject', 60, now() + INTERVAL '1 microsecond')
        `);
        await expect(
          limiter.checkRateLimitForSubject("boundary", "subject", 60),
        ).rejects.toBeInstanceOf(RateLimitError);
        await tx.execute(sql`
          UPDATE rate_limits SET reset_at = now() WHERE key = 'boundary:subject'
        `);
        await limiter.checkRateLimitForSubject("boundary", "subject", 60);
        const [row] = await tx.execute(sql`
          SELECT count, reset_at = now() + INTERVAL '1 minute' AS renewed
          FROM rate_limits WHERE key = 'boundary:subject'
        `);
        expect(row).toEqual({ count: 1, renewed: true });
        expect(setResponseStatus).not.toHaveBeenCalled();
      });
    } finally {
      database.current = pooled;
    }
  });

  it("does not lose concurrent hits when resetting an expired window", async () => {
    await client`
      INSERT INTO rate_limits (key, count, reset_at)
      VALUES ('reset:subject', 999, CURRENT_TIMESTAMP - INTERVAL '1 second')
    `;
    await Promise.all(
      Array.from({ length: 60 }, () => limiter.checkRateLimitForSubject("reset", "subject", 60)),
    );
    const [row] = await client`
      SELECT count, reset_at > CURRENT_TIMESTAMP AS renewed
      FROM rate_limits WHERE key = 'reset:subject'
    `;
    expect(row).toEqual({ count: 60, renewed: true });
    await expect(limiter.checkRateLimitForSubject("reset", "subject", 60)).rejects.toMatchObject({
      message: "Too many requests",
    });
  });

  it("deletes only expired rows in bounded batches and returns actual deletions", async () => {
    await client`
      INSERT INTO rate_limits (key, count, reset_at)
      SELECT 'expired:' || lpad(n::text, 4, '0'), 1, CURRENT_TIMESTAMP - INTERVAL '2 hours'
      FROM generate_series(1, 1001) AS n
    `;
    await client`
      INSERT INTO rate_limits (key, count, reset_at)
      SELECT 'active:' || lpad(n::text, 4, '0'), 1, CURRENT_TIMESTAMP + INTERVAL '1 hour'
      FROM generate_series(1, 2) AS n
    `;

    const deleted = await limiter.cleanupExpiredRateLimits();
    expect(deleted).toBe(1000);
    expect(await limiter.cleanupExpiredRateLimits()).toBe(1);

    const remaining = await client`SELECT key FROM rate_limits ORDER BY key`;
    expect(remaining.map((row) => row.key)).toEqual(["active:0001", "active:0002"]);

    // A second invocation finds nothing left to delete.
    expect(await limiter.cleanupExpiredRateLimits()).toBe(0);
  });

  it("rechecks expiration after a concurrent renewal wins the row lock", async () => {
    await client`
      INSERT INTO rate_limits (key, count, reset_at)
      VALUES ('race:subject', 60, CURRENT_TIMESTAMP - INTERVAL '1 second')
    `;
    const holder = await client.reserve();
    let cleanup: Promise<number> | undefined;
    try {
      await holder`BEGIN`;
      const [owner] = await holder`SELECT pg_backend_pid() AS pid`;
      await holder`SELECT count FROM rate_limits WHERE key = 'race:subject' FOR UPDATE`;
      await holder`
        UPDATE rate_limits SET reset_at = CURRENT_TIMESTAMP + INTERVAL '1 hour'
        WHERE key = 'race:subject'
      `;
      cleanup = limiter.cleanupExpiredRateLimits();
      // Observe a real lock wait before releasing the renewal, not a timing guess.
      const deadline = Date.now() + 5_000;
      let blocked = false;
      while (Date.now() < deadline) {
        const [waiter] = await client`
          SELECT EXISTS (
            SELECT 1 FROM pg_stat_activity
            WHERE ${owner.pid}::int = ANY(pg_blocking_pids(pid))
          ) AS blocked
        `;
        if (waiter.blocked) {
          blocked = true;
          break;
        }
        await delay(10);
      }
      expect(blocked).toBe(true);
      await holder`COMMIT`;
      expect(await cleanup).toBe(0);
      const [row] = await client`
        SELECT count, reset_at > CURRENT_TIMESTAMP AS renewed
        FROM rate_limits WHERE key = 'race:subject'
      `;
      expect(row).toEqual({ count: 60, renewed: true });
    } finally {
      await holder`ROLLBACK`.catch(() => undefined);
      holder.release();
      await cleanup;
    }
  });
});
