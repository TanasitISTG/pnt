import { randomUUID } from "node:crypto";

import { strFromU8, unzipSync } from "fflate";
import { type Sql } from "postgres";
import { afterAll, beforeAll, expect, it } from "vitest";

import {
  closeIntegrationDatabase,
  describeIntegration,
  openIntegrationDatabase,
} from "@/test/integration";

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

describeIntegration("streaming novel exports", () => {
  beforeAll(async () => {
    ({ sql } = openIntegrationDatabase(import.meta.url, { connections: 2 }));
    ({ createNovelExportResponse } = await import("./stream"));
  });

  afterAll(closeIntegrationDatabase);

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
        [...body.matchAll(/Chapter (\d+): Title (\d+)/g)].map((match) => [
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
        expect(nav).toContain(`Chapter ${number}: Title ${number}</a>`);
        const chapter = strFromU8(entries[`OEBPS/chapter-${number}.xhtml`]);
        expect(chapter).toContain(`Chapter ${number}: Title ${number}`);
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
