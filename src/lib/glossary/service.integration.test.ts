import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres, { type Sql } from "postgres";

import type { GlossaryListInput } from "@/lib/glossary/schemas";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationDescribe = testDatabaseUrl ? describe : describe.skip;

let sql: Sql;
let listGlossaryTermsForUser: typeof import("./service").listGlossaryTermsForUser;
let updateGlossaryTermAtomic: typeof import("./service").updateGlossaryTermAtomic;

const defaultSearch: Omit<GlossaryListInput, "novelId"> = {
  q: "",
  category: "all",
  status: "approved",
  sort: "source",
  dir: "asc",
  page: 1,
  pageSize: 25,
};

function search(novelId: string, overrides: Partial<GlossaryListInput> = {}): GlossaryListInput {
  return { novelId, ...defaultSearch, ...overrides };
}

integrationDescribe("glossary pagination PostgreSQL contracts", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl!;
    process.env.BETTER_AUTH_SECRET ||= "test-secret-at-least-thirty-two-bytes";
    process.env.BETTER_AUTH_URL ||= "http://localhost:3000";
    process.env.APP_ENCRYPTION_KEY ||= "dGVzdC1rZXktMzItYnl0ZXMtbG9uZy1lbm91Z2g=";
    process.env.INNGEST_DEV ||= "1";

    sql = postgres(testDatabaseUrl!, { max: 10, onnotice: () => {} });
    ({ listGlossaryTermsForUser, updateGlossaryTermAtomic } = await import("./service"));
  });

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 1 });
  });

  it("filters, sorts, pages, clamps, and isolates glossary rows", async () => {
    const ownerUserId = `user-${randomUUID()}`;
    const otherUserId = `user-${randomUUID()}`;
    const novelId = `novel-${randomUUID()}`;
    const otherNovelId = `novel-${randomUUID()}`;
    const termRows = Array.from({ length: 60 }, (_, index) => ({
      id: `term-${String(index).padStart(4, "0")}`,
      source:
        index === 0 ? "alpha" : index === 1 ? "Alpha" : `Term ${String(index).padStart(2, "0")}`,
      target: index % 2 === 0 ? "Shared target" : `Thai ${index}`,
      category: (["character", "place", "skill", "item", "other"] as const)[index % 5],
      status: "approved" as const,
      note: `Note ${index}`,
    }));
    const pendingRows = Array.from({ length: 8 }, (_, index) => ({
      id: `pending-${String(index).padStart(4, "0")}`,
      source: `Pending ${String(index).padStart(2, "0")}`,
      target: `Suggestion ${index}`,
      category: "character" as const,
      status: "pending" as const,
      note: "AI suggestion",
    }));
    const rejectedRows = Array.from({ length: 8 }, (_, index) => ({
      id: `rejected-${String(index).padStart(4, "0")}`,
      source: `Rejected ${String(index).padStart(2, "0")}`,
      target: `Rejected target ${index}`,
      category: "other" as const,
      status: "rejected" as const,
      note: null,
    }));
    const terms = [...termRows, ...pendingRows, ...rejectedRows];
    const otherTermId = `other-term-${randomUUID()}`;

    await sql.begin(async (transaction) => {
      await transaction`
        INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at")
        VALUES
          (${ownerUserId}, 'Glossary Owner', ${`${ownerUserId}@example.test`}, true, now(), now()),
          (${otherUserId}, 'Other Owner', ${`${otherUserId}@example.test`}, true, now(), now())
      `;
      await transaction`
        INSERT INTO "novels" ("id", "user_id", "title", "source_lang", "target_lang", "created_at", "updated_at")
        VALUES
          (${novelId}, ${ownerUserId}, 'Glossary Fixture', 'zh', 'th', now(), now()),
          (${otherNovelId}, ${otherUserId}, 'Other Glossary Fixture', 'zh', 'th', now(), now())
      `;
      for (const term of terms) {
        await transaction`
          INSERT INTO "glossary_terms" ("id", "novel_id", "source", "target", "category", "note", "status")
          VALUES (${term.id}, ${novelId}, ${term.source}, ${term.target}, ${term.category}::glossary_term_category, ${term.note}, ${term.status}::glossary_term_status)
        `;
      }
      await transaction`
        INSERT INTO "glossary_terms" ("id", "novel_id", "source", "target", "category", "note", "status")
        VALUES (${otherTermId}, ${otherNovelId}, 'Private', 'ส่วนตัว', 'other'::glossary_term_category, null, 'approved'::glossary_term_status)
      `;
    });

    try {
      const firstPage = await listGlossaryTermsForUser(ownerUserId, search(novelId));
      expect(firstPage).toMatchObject({ rowCount: 60, page: 1, pageSize: 25 });
      expect(firstPage.rows).toHaveLength(25);
      expect(firstPage.rows[0]).toEqual({
        id: termRows[0].id,
        source: "alpha",
        target: "Shared target",
        category: "character",
        note: "Note 0",
        status: "approved",
      });
      expect(firstPage.rows.some((row) => "novelId" in row || "createdAt" in row)).toBe(false);

      const pendingPage = await listGlossaryTermsForUser(
        ownerUserId,
        search(novelId, { status: "pending", pageSize: 50 }),
      );
      expect(pendingPage.rowCount).toBe(8);
      expect(pendingPage.rows.every((row) => row.status === "pending")).toBe(true);

      const characterPage = await listGlossaryTermsForUser(
        ownerUserId,
        search(novelId, { category: "character", pageSize: 50 }),
      );
      expect(characterPage.rowCount).toBe(12);
      expect(characterPage.rows.every((row) => row.category === "character")).toBe(true);

      const searchedPage = await listGlossaryTermsForUser(
        ownerUserId,
        search(novelId, { q: "Suggestion", status: "all", pageSize: 50 }),
      );
      expect(searchedPage.rowCount).toBe(8);
      expect(searchedPage.rows.every((row) => row.target.includes("Suggestion"))).toBe(true);

      const pageTwo = await listGlossaryTermsForUser(
        ownerUserId,
        search(novelId, { page: 2, pageSize: 10 }),
      );
      expect(pageTwo.rows).toHaveLength(10);
      expect(pageTwo.rows[0]?.id).toBe(firstPage.rows[10]?.id);

      const bySourceAsc = await listGlossaryTermsForUser(
        ownerUserId,
        search(novelId, { sort: "source", dir: "asc", pageSize: 50 }),
      );
      const bySourceDesc = await listGlossaryTermsForUser(
        ownerUserId,
        search(novelId, { sort: "source", dir: "desc", pageSize: 50 }),
      );
      const bySourceDescLastPage = await listGlossaryTermsForUser(
        ownerUserId,
        search(novelId, { sort: "source", dir: "desc", page: 2, pageSize: 50 }),
      );
      expect(bySourceAsc.rows.slice(0, 2).map((row) => row.id)).toEqual([
        termRows[0].id,
        termRows[1].id,
      ]);
      expect(bySourceDesc.rows[0]?.source).toBe("Term 59");
      expect(bySourceDescLastPage.rows.slice(-2).map((row) => row.id)).toEqual([
        termRows[0].id,
        termRows[1].id,
      ]);

      const byTargetAsc = await listGlossaryTermsForUser(
        ownerUserId,
        search(novelId, { sort: "target", dir: "asc", pageSize: 50 }),
      );
      const byTargetDesc = await listGlossaryTermsForUser(
        ownerUserId,
        search(novelId, { sort: "target", dir: "desc", pageSize: 50 }),
      );
      expect(byTargetAsc.rows.slice(0, 2).map((row) => row.id)).toEqual([
        termRows[0].id,
        termRows[2].id,
      ]);
      expect(byTargetDesc.rows[0]?.target).toBe("Thai 9");
      expect(
        byTargetDesc.rows
          .filter((row) => row.target === "Shared target")
          .slice(0, 2)
          .map((row) => row.id),
      ).toEqual([termRows[0].id, termRows[2].id]);

      const byCategoryAsc = await listGlossaryTermsForUser(
        ownerUserId,
        search(novelId, { sort: "category", dir: "asc", pageSize: 50 }),
      );
      const byCategoryDesc = await listGlossaryTermsForUser(
        ownerUserId,
        search(novelId, { sort: "category", dir: "desc", pageSize: 50 }),
      );
      expect(byCategoryAsc.rows.slice(0, 2).map((row) => row.id)).toEqual([
        termRows[0].id,
        termRows[5].id,
      ]);
      expect(byCategoryDesc.rows.slice(0, 2).map((row) => row.id)).toEqual([
        termRows[4].id,
        termRows[9].id,
      ]);

      const byStatusAsc = await listGlossaryTermsForUser(
        ownerUserId,
        search(novelId, { status: "all", sort: "status", dir: "asc", pageSize: 50 }),
      );
      const byStatusAscLastPage = await listGlossaryTermsForUser(
        ownerUserId,
        search(novelId, { status: "all", sort: "status", dir: "asc", page: 2, pageSize: 50 }),
      );
      const byStatusDesc = await listGlossaryTermsForUser(
        ownerUserId,
        search(novelId, { status: "all", sort: "status", dir: "desc", pageSize: 50 }),
      );
      expect(byStatusAsc.rows.slice(0, 2).map((row) => row.id)).toEqual([
        termRows[0].id,
        termRows[1].id,
      ]);
      expect(byStatusAscLastPage.rows.at(-1)?.status).toBe("rejected");
      expect(byStatusDesc.rows.slice(0, 2).map((row) => row.id)).toEqual([
        rejectedRows[0].id,
        rejectedRows[1].id,
      ]);

      const zeroRows = await listGlossaryTermsForUser(
        ownerUserId,
        search(novelId, { q: "no such glossary term", page: 999 }),
      );
      expect(zeroRows).toMatchObject({ rowCount: 0, page: 1, rows: [] });

      await sql`DELETE FROM "glossary_terms" WHERE "novel_id" = ${novelId} AND "status" = 'approved' AND "id" LIKE 'term-%' AND "id" >= 'term-0025'`;
      const clamped = await listGlossaryTermsForUser(ownerUserId, search(novelId, { page: 999 }));
      expect(clamped.page).toBe(1);
      expect(clamped.rowCount).toBe(25);
      expect(clamped.rows).toHaveLength(25);

      await expect(listGlossaryTermsForUser(otherUserId, search(novelId))).rejects.toThrow(
        "Novel not found or unauthorized",
      );
    } finally {
      await sql`DELETE FROM "glossary_terms" WHERE "novel_id" = ${novelId} OR "novel_id" = ${otherNovelId}`;
      await sql`DELETE FROM "novels" WHERE "id" = ${novelId} OR "id" = ${otherNovelId}`;
      await sql`DELETE FROM "user" WHERE "id" = ${ownerUserId} OR "id" = ${otherUserId}`;
    }
  }, 30_000);

  it("propagates target changes while cancelling affected translations atomically", async () => {
    const ownerUserId = `user-${randomUUID()}`;
    const novelId = `novel-${randomUUID()}`;
    const termId = `term-${randomUUID()}`;
    const chapterId = `chapter-${randomUUID()}`;
    const jobId = `job-${randomUUID()}`;

    await sql.begin(async (transaction) => {
      await transaction`
        INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at")
        VALUES (${ownerUserId}, 'Glossary Propagation Owner', ${`${ownerUserId}@example.test`}, true, now(), now())
      `;
      await transaction`
        INSERT INTO "novels" ("id", "user_id", "title", "source_lang", "target_lang", "story_summary")
        VALUES (${novelId}, ${ownerUserId}, 'Propagation Fixture', 'zh', 'th', 'stale story summary')
      `;
      await transaction`
        INSERT INTO "glossary_terms" ("id", "novel_id", "source", "target", "category", "status")
        VALUES (${termId}, ${novelId}, '术语', 'Old Name', 'character'::glossary_term_category, 'approved'::glossary_term_status)
      `;
      await transaction`
        INSERT INTO "chapters"
          ("id", "novel_id", "number", "title", "raw_content", "translated_content", "status",
           "summary", "raw_char_count", "active_translation_job_id")
        VALUES
          (${chapterId}, ${novelId}, 1, 'Chapter 1', 'raw', 'Old Name appears here', 'translating',
           'stale chapter summary', 3, ${jobId})
      `;
      await transaction`
        INSERT INTO "translation_jobs"
          ("id", "chapter_id", "status", "source_revision", "generation", "total_chunks", "logs_json")
        VALUES (${jobId}, ${chapterId}, 'running'::translation_job_status, 1, 4, 1, '{malformed')
      `;
    });

    const dispatched: string[] = [];
    try {
      const snapshot = async () => {
        const [state] = await sql`
          SELECT row_to_json(t) AS term, row_to_json(c) AS chapter,
                 row_to_json(n) AS novel, row_to_json(j) AS job,
                 (SELECT count(*)::int FROM workflow_outbox
                  WHERE payload_json LIKE ${`%${jobId}%`}) AS outbox_count
          FROM glossary_terms t, chapters c, novels n, translation_jobs j
          WHERE t.id = ${termId} AND c.id = ${chapterId}
            AND n.id = ${novelId} AND j.id = ${jobId}
        `;
        return state;
      };
      const before = await snapshot();
      await expect(
        updateGlossaryTermAtomic(
          ownerUserId,
          { termId, target: " \t\n ", applyToChapters: true },
          async (id) => {
            dispatched.push(id);
          },
        ),
      ).rejects.toThrow();
      await expect(
        updateGlossaryTermAtomic(
          ownerUserId,
          { termId, source: " \t\n ", target: "New Name", applyToChapters: true },
          async (id) => {
            dispatched.push(id);
          },
        ),
      ).rejects.toThrow();
      expect(await snapshot()).toEqual(before);
      expect(dispatched).toEqual([]);

      await updateGlossaryTermAtomic(
        ownerUserId,
        { termId, target: " New Name ", applyToChapters: true },
        async (outboxId) => {
          dispatched.push(outboxId);
        },
      );

      const [chapter] = await sql`
        SELECT "translated_content", "status", "summary", "active_translation_job_id"
        FROM "chapters"
        WHERE "id" = ${chapterId}
      `;
      const [novel] = await sql`
        SELECT "story_summary"
        FROM "novels"
        WHERE "id" = ${novelId}
      `;
      const [term] = await sql`
        SELECT "target"
        FROM "glossary_terms"
        WHERE "id" = ${termId}
      `;
      const [job] = await sql`
        SELECT "status", "logs_json"
        FROM "translation_jobs"
        WHERE "id" = ${jobId}
      `;
      const outbox = await sql`
        SELECT "id", "event_name", "payload_json"
        FROM "workflow_outbox"
        WHERE "event_name" = 'translation/job.cancelled'
          AND "payload_json" LIKE ${`%${jobId}%`}
      `;

      expect(chapter).toMatchObject({
        translated_content: "New Name appears here",
        status: "translated",
        summary: null,
        active_translation_job_id: null,
      });
      expect(novel?.story_summary).toBeNull();
      expect(term?.target).toBe("New Name");
      expect(job?.status).toBe("cancelled");
      expect(job?.logs_json).toContain(
        "Translation cancelled because glossary terms were propagated.",
      );
      expect(outbox).toHaveLength(1);
      expect(JSON.parse(outbox[0]!.payload_json)).toEqual({ jobId, generation: 4 });
      expect(dispatched).toEqual([outbox[0]!.id]);
    } finally {
      await sql`DELETE FROM "workflow_outbox" WHERE "payload_json" LIKE ${`%${jobId}%`}`;
      await sql`DELETE FROM "novels" WHERE "id" = ${novelId}`;
      await sql`DELETE FROM "user" WHERE "id" = ${ownerUserId}`;
    }
  }, 30_000);

  it.each(["", " \t\n "])(
    "repairs a legacy blank target %j without changing chapter work",
    async (oldTarget) => {
      const ownerUserId = `user-${randomUUID()}`;
      const novelId = `novel-${randomUUID()}`;
      const termId = `term-${randomUUID()}`;
      const chapterId = `chapter-${randomUUID()}`;
      const jobId = `job-${randomUUID()}`;
      await sql.begin(async (tx) => {
        await tx`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
        VALUES (${ownerUserId}, 'Legacy Owner', ${`${ownerUserId}@example.test`}, true, now(), now())`;
        await tx`INSERT INTO novels (id, user_id, title, source_lang, target_lang, story_summary)
        VALUES (${novelId}, ${ownerUserId}, 'Legacy Fixture', 'zh', 'th', 'story summary')`;
        await tx`INSERT INTO glossary_terms (id, novel_id, source, target, category, status)
        VALUES (${termId}, ${novelId}, 'Alpha', ${oldTarget}, 'other', 'approved')`;
        await tx`INSERT INTO chapters
        (id, novel_id, number, title, raw_content, translated_content, status, summary,
         raw_char_count, active_translation_job_id)
        VALUES (${chapterId}, ${novelId}, 1, 'Chapter', 'raw', ${`Prose ${oldTarget} remains`},
          'translating', 'chapter summary', 3, ${jobId})`;
        await tx`INSERT INTO translation_jobs (id, chapter_id, status, generation, total_chunks)
        VALUES (${jobId}, ${chapterId}, 'running', 4, 1)`;
      });
      try {
        const snapshot = async () => {
          const [state] = await sql`SELECT row_to_json(c) AS chapter, row_to_json(n) AS novel,
          row_to_json(j) AS job FROM chapters c, novels n, translation_jobs j
          WHERE c.id = ${chapterId} AND n.id = ${novelId} AND j.id = ${jobId}`;
          return state;
        };
        const before = await snapshot();
        const dispatched: string[] = [];
        await expect(
          updateGlossaryTermAtomic(
            ownerUserId,
            {
              termId,
              target: " Beta ",
              applyToChapters: true,
            },
            async (id) => {
              dispatched.push(id);
            },
          ),
        ).resolves.toEqual({ success: true });
        const [term] =
          await sql`SELECT source, target, category, status FROM glossary_terms WHERE id = ${termId}`;
        expect(term).toEqual({
          source: "Alpha",
          target: "Beta",
          category: "other",
          status: "approved",
        });
        expect(await snapshot()).toEqual(before);
        expect(dispatched).toEqual([]);
        const events =
          await sql`SELECT id FROM workflow_outbox WHERE payload_json LIKE ${`%${jobId}%`}`;
        expect(events).toEqual([]);
      } finally {
        await sql`DELETE FROM workflow_outbox WHERE payload_json LIKE ${`%${jobId}%`}`;
        await sql`DELETE FROM novels WHERE id = ${novelId}`;
        await sql`DELETE FROM "user" WHERE id = ${ownerUserId}`;
      }
    },
  );
});
