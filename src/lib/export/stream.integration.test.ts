import { randomUUID } from "node:crypto";

import { strFromU8, unzipSync } from "fflate";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationDescribe = testDatabaseUrl ? describe : describe.skip;

let sql: Sql;
let createNovelExportResponse: typeof import("./stream").createNovelExportResponse;

async function seedExportFixture() {
  const userId = `user-${randomUUID()}`;
  const otherUserId = `user-${randomUUID()}`;
  const novelId = `novel-${randomUUID()}`;

  await sql`
    INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at")
    VALUES
      (${userId}, 'Export Owner', ${`${userId}@example.test`}, true, now(), now()),
      (${otherUserId}, 'Other User', ${`${otherUserId}@example.test`}, true, now(), now())
  `;
  await sql`
    INSERT INTO "novels" (
      "id", "user_id", "title", "author", "source_lang", "target_lang", "created_at", "updated_at"
    ) VALUES (${novelId}, ${userId}, 'A/B: Novel', 'Test Author', 'zh', 'en', now(), now())
  `;
  await sql`
    INSERT INTO "chapters" (
      "id", "novel_id", "number", "title", "translated_title", "raw_content",
      "translated_content", "raw_char_count", "status"
    ) VALUES
      (${`chapter-${randomUUID()}`}, ${novelId}, 2, 'Raw second', 'Second', 'raw 2', 'Second body.', 5, 'translated'),
      (${`chapter-${randomUUID()}`}, ${novelId}, 1, 'Raw first', 'First', 'raw 1', 'First body.\n\nNext paragraph.', 5, 'translated'),
      (${`chapter-${randomUUID()}`}, ${novelId}, 3, 'Raw only', null, 'raw 3', null, 5, 'raw')
  `;

  return { userId, otherUserId, novelId };
}

integrationDescribe("streaming novel exports", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl!;
    process.env.BETTER_AUTH_SECRET ||= "test-secret-at-least-thirty-two-bytes";
    process.env.BETTER_AUTH_URL ||= "http://localhost:3000";
    process.env.APP_ENCRYPTION_KEY ||= "dGVzdC1rZXktMzItYnl0ZXMtbG9uZy1lbm91Z2g=";
    process.env.INNGEST_DEV ||= "1";

    sql = postgres(testDatabaseUrl!, { max: 2, onnotice: () => {} });
    ({ createNovelExportResponse } = await import("./stream"));
  });

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 1 });
  });

  it("streams translated chapters in numeric order with private download headers", async () => {
    const fixture = await seedExportFixture();
    try {
      const response = await createNovelExportResponse(fixture.novelId, fixture.userId, "txt");
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("content-type")).toContain("text/plain");
      expect(response.headers.get("content-disposition")).toContain('filename="AB Novel.txt"');

      const body = await response.text();
      expect(body).toContain("A/B: Novel\nby Test Author");
      expect(body.indexOf("Chapter 1 — First")).toBeLessThan(body.indexOf("Chapter 2 — Second"));
      expect(body).not.toContain("Raw only");
    } finally {
      await sql`DELETE FROM "user" WHERE "id" IN (${fixture.userId}, ${fixture.otherUserId})`;
    }
  });

  it("returns headers without opening a body for HEAD semantics", async () => {
    const fixture = await seedExportFixture();
    try {
      const response = await createNovelExportResponse(
        fixture.novelId,
        fixture.userId,
        "epub",
        false,
      );
      expect(response.status).toBe(200);
      expect(response.body).toBeNull();
      expect(response.headers.get("content-type")).toBe("application/epub+zip");
    } finally {
      await sql`DELETE FROM "user" WHERE "id" IN (${fixture.userId}, ${fixture.otherUserId})`;
    }
  });

  it("does not expose another user's novel", async () => {
    const fixture = await seedExportFixture();
    try {
      const response = await createNovelExportResponse(fixture.novelId, fixture.otherUserId, "txt");
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain("First body");
    } finally {
      await sql`DELETE FROM "user" WHERE "id" IN (${fixture.userId}, ${fixture.otherUserId})`;
    }
  });

  it("streams a valid EPUB with ordered chapter entries", async () => {
    const fixture = await seedExportFixture();
    try {
      const response = await createNovelExportResponse(fixture.novelId, fixture.userId, "epub");
      const entries = unzipSync(new Uint8Array(await response.arrayBuffer()));
      expect(strFromU8(entries.mimetype)).toBe("application/epub+zip");
      expect(strFromU8(entries["OEBPS/chapter-1.xhtml"])).toContain("First body.");
      expect(strFromU8(entries["OEBPS/chapter-2.xhtml"])).toContain("Second body.");
      expect(Object.keys(entries).some((name) => name.endsWith("chapter-3.xhtml"))).toBe(false);
    } finally {
      await sql`DELETE FROM "user" WHERE "id" IN (${fixture.userId}, ${fixture.otherUserId})`;
    }
  });
});
