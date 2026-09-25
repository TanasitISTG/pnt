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
  for (const number of [12, 2, 10, 1, 7, 3, 11, 5, 9, 4, 8, 6]) {
    await sql`
      INSERT INTO "chapters" (
        "id", "novel_id", "number", "title", "translated_title", "raw_content",
        "translated_content", "raw_char_count", "status"
      ) VALUES (
        ${`chapter-${randomUUID()}`}, ${novelId}, ${number}, ${`Raw ${number}`},
        ${`Title ${number}`}, 'raw', ${`Unique body ${number}.`}, 3, 'translated'
      )
    `;
  }
  for (const [index, content] of [null, "", " \t\n "].entries()) {
    await sql`
      INSERT INTO "chapters" ("id", "novel_id", "number", "title", "raw_content",
        "translated_content", "raw_char_count", "status")
      VALUES (${`chapter-${randomUUID()}`}, ${novelId}, ${13 + index}, 'Ineligible',
        'raw', ${content}, 3, 'raw')
    `;
  }

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
      expect(
        [...body.matchAll(/Chapter (\d+) — Title (\d+)/g)].map((match) => [
          Number(match[1]),
          Number(match[2]),
        ]),
      ).toEqual(Array.from({ length: 12 }, (_, index) => [index + 1, index + 1]));
      for (let number = 1; number <= 12; number++) {
        expect(body.split(`Unique body ${number}.`)).toHaveLength(2);
      }
      expect(body).not.toContain("Ineligible");
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
      const nav = strFromU8(entries["OEBPS/nav.xhtml"]);
      const opf = strFromU8(entries["OEBPS/content.opf"]);
      const numbers = Array.from({ length: 12 }, (_, index) => index + 1);
      expect([...nav.matchAll(/href="chapter-(\d+)\.xhtml"/g)].map((m) => Number(m[1]))).toEqual(
        numbers,
      );
      expect([...opf.matchAll(/idref="ch(\d+)"/g)].map((m) => Number(m[1]))).toEqual(numbers);
      for (const number of numbers) {
        expect(nav).toContain(`Chapter ${number} — Title ${number}</a>`);
        const chapter = strFromU8(entries[`OEBPS/chapter-${number}.xhtml`]);
        expect(chapter).toContain(`Chapter ${number} — Title ${number}`);
        expect(chapter).toContain(`Unique body ${number}.`);
      }
      expect(Object.keys(entries).filter((name) => /chapter-\d+\.xhtml$/.test(name))).toHaveLength(
        12,
      );
    } finally {
      await sql`DELETE FROM "user" WHERE "id" IN (${fixture.userId}, ${fixture.otherUserId})`;
    }
  });
});
