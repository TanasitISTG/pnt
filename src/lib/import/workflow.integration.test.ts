import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres, { type Sql } from "postgres";
import { sql as drizzleSql } from "drizzle-orm";
import type * as NovelLocks from "@/lib/db/novel-lock";
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
let novelLocks: typeof NovelLocks;

function pauseNextNovelGate(novelId: string) {
  const original = novelLocks.lockNovelForMutation;
  let release!: () => void;
  let acquired!: (pid: number) => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const locked = new Promise<number>((resolve) => {
    acquired = resolve;
  });
  let claimed = false;
  const spy = vi
    .spyOn(novelLocks, "lockNovelForMutation")
    .mockImplementation(async (tx, id, userId) => {
      const result = await original(tx, id, userId);
      if (result && id === novelId && !claimed) {
        claimed = true;
        const rows = await tx.execute<{ pid: number }>(drizzleSql`SELECT pg_backend_pid() AS pid`);
        acquired(rows[0].pid);
        await released;
      }
      return result;
    });
  return { locked, release, restore: () => spy.mockRestore() };
}

// Real database waits cannot use fake timers; this is a failure deadline, never a scheduling delay.
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Novel gate barrier timed out")), 5_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitForNovelWaiter(blockerPid: number) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const rows = await sql`
      SELECT pid FROM pg_stat_activity
      WHERE ${blockerPid} = ANY(pg_blocking_pids(pid))
        AND wait_event_type = 'Lock'
        AND query LIKE '%for update%'
        AND query LIKE '%novels%'
    `;
    if (rows.length > 0) return;
  }
  throw new Error("Competing mutation never waited on the novel gate");
}

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

    // Defer server-only imports until DATABASE_URL points to the disposable database.
    novelLocks = await import("@/lib/db/novel-lock");
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

  it.each(["delete", "import"] as const)(
    "serializes %s-first scrape commit versus novel deletion",
    async (winner) => {
      // Import after beforeAll has selected the disposable database.
      const { deleteNovelForUser } = await import("@/lib/content/novel/novel-edit.service");
      const parentId = `novel-${randomUUID()}`;
      const jobId = `job-${randomUUID()}`;
      await sql`INSERT INTO "novels" ("id", "user_id", "title", "source_lang", "target_lang")
      VALUES (${parentId}, ${userId}, 'Scrape deletion race', 'zh', 'en')`;
      await sql`INSERT INTO "import_jobs"
      ("id", "novel_id", "kind", "status", "base_url", "from_number", "to_number", "next_number", "scrape_provider")
      VALUES (${jobId}, ${parentId}, 'scrape', 'running', 'https://www.quanben.io/n/book/1.html', 1, 1, 1, 'auto')`;
      const gate = pauseNextNovelGate(parentId);
      const pending: Promise<unknown>[] = [];
      let committedChapter = false;
      const commit = async () => {
        const result = await commitScrapeImportChapter(jobId, 1, {
          kind: "added",
          number: "1",
          title: "Imported",
          content: "Imported body",
        });
        committedChapter = result.created;
        return result;
      };
      let dispatchSnapshot: number[] | undefined;
      const remove = () =>
        deleteNovelForUser(userId, parentId, async () => {
          dispatchSnapshot = [
            (await sql`SELECT "id" FROM "novels" WHERE "id" = ${parentId}`).length,
            (await sql`SELECT "id" FROM "import_jobs" WHERE "id" = ${jobId}`).length,
          ];
        });
      try {
        const first = winner === "delete" ? remove() : commit();
        pending.push(first);
        const pid = await bounded(gate.locked);
        const second = winner === "delete" ? commit() : remove();
        pending.push(second);
        await waitForNovelWaiter(pid);
        // The waiting participant has not locked the child job before its novel gate.
        await sql.begin(async (tx) => {
          await tx`SELECT "id" FROM "import_jobs" WHERE "id" = ${jobId} FOR UPDATE NOWAIT`;
        });
        gate.release();
        const results = await bounded(Promise.all([first, second]));
        expect(dispatchSnapshot).toEqual([0, 0]);
        expect(results[winner === "delete" ? 1 : 0]).toEqual(
          winner === "delete" ? { stop: true, created: false } : { stop: false, created: true },
        );
        expect(committedChapter).toBe(winner === "import");
        expect(await sql`SELECT "id" FROM "chapters" WHERE "novel_id" = ${parentId}`).toHaveLength(
          0,
        );
        const events = await sql`SELECT "event_name", "payload_json" FROM "workflow_outbox"
        WHERE "payload_json"::jsonb ->> 'jobId' = ${jobId}`;
        expect(events.map((row) => row.event_name)).toEqual(["scrape/import.cancelled"]);
        expect(JSON.parse(events[0].payload_json)).toEqual({ jobId });
      } finally {
        gate.release();
        await Promise.allSettled(pending);
        gate.restore();
        await sql`DELETE FROM "workflow_outbox" WHERE "payload_json"::jsonb ->> 'jobId' = ${jobId}`;
        await sql`DELETE FROM "novels" WHERE "id" = ${parentId}`;
      }
    },
  );
});
