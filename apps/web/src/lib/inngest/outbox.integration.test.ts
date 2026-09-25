import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres, { type Sql } from "postgres";
import type * as Outbox from "@/lib/inngest/outbox";

const { sendOutbox } = vi.hoisted(() => ({
  sendOutbox: vi.fn(async () => ({ ids: [] })),
}));
vi.mock("@/lib/inngest/client", () => ({ inngest: { send: sendOutbox } }));

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationDescribe = testDatabaseUrl ? describe : describe.skip;

let sql: Sql;
let dispatchWorkflowOutboxEvent: typeof Outbox.dispatchWorkflowOutboxEvent;
let dispatchPendingWorkflowOutbox: typeof Outbox.dispatchPendingWorkflowOutbox;

integrationDescribe("workflow outbox PostgreSQL recovery", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl!;
    process.env.BETTER_AUTH_SECRET ||= "test-secret-at-least-thirty-two-bytes";
    process.env.BETTER_AUTH_URL ||= "http://localhost:3000";
    process.env.APP_ENCRYPTION_KEY ||= "dGVzdC1rZXktMzItYnl0ZXMtbG9uZy1lbm91Z2g=";
    process.env.INNGEST_DEV ||= "1";
    sql = postgres(testDatabaseUrl!, { max: 2, onnotice: () => {} });
    // The database module must load only after DATABASE_URL points to the disposable test DB.
    ({ dispatchWorkflowOutboxEvent, dispatchPendingWorkflowOutbox } =
      await import("@/lib/inngest/outbox"));
  });

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 1 });
  });

  beforeEach(async () => {
    // The dispatch sweep is intentionally global; each test needs an empty outbox.
    await sql`DELETE FROM "workflow_outbox"`;
  });

  it("keeps a failed send pending and delivers it on a later attempt", async () => {
    const outboxId = `outbox-${randomUUID()}`;
    await sql`
      INSERT INTO "workflow_outbox" ("id", "event_name", "payload_json", "available_at")
      VALUES (
        ${outboxId},
        'translation/job.requested',
        '{"jobId":"job-1"}',
        now() - interval '1 second'
      )
    `;

    try {
      const [seeded] = await sql<
        { status: string; dueByDatabaseClock: boolean; dueByClientClock: boolean }[]
      >`
        SELECT "status", "available_at" <= now() AS "dueByDatabaseClock",
               "available_at" <= ${new Date()} AS "dueByClientClock"
        FROM "workflow_outbox" WHERE "id" = ${outboxId}
      `;
      expect(seeded).toEqual({
        status: "pending",
        dueByDatabaseClock: true,
        dueByClientClock: true,
      });

      let sendAttempts = 0;
      const send = async () => {
        sendAttempts += 1;
        if (sendAttempts === 1) throw new Error("network unavailable");
      };
      await expect(dispatchWorkflowOutboxEvent(outboxId, send)).resolves.toBe(false);

      const [failed] = await sql<{ status: string; attempts: number; lastError: string | null }[]>`
        SELECT "status", "attempts", "last_error" AS "lastError"
        FROM "workflow_outbox" WHERE "id" = ${outboxId}
      `;
      expect(failed).toEqual({
        status: "pending",
        attempts: 1,
        lastError: "network unavailable",
      });

      await sql`
        UPDATE "workflow_outbox" SET "available_at" = now() - interval '1 second'
        WHERE "id" = ${outboxId}
      `;
      await expect(dispatchWorkflowOutboxEvent(outboxId, send)).resolves.toBe(true);

      const [sent] = await sql<{ status: string; sentAt: Date | null }[]>`
        SELECT "status", "sent_at" AS "sentAt" FROM "workflow_outbox"
        WHERE "id" = ${outboxId}
      `;
      expect(sent.status).toBe("sent");
      expect(sent.sentAt).toBeInstanceOf(Date);
      expect(sendAttempts).toBe(2);
    } finally {
      await sql`DELETE FROM "workflow_outbox" WHERE "id" = ${outboxId}`;
    }
  });
  it("computes retry delay relative to database clock, ignoring application clock skew", async () => {
    const outboxId = `outbox-${randomUUID()}`;
    await sql`
      INSERT INTO "workflow_outbox" ("id", "event_name", "payload_json", "available_at")
      VALUES (${outboxId}, 'translation/job.requested', '{"jobId":"job-2"}', now() - interval '1 second')
    `;

    try {
      const [started] = await sql<{ startedAt: string }[]>`
        SELECT CURRENT_TIMESTAMP::text AS "startedAt"
      `;
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(Date.now() + 90 * 60 * 1000));
      try {
        await expect(
          dispatchWorkflowOutboxEvent(outboxId, async () => {
            throw new Error("transient failure under skew");
          }),
        ).resolves.toBe(false);
      } finally {
        vi.useRealTimers();
      }

      const [row] = await sql<
        { delaySeconds: number; attempts: number; withinDatabaseClockWindow: boolean }[]
      >`
        SELECT EXTRACT(EPOCH FROM ("available_at" - "updated_at"))::double precision AS "delaySeconds",
               "attempts",
               "available_at" BETWEEN (${started.startedAt}::timestamptz + interval '5 seconds')
                 AND (CURRENT_TIMESTAMP + interval '5 seconds') AS "withinDatabaseClockWindow"
        FROM "workflow_outbox" WHERE "id" = ${outboxId}
      `;
      expect(row).toEqual({
        delaySeconds: 5,
        attempts: 1,
        withinDatabaseClockWindow: true,
      });
    } finally {
      await sql`DELETE FROM "workflow_outbox" WHERE "id" = ${outboxId}`;
    }
  });

  it("delivers a row after multiple transient failures", async () => {
    const outboxId = `outbox-${randomUUID()}`;
    await sql`
      INSERT INTO "workflow_outbox" ("id", "event_name", "payload_json", "available_at")
      VALUES (${outboxId}, 'translation/job.requested', '{"jobId":"job-3"}', now() - interval '1 second')
    `;

    try {
      let sendAttempts = 0;
      const send = async () => {
        sendAttempts += 1;
        if (sendAttempts <= 2) throw new Error(`transient failure ${sendAttempts}`);
      };

      for (let round = 0; round < 2; round += 1) {
        await expect(dispatchWorkflowOutboxEvent(outboxId, send)).resolves.toBe(false);
        const [failed] = await sql<
          { status: string; attempts: number; lastError: string | null }[]
        >`
          SELECT "status", "attempts", "last_error" AS "lastError"
          FROM "workflow_outbox" WHERE "id" = ${outboxId}
        `;
        expect(failed.status).toBe("pending");
        expect(failed.attempts).toBe(round + 1);
        expect(failed.lastError).toBe(`transient failure ${round + 1}`);
        await sql`
          UPDATE "workflow_outbox" SET "available_at" = now() - interval '1 second'
          WHERE "id" = ${outboxId}
        `;
      }

      await expect(dispatchWorkflowOutboxEvent(outboxId, send)).resolves.toBe(true);
      const [sent] = await sql<{ status: string; attempts: number; sentAt: Date | null }[]>`
        SELECT "status", "attempts", "sent_at" AS "sentAt"
        FROM "workflow_outbox" WHERE "id" = ${outboxId}
      `;
      expect(sent.status).toBe("sent");
      expect(sent.attempts).toBe(2);
      expect(sent.sentAt).toBeInstanceOf(Date);
      expect(sendAttempts).toBe(3);
    } finally {
      await sql`DELETE FROM "workflow_outbox" WHERE "id" = ${outboxId}`;
    }
  });

  it("defers a malformed payload while dispatching an independently due valid row", async () => {
    const malformedId = `outbox-${randomUUID()}`;
    const validId = `outbox-${randomUUID()}`;
    await sql`
      INSERT INTO "workflow_outbox" ("id", "event_name", "payload_json", "available_at")
      VALUES
        (${malformedId}, 'translation/job.requested', 'not-valid-json', now() - interval '1 second'),
        (${validId}, 'translation/job.requested', '{"jobId":"job-4"}', now() - interval '1 second')
    `;

    try {
      sendOutbox.mockClear();
      const result = await dispatchPendingWorkflowOutbox();
      expect(result).toEqual({ examined: 2, sent: 1 });
      expect(sendOutbox.mock.calls).toEqual([
        [{ name: "translation/job.requested", data: { jobId: "job-4" } }],
      ]);

      const [valid] = await sql<{ status: string; sentAt: Date | null }[]>`
        SELECT "status", "sent_at" AS "sentAt" FROM "workflow_outbox" WHERE "id" = ${validId}
      `;
      expect(valid.status).toBe("sent");
      expect(valid.sentAt).toBeInstanceOf(Date);

      const [malformed] = await sql<
        {
          status: string;
          attempts: number;
          lastError: string | null;
          sentAt: Date | null;
          deferred: boolean;
        }[]
      >`
        SELECT "status", "attempts", "last_error" AS "lastError", "sent_at" AS "sentAt",
               "available_at" > CURRENT_TIMESTAMP AS "deferred"
        FROM "workflow_outbox" WHERE "id" = ${malformedId}
      `;
      expect(malformed.status).toBe("pending");
      expect(malformed.attempts).toBe(1);
      expect(malformed.lastError).toEqual(expect.any(String));
      expect(malformed.lastError).not.toBe("");
      expect(malformed.deferred).toBe(true);
      expect(malformed.sentAt).toBeNull();
    } finally {
      await sql`DELETE FROM "workflow_outbox" WHERE "id" IN (${malformedId}, ${validId})`;
    }
  });
});
