import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { type Sql } from "postgres";

import {
  closeIntegrationDatabase,
  describeIntegration,
  openIntegrationDatabase,
} from "@/test/integration";

/**
 * The catalog directory's PostgreSQL contracts.
 *
 * These are the properties the old client-side filter could not have: a page boundary that
 * neither repeats nor skips a row, a search that finds a Thai fragment inside a Thai word,
 * a total that describes the filtered set rather than the page, and visibility that is the
 * query's rather than the caller's. The pure vocabulary tests live beside the module; what
 * is here is what only a database can answer.
 */

let sql: Sql;
let listCatalogForViewer: typeof import("@/lib/content/novel/catalog.service.server").listCatalogForViewer;
let resolveAuthorId: typeof import("@/lib/content/novel/author.service.server").resolveAuthorId;
let mergeAuthorsForOperator: typeof import("@/lib/content/novel/author.service.server").mergeAuthorsForOperator;
let setNovelTagsForUser: typeof import("@/lib/content/novel/tag.service.server").setNovelTagsForUser;
let catalogInputSchema: typeof import("@/lib/content/novel/catalog.schemas").catalogInputSchema;

const PAST = new Date("2025-01-01T00:00:00.000Z");
const FUTURE = new Date("2099-01-01T00:00:00.000Z");

interface Fixture {
  /** A per-run token, because the template database is shared with whatever ran before. */
  token: string;
  ownerId: string;
  otherOwnerId: string;
  liveIds: string[];
  thaiNovelId: string;
  draftId: string;
  scheduledId: string;
  taggedNovelId: string;
  authorNovelId: string;
}

function input(overrides: Record<string, unknown> = {}) {
  return catalogInputSchema.parse({ scope: "public", page: 1, ...overrides });
}

async function seed(): Promise<Fixture> {
  const token = randomUUID().slice(0, 8);
  const ownerId = `user-${randomUUID()}`;
  const otherOwnerId = `user-${randomUUID()}`;
  await sql`
    INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at")
    VALUES
      (${ownerId}, 'Catalog Owner', ${`${ownerId}@example.test`}, true, now(), now()),
      (${otherOwnerId}, 'Other Owner', ${`${otherOwnerId}@example.test`}, true, now(), now())
  `;

  // Twenty-six live novels, so a full page (24) and a partial one are both real.
  const liveIds: string[] = [];
  for (let index = 0; index < 26; index++) {
    const id = `novel-${randomUUID()}`;
    liveIds.push(id);
    await sql`
      INSERT INTO "novels" (
        "id", "user_id", "title", "author", "description", "source_lang", "target_lang",
        "published_at", "created_at", "updated_at"
      ) VALUES (
        ${id}, ${ownerId}, ${`Novel ${token} ${String(index).padStart(2, "0")}`},
        ${`Author ${token}`}, ${index === 0 ? "d".repeat(500) : null}, 'en', 'th',
        ${PAST}, ${new Date(PAST.getTime() + index * 60_000)}, now()
      )
    `;
  }

  const thaiNovelId = `novel-${randomUUID()}`;
  const draftId = `novel-${randomUUID()}`;
  const scheduledId = `novel-${randomUUID()}`;
  const taggedNovelId = `novel-${randomUUID()}`;
  const authorNovelId = `novel-${randomUUID()}`;

  await sql`
    INSERT INTO "novels" (
      "id", "user_id", "title", "original_title", "author", "source_lang", "target_lang",
      "published_at", "created_at", "updated_at"
    ) VALUES
      (${thaiNovelId}, ${ownerId}, ${`สนุกมาก${token} ภาคสอง`}, ${`The Long River ${token}`}, ${`นักเขียนไทย ${token}`}, 'en', 'th', ${PAST}, now(), now()),
      (${draftId}, ${ownerId}, ${`A Draft Nobody Sees ${token}`}, null, ${`Draft Author ${token}`}, 'en', 'th', null, now(), now()),
      (${scheduledId}, ${ownerId}, ${`A Scheduled Novel ${token}`}, null, ${`Draft Author ${token}`}, 'en', 'th', ${FUTURE}, now(), now()),
      (${taggedNovelId}, ${ownerId}, ${`Tagged Novel ${token}`}, null, ${`Author ${token}`}, 'zh', 'en', ${PAST}, now(), now()),
      (${authorNovelId}, ${otherOwnerId}, ${`Three-Body ${token}`}, '三体', ${`Liu Cixin ${token}`}, 'zh', 'en', ${PAST}, now(), now())
  `;

  return {
    token,
    ownerId,
    otherOwnerId,
    liveIds,
    thaiNovelId,
    draftId,
    scheduledId,
    taggedNovelId,
    authorNovelId,
  };
}

async function cleanup(fixture: Fixture): Promise<void> {
  // Tags outlive their own rows on purpose — the vocabulary is not per-novel — so the
  // fixture removes the ones it created rather than trusting the cascade.
  await sql`DELETE FROM "tags" WHERE "slug" LIKE ${`%${fixture.token}%`}`;
  await sql`DELETE FROM "user" WHERE "id" IN (${fixture.ownerId}, ${fixture.otherOwnerId})`;
}

describeIntegration("catalog directory PostgreSQL contracts", () => {
  beforeAll(async () => {
    ({ sql } = openIntegrationDatabase(import.meta.url, { connections: 5 }));
    ({ listCatalogForViewer } = await import("@/lib/content/novel/catalog.service.server"));
    ({ resolveAuthorId, mergeAuthorsForOperator } =
      await import("@/lib/content/novel/author.service.server"));
    ({ setNovelTagsForUser } = await import("@/lib/content/novel/tag.service.server"));
    ({ catalogInputSchema } = await import("@/lib/content/novel/catalog.schemas"));
  });

  afterAll(closeIntegrationDatabase);

  it("pages a directory without repeating or skipping a row, and totals the filtered set", async () => {
    const fixture = await seed();
    try {
      // Scoped by this run's token, because the template database carries whatever a
      // previous suite left in it; the assertion is about paging, not about the template.
      const first = await listCatalogForViewer(null, input({ page: 1, q: fixture.token }));
      const second = await listCatalogForViewer(null, input({ page: 2, q: fixture.token }));

      // 26 loop novels + the Thai one + the tagged one + the other owner's = 29 live.
      expect(first.novels).toHaveLength(24);
      expect(first.total).toBe(29);
      expect(first.hasMore).toBe(true);
      expect(second.novels).toHaveLength(5);
      expect(second.hasMore).toBe(false);

      // A card clamps to two lines, so the directory sends a preview rather than the
      // stored 5,000-character field. The detail read still returns the whole text.
      // The previewed novel is the oldest, so it lands on the second page.
      const preview = second.novels.find((novel) => novel.id === fixture.liveIds[0])?.description;
      expect(preview).toHaveLength(280);
      expect(preview?.endsWith("…")).toBe(true);

      const ids = [...first.novels, ...second.novels].map((novel) => novel.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).not.toContain(fixture.draftId);
      expect(ids).not.toContain(fixture.scheduledId);

      // The title sort is the one order that depends on the reader's language: this is the
      // Thai collation path. It has to page like every other sort, and it has to agree with
      // the collator the browser used to apply to the same titles.
      const titlePage = (page: number) =>
        listCatalogForViewer(null, input({ page, q: fixture.token, sort: "title", locale: "th" }));
      const byTitle = await titlePage(1);
      const byTitleSecond = await titlePage(2);
      expect(byTitle.total).toBe(29);
      expect(byTitle.novels).toHaveLength(24);

      const titles = [...byTitle.novels, ...byTitleSecond.novels].map((novel) => novel.title);
      expect(titles).toHaveLength(29);
      expect(titles).toEqual(titles.toSorted(new Intl.Collator("th").compare));
    } finally {
      await cleanup(fixture);
    }
  });

  it("finds a Thai fragment inside a Thai word, and matches the author text", async () => {
    const fixture = await seed();
    try {
      // A fragment of the middle of a Thai word, which is the case `to_tsvector` cannot
      // answer: the title has no spaces there, so only substring matching finds it.
      const thai = await listCatalogForViewer(null, input({ q: `มาก${fixture.token}` }));
      expect(thai.novels.map((novel) => novel.id)).toEqual([fixture.thaiNovelId]);

      // The original title is part of the searched expression, not only the display title.
      const byOriginal = await listCatalogForViewer(
        null,
        input({ q: `The Long River ${fixture.token}` }),
      );
      expect(byOriginal.novels.map((novel) => novel.id)).toEqual([fixture.thaiNovelId]);

      const byAuthor = await listCatalogForViewer(null, input({ q: `liu cixin ${fixture.token}` }));
      expect(byAuthor.novels.map((novel) => novel.id)).toEqual([fixture.authorNovelId]);
      expect(byAuthor.total).toBe(1);

      // A wildcard a reader types is a character, not a pattern.
      const percent = await listCatalogForViewer(null, input({ q: `%${fixture.token}` }));
      expect(percent.total).toBe(0);
    } finally {
      await cleanup(fixture);
    }
  });

  it("shows drafts and scheduled novels only to their owner", async () => {
    const fixture = await seed();
    try {
      const guest = await listCatalogForViewer(null, input({ page: 1 }));
      expect(guest.novels.map((novel) => novel.id)).not.toContain(fixture.draftId);
      expect(guest.novels.map((novel) => novel.id)).not.toContain(fixture.scheduledId);

      // 26 loop novels + the Thai one + the tagged one + a draft + a scheduled = 30.
      const mine = await listCatalogForViewer(fixture.ownerId, input({ scope: "mine" }));
      expect(mine.total).toBe(30);
      const drafts = await listCatalogForViewer(
        fixture.ownerId,
        input({ scope: "mine", publication: "draft" }),
      );
      expect(drafts.novels.map((novel) => novel.id)).toEqual([fixture.draftId]);

      // "mine" never widens to the catalog: another account's live novel is not in it.
      expect(mine.novels.map((novel) => novel.id)).not.toContain(fixture.authorNovelId);
      // A session that is gone yields nothing rather than the public list.
      const anonymousMine = await listCatalogForViewer(null, input({ scope: "mine" }));
      expect(anonymousMine.total).toBe(0);
    } finally {
      await cleanup(fixture);
    }
  });

  it("writes tags as a set and filters by one", async () => {
    const fixture = await seed();
    try {
      // Three spellings of two tags: the vocabulary folds them to two applications.
      await setNovelTagsForUser(fixture.ownerId, {
        novelId: fixture.taggedNovelId,
        tags: [
          `Xianxia ${fixture.token}`,
          `Cultivation ${fixture.token}`,
          `xianxia ${fixture.token}`,
        ],
      });
      const rows = await sql<{ slug: string }[]>`
        SELECT t."slug" FROM "novel_tags" nt
        INNER JOIN "tags" t ON t."id" = nt."tag_id"
        WHERE nt."novel_id" = ${fixture.taggedNovelId}
        ORDER BY t."slug"
      `;
      // The duplicate spelling collapsed: one tag, one application.
      expect(rows.map((row) => row.slug)).toEqual([
        `cultivation-${fixture.token}`,
        `xianxia-${fixture.token}`,
      ]);

      const filtered = await listCatalogForViewer(null, input({ tag: `xianxia-${fixture.token}` }));
      expect(filtered.novels.map((novel) => novel.id)).toEqual([fixture.taggedNovelId]);
      expect(filtered.novels[0]?.tags.map((tag) => tag.name)).toEqual([
        `Cultivation ${fixture.token}`,
        `Xianxia ${fixture.token}`,
      ]);

      // Replacing the set removes what was not sent.
      await setNovelTagsForUser(fixture.ownerId, {
        novelId: fixture.taggedNovelId,
        tags: [`Cultivation ${fixture.token}`],
      });
      const afterReplace = await listCatalogForViewer(
        null,
        input({ tag: `xianxia-${fixture.token}` }),
      );
      expect(afterReplace.total).toBe(0);
    } finally {
      await cleanup(fixture);
    }
  });

  it("resolves one author row per spelling and merges duplicates across novels", async () => {
    const fixture = await seed();
    try {
      const first = await resolveAuthorId(`Liu Cixin ${fixture.token}`);
      const again = await resolveAuthorId(`  liu   cixin   ${fixture.token}  `);
      expect(first).not.toBeNull();
      expect(again).toBe(first);
      if (!first) throw new Error("author resolution returned no row");

      const other = await resolveAuthorId(`LIU CIXIN ${fixture.token}!`);
      expect(other).not.toBe(first);
      if (!other) throw new Error("author resolution returned no row");
      await sql`
        UPDATE "novels" SET "author_id" = ${other}
        WHERE "id" = ${fixture.authorNovelId}
      `;

      const merged = await mergeAuthorsForOperator(other, first);
      expect(merged.moved).toBe(1);

      const grouped = await listCatalogForViewer(null, input({ authorId: first }));
      expect(grouped.novels.map((novel) => novel.id)).toEqual([fixture.authorNovelId]);
      // The merge rewrote the text too, so the two columns cannot disagree.
      const [row] = await sql<{ author: string }[]>`
        SELECT "author" FROM "novels" WHERE "id" = ${fixture.authorNovelId}
      `;
      expect(row?.author).toBe(`Liu Cixin ${fixture.token}`);
    } finally {
      await cleanup(fixture);
    }
  });
});
