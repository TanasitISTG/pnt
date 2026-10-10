import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres, { type Sql } from "postgres";
import type * as AdminDetail from "@/lib/content/novel/admin-novel-detail.service";
import type * as Publish from "@/lib/content/publish/publish.service";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationDescribe = testDatabaseUrl ? describe : describe.skip;

let sql: Sql;
let getAdminNovelDetailCoreForUser: typeof AdminDetail.getAdminNovelDetailCoreForUser;
let setChapterPublishedForUser: typeof Publish.setChapterPublishedForUser;
let setAllChaptersPublishedForUser: typeof Publish.setAllChaptersPublishedForUser;

const PAST = "2000-01-01T00:00:00.000Z";
const FUTURE = "2999-01-01T00:00:00.000Z";

type PublicationFixture = {
  ownerUserId: string;
  otherUserId: string;
  novelId: string;
  chapterIds: string[];
};

async function seedFixture(): Promise<PublicationFixture> {
  const ownerUserId = `user-${randomUUID()}`;
  const otherUserId = `user-${randomUUID()}`;
  const novelId = `novel-${randomUUID()}`;
  const chapterIds = Array.from({ length: 7 }, () => `chapter-${randomUUID()}`);
  const chapters = [
    { status: "raw", translatedContent: null, publishedAt: PAST },
    { status: "queued", translatedContent: null, publishedAt: PAST },
    { status: "translating", translatedContent: null, publishedAt: PAST },
    { status: "error", translatedContent: "Old translation", publishedAt: PAST },
    { status: "translated", translatedContent: "   \n\t", publishedAt: PAST },
    { status: "translated", translatedContent: "Scheduled translation", publishedAt: FUTURE },
    { status: "translated", translatedContent: "Ready translation", publishedAt: PAST },
  ];

  await sql`
    INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at")
    VALUES
      (${ownerUserId}, 'Publication Owner', ${`${ownerUserId}@example.test`}, true, now(), now()),
      (${otherUserId}, 'Other Owner', ${`${otherUserId}@example.test`}, true, now(), now())
  `;
  await sql`
    INSERT INTO "novels" (
      "id", "user_id", "title", "source_lang", "target_lang", "published_at", "created_at", "updated_at"
    ) VALUES (${novelId}, ${ownerUserId}, 'Publication Fixture', 'en', 'th', ${PAST}, now(), now())
  `;

  for (const [index, chapter] of chapters.entries()) {
    await sql`
      INSERT INTO "chapters" (
        "id", "novel_id", "number", "title", "raw_content", "translated_content", "status",
        "raw_char_count", "published_at", "created_at", "updated_at"
      ) VALUES (
        ${chapterIds[index]}, ${novelId}, ${index + 1}, ${`Chapter ${index + 1}`}, 'Raw source',
        ${chapter.translatedContent}, ${chapter.status}, 10, ${chapter.publishedAt}, now(), now()
      )
    `;
  }

  return { ownerUserId, otherUserId, novelId, chapterIds };
}

async function guestVisibleChapterIds(novelId: string): Promise<string[]> {
  const rows = await sql<{ id: string }[]>`
    SELECT c."id"
    FROM "chapters" c
    INNER JOIN "novels" n ON n."id" = c."novel_id"
    WHERE n."id" = ${novelId}
      AND n."published_at" <= now()
      AND c."published_at" <= now()
      AND c."status" = 'translated'
      AND c."translated_content" IS NOT NULL
      AND regexp_replace(c."translated_content", '[[:space:]]', '', 'g') <> ''
    ORDER BY c."number"
  `;
  return rows.map((row) => row.id);
}

async function cleanupFixture(fixture: PublicationFixture): Promise<void> {
  await sql`DELETE FROM "user" WHERE "id" IN (${fixture.ownerUserId}, ${fixture.otherUserId})`;
}

integrationDescribe("translation-aware publication PostgreSQL invariants", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl!;
    process.env.BETTER_AUTH_SECRET ||= "test-secret-at-least-thirty-two-bytes";
    process.env.BETTER_AUTH_URL ||= "http://localhost:3000";
    process.env.APP_ENCRYPTION_KEY ||= "dGVzdC1rZXktMzItYnl0ZXMtbG9uZy1lbm91Z2g=";
    process.env.INNGEST_DEV ||= "1";
    sql = postgres(testDatabaseUrl!, { max: 10, onnotice: () => {} });
    ({ getAdminNovelDetailCoreForUser } =
      await import("@/lib/content/novel/admin-novel-detail.service"));
    ({ setChapterPublishedForUser, setAllChaptersPublishedForUser } =
      await import("@/lib/content/publish/publish.service"));
  });

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 1 });
  });

  it("rejects foreign and deleted chapter publication without changing other rows", async () => {
    const fixture = await seedFixture();
    try {
      await expect(
        setChapterPublishedForUser(fixture.otherUserId, {
          chapterId: fixture.chapterIds[6],
          publishedAt: null,
        }),
      ).rejects.toThrow("Chapter not found or unauthorized");
      expect(await guestVisibleChapterIds(fixture.novelId)).toEqual([fixture.chapterIds[6]]);
      await sql`DELETE FROM "chapters" WHERE "id" = ${fixture.chapterIds[6]}`;
      await expect(
        setChapterPublishedForUser(fixture.ownerUserId, {
          chapterId: fixture.chapterIds[6],
          publishedAt: new Date(PAST),
        }),
      ).rejects.toThrow("Chapter not found or unauthorized");
      expect(await guestVisibleChapterIds(fixture.novelId)).toEqual([]);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("keeps guest visibility and admin access aligned across every chapter state", async () => {
    const fixture = await seedFixture();
    try {
      expect(await guestVisibleChapterIds(fixture.novelId)).toEqual([fixture.chapterIds[6]]);

      const adminCore = await getAdminNovelDetailCoreForUser(fixture.ownerUserId, fixture.novelId);
      expect(adminCore?.chapters.map((chapter) => chapter.id)).toEqual(fixture.chapterIds);
      await expect(
        getAdminNovelDetailCoreForUser(fixture.otherUserId, fixture.novelId),
      ).resolves.toBeNull();

      await expect(
        setChapterPublishedForUser(fixture.ownerUserId, {
          chapterId: fixture.chapterIds[0]!,
          publishedAt: new Date(PAST),
        }),
      ).rejects.toThrow("Translate the chapter before publishing.");

      await expect(
        setChapterPublishedForUser(fixture.ownerUserId, {
          chapterId: fixture.chapterIds[0]!,
          publishedAt: null,
        }),
      ).resolves.toEqual({ id: fixture.chapterIds[0] });

      await expect(
        setAllChaptersPublishedForUser(fixture.otherUserId, fixture.novelId, new Date(PAST)),
      ).rejects.toThrow("Novel not found or unauthorized");

      await expect(
        setAllChaptersPublishedForUser(fixture.ownerUserId, fixture.novelId, new Date(PAST)),
      ).resolves.toEqual({ id: fixture.novelId, published: 2, skipped: 5 });
      await expect(
        setAllChaptersPublishedForUser(fixture.ownerUserId, fixture.novelId, null),
      ).resolves.toEqual({ id: fixture.novelId, unpublished: 7 });
      expect(await guestVisibleChapterIds(fixture.novelId)).toEqual([]);
    } finally {
      await cleanupFixture(fixture);
    }
  }, 30_000);
});
