import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres, { type Sql } from "postgres";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationDescribe = testDatabaseUrl ? describe : describe.skip;

let sql: Sql;
let dispatchTranslationOutboxEvent: typeof import("./outbox").dispatchTranslationOutboxEvent;

integrationDescribe("translation outbox PostgreSQL recovery", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl!;
    process.env.BETTER_AUTH_SECRET ||= "test-secret-at-least-thirty-two-bytes";
    process.env.BETTER_AUTH_URL ||= "http://localhost:3000";
    process.env.APP_ENCRYPTION_KEY ||= "dGVzdC1rZXktMzItYnl0ZXMtbG9uZy1lbm91Z2g=";
    process.env.INNGEST_DEV ||= "1";
    sql = postgres(testDatabaseUrl!, { max: 2, onnotice: () => {} });
    ({ dispatchTranslationOutboxEvent } = await import("./outbox"));
  });

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 1 });
  });

  it("keeps a failed send pending and delivers it on a later attempt", async () => {
    const outboxId = `outbox-${randomUUID()}`;
    await sql`
      INSERT INTO "translation_outbox" ("id", "event_name", "payload_json", "available_at")
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
        FROM "translation_outbox" WHERE "id" = ${outboxId}
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
      await expect(dispatchTranslationOutboxEvent(outboxId, send)).resolves.toBe(false);

      const [failed] = await sql<{ status: string; attempts: number; lastError: string | null }[]>`
        SELECT "status", "attempts", "last_error" AS "lastError"
        FROM "translation_outbox" WHERE "id" = ${outboxId}
      `;
      expect(failed).toEqual({
        status: "pending",
        attempts: 1,
        lastError: "network unavailable",
      });

      await sql`
        UPDATE "translation_outbox" SET "available_at" = now() - interval '1 second'
        WHERE "id" = ${outboxId}
      `;
      await expect(dispatchTranslationOutboxEvent(outboxId, send)).resolves.toBe(true);

      const [sent] = await sql<{ status: string; sentAt: Date | null }[]>`
        SELECT "status", "sent_at" AS "sentAt" FROM "translation_outbox"
        WHERE "id" = ${outboxId}
      `;
      expect(sent.status).toBe("sent");
      expect(sent.sentAt).toBeInstanceOf(Date);
      expect(sendAttempts).toBe(2);
    } finally {
      await sql`DELETE FROM "translation_outbox" WHERE "id" = ${outboxId}`;
    }
  });
});
