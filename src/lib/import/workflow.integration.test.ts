import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres, { type Sql } from "postgres";
import type {
  cancelImportJobForUser as CancelImportJobForUser,
  startScrapeImportForUser as StartScrapeImportForUser,
} from "./commands";
import type { commitScrapeImportChapter as CommitScrapeImportChapter } from "./job-store";
import type { dispatchWorkflowOutboxEvent as DispatchWorkflowOutboxEvent } from "@/lib/inngest/outbox";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationDescribe = testDatabaseUrl ? describe : describe.skip;

let sql: Sql;
let startScrapeImportForUser: typeof StartScrapeImportForUser;
let cancelImportJobForUser: typeof CancelImportJobForUser;
let commitScrapeImportChapter: typeof CommitScrapeImportChapter;
let dispatchWorkflowOutboxEvent: typeof DispatchWorkflowOutboxEvent;

const userId = `user-${randomUUID()}`;
const novelId = `novel-${randomUUID()}`;

async function deleteOutboxRows(ids: readonly string[]) {
  for (const id of ids) await sql`DELETE FROM "workflow_outbox" WHERE "id" = ${id}`;
}

integrationDescribe("import workflow PostgreSQL integration", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl!;
    process.env.BETTER_AUTH_SECRET ||= "test-secret-at-least-thirty-two-bytes";
    process.env.BETTER_AUTH_URL ||= "http://localhost:3000";
    process.env.APP_ENCRYPTION_KEY ||= "dGVzdC1rZXktMzItYnl0ZXMtbG9uZy1lbm91Z2g=";
    process.env.INNGEST_DEV ||= "1";
    sql = postgres(testDatabaseUrl!, { max: 10, onnotice: () => {} });

    ({ startScrapeImportForUser, cancelImportJobForUser } = await import("./commands"));
    ({ commitScrapeImportChapter } = await import("./job-store"));
    ({ dispatchWorkflowOutboxEvent } = await import("@/lib/inngest/outbox"));

    await sql`
      INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at")
      VALUES (${userId}, 'Import Tester', ${`${userId}@example.test`}, true, now(), now())
    `;
    await sql`
      INSERT INTO "novels" ("id", "user_id", "title", "source_lang", "target_lang", "created_at", "updated_at")
      VALUES (${novelId}, ${userId}, 'Import Workflow Test', 'zh', 'en', now(), now())
    `;
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM "workflow_outbox" WHERE "payload_json" LIKE ${`%${novelId}%`}`;
      await sql`DELETE FROM "novels" WHERE "id" = ${novelId}`;
      await sql.end({ timeout: 1 });
    }
  });

  it("serializes concurrent starts to one active import", async () => {
    const results = await Promise.all(
      [1, 2].map(() =>
        startScrapeImportForUser(
          userId,
          {
            novelId,
            baseUrl: "https://www.quanben.io/n/abc/1.html",
            from: 1,
            to: 2,
            provider: "auto",
          },
          async () => {},
        ),
      ),
    );

    const active = await sql`
      SELECT "id", "status" FROM "import_jobs"
      WHERE "novel_id" = ${novelId} AND "status" IN ('pending', 'running')
    `;
    expect(active).toHaveLength(1);
    expect(results).toHaveLength(2);

    await deleteOutboxRows(results.flatMap((result) => result.outboxIds));
    await sql`DELETE FROM "import_jobs" WHERE "novel_id" = ${novelId}`;
  });

  it("accepts 500 chapters, rejects 501, and enforces the numeric chapter ceiling", async () => {
    const accepted = await startScrapeImportForUser(
      userId,
      {
        novelId,
        baseUrl: "https://www.quanben.io/n/abc/1.html",
        from: 1,
        to: 500,
        provider: "auto",
      },
      async () => {},
    );
    const [acceptedJob] = await sql`
      SELECT "from_number", "to_number"
      FROM "import_jobs"
      WHERE "id" = ${accepted.jobId}
    `;
    expect(acceptedJob).toEqual({ from_number: 1, to_number: 500 });
    await deleteOutboxRows(accepted.outboxIds);
    await sql`DELETE FROM "import_jobs" WHERE "id" = ${accepted.jobId}`;

    await expect(
      startScrapeImportForUser(
        userId,
        {
          novelId,
          baseUrl: "https://www.quanben.io/n/abc/1.html",
          from: 1,
          to: 501,
          provider: "auto",
        },
        async () => {},
      ),
    ).rejects.toThrow("Invalid range");

    await expect(
      startScrapeImportForUser(
        userId,
        {
          novelId,
          baseUrl: "https://www.quanben.io/n/abc/1.html",
          from: 1_000_000,
          to: 1_000_000,
          provider: "auto",
        },
        async () => {},
      ),
    ).rejects.toThrow("Invalid range");

    const jobs = await sql`
      SELECT "id" FROM "import_jobs"
      WHERE "novel_id" = ${novelId}
    `;
    expect(jobs).toHaveLength(0);
  });

  it("keeps committed request intent pending when eager dispatch fails", async () => {
    const result = await startScrapeImportForUser(
      userId,
      {
        novelId,
        baseUrl: "https://www.quanben.io/n/abc/1.html",
        from: 1,
        to: 1,
        provider: "auto",
      },
      async () => {
        throw new Error("Inngest unavailable");
      },
    );
    const requestOutboxId = result.outboxIds.at(-1)!;
    const [pending] = await sql`
      SELECT "status", "payload_json" FROM "workflow_outbox" WHERE "id" = ${requestOutboxId}
    `;
    expect(pending.status).toBe("pending");
    expect(JSON.parse(pending.payload_json)).toMatchObject({ jobId: result.jobId });

    let sends = 0;
    await expect(
      dispatchWorkflowOutboxEvent(requestOutboxId, async () => {
        sends += 1;
      }),
    ).resolves.toBe(true);
    await expect(
      dispatchWorkflowOutboxEvent(requestOutboxId, async () => {
        sends += 1;
      }),
    ).resolves.toBe(false);
    expect(sends).toBe(1);

    await deleteOutboxRows(result.outboxIds);
    await sql`DELETE FROM "import_jobs" WHERE "id" = ${result.jobId}`;
  });

  it("advances scrape progress once and rejects future cursors", async () => {
    const jobId = `job-${randomUUID()}`;
    await sql`
      INSERT INTO "import_jobs" (
        "id", "novel_id", "kind", "status", "base_url", "from_number", "to_number",
        "next_number", "scrape_provider", "created_at", "updated_at"
      ) VALUES (
        ${jobId}, ${novelId}, 'scrape', 'running', 'https://www.quanben.io/n/abc/1.html', 1, 2,
        1, 'auto', now(), now()
      )
    `;

    const outcome = {
      kind: "added" as const,
      number: "1",
      title: "Chapter 1",
      content: "Body",
    };
    await expect(commitScrapeImportChapter(jobId, 1, outcome)).resolves.toEqual({
      stop: false,
      created: true,
    });
    await expect(commitScrapeImportChapter(jobId, 1, outcome)).resolves.toEqual({
      stop: false,
      created: false,
      replayed: true,
    });
    await expect(commitScrapeImportChapter(jobId, 3, { kind: "skipped" })).rejects.toThrow(
      "Import cursor out of order",
    );

    const [progress] = await sql`
      SELECT "next_number", "added" FROM "import_jobs" WHERE "id" = ${jobId}
    `;
    expect(progress).toEqual({ next_number: 2, added: 1 });

    await sql`DELETE FROM "import_jobs" WHERE "id" = ${jobId}`;
  });

  it("finishes a processed range with failures as a done job", async () => {
    const jobId = `job-${randomUUID()}`;
    await sql`
      INSERT INTO "import_jobs" (
        "id", "novel_id", "kind", "status", "base_url", "from_number", "to_number",
        "next_number", "scrape_provider", "created_at", "updated_at"
      ) VALUES (
        ${jobId}, ${novelId}, 'scrape', 'running', 'https://www.quanben.io/n/abc/1.html', 1, 1,
        1, 'auto', now(), now()
      )
    `;

    await commitScrapeImportChapter(jobId, 1, { kind: "failed", error: "source unavailable" });
    await expect((await import("./job-store")).markImportJobDone(jobId)).resolves.toBe(true);

    const [job] = await sql`
      SELECT "status", "failed", "next_number", "error" FROM "import_jobs" WHERE "id" = ${jobId}
    `;
    expect(job).toMatchObject({
      status: "done",
      failed: 1,
      next_number: 2,
      error: "source unavailable",
    });

    await sql`DELETE FROM "import_jobs" WHERE "id" = ${jobId}`;
  });

  it("does not overwrite terminal import jobs after a late scrape failure", async () => {
    const { markImportJobError } = await import("./job-store");
    const terminalJobs = [
      ["done", "completed previously"],
      ["error", "earlier failure"],
      ["cancelled", "cancelled by the owner"],
    ] as const;

    for (const [status, existingError] of terminalJobs) {
      const jobId = `job-${randomUUID()}`;
      await sql`
        INSERT INTO "import_jobs" (
          "id", "novel_id", "kind", "status", "base_url", "from_number", "to_number",
          "next_number", "scrape_provider", "error", "created_at", "updated_at"
        ) VALUES (
          ${jobId}, ${novelId}, 'scrape', ${status}, 'https://www.quanben.io/n/abc/1.html',
          1, 1, 1, 'auto', ${existingError}, now(), now()
        )
      `;

      await expect(markImportJobError(jobId, "late scrape failure")).resolves.toBeUndefined();

      const [job] = await sql`
        SELECT "status", "error" FROM "import_jobs" WHERE "id" = ${jobId}
      `;
      expect(job).toEqual({ status, error: existingError });
      await sql`DELETE FROM "import_jobs" WHERE "id" = ${jobId}`;
    }
  });

  it("cancels an active import with a durable cancellation event", async () => {
    const result = await startScrapeImportForUser(
      userId,
      {
        novelId,
        baseUrl: "https://www.quanben.io/n/abc/1.html",
        from: 1,
        to: 1,
        provider: "auto",
      },
      async () => {},
    );
    const cancellation = await cancelImportJobForUser(userId, result.jobId, async () => {});
    expect(cancellation.cancelled).toBe(true);
    const [job] = await sql`SELECT "status" FROM "import_jobs" WHERE "id" = ${result.jobId}`;
    expect(job.status).toBe("cancelled");

    await deleteOutboxRows([...result.outboxIds, ...cancellation.outboxIds]);
    await sql`DELETE FROM "import_jobs" WHERE "id" = ${result.jobId}`;
  });
});
