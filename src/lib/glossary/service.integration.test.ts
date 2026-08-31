import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres, { type Sql } from "postgres";

import type { GlossaryListInput } from "@/lib/glossary/schemas";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationDescribe = testDatabaseUrl ? describe : describe.skip;

let sql: Sql;
let listGlossaryTermsForUser: typeof import("./service").listGlossaryTermsForUser;

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
    ({ listGlossaryTermsForUser } = await import("./service"));
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
});
