import "@tanstack/react-start/server-only";

import {
  and,
  asc,
  count,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  sql,
  type SQL,
} from "drizzle-orm";

import { db } from "@/lib/db";
import { chapters, novels, novelTags, tags } from "@/lib/db/schema";
import { chapterVisibleToGuests, novelLive } from "@/lib/content/publish/publish";
import { resolvePublicCover } from "@/lib/content/novel/cover-storage.server";
import { CATALOG_PAGE_SIZE, type CatalogInput } from "./catalog.schemas";
import type { CatalogNovel, CatalogPage, CatalogTagRef } from "./catalog.types";

/**
 * A card clamps its description to two lines. Sending the stored 5,000-character field
 * so the browser could throw most of it away was the catalog's largest avoidable
 * transfer; the novel page still reads the full text.
 */
export const CATALOG_DESCRIPTION_PREVIEW_LENGTH = 280;

/**
 * The catalog directory's one read path.
 *
 * Three properties are the reason this module exists rather than a `.limit()` on the old
 * list query:
 *
 *  - **The page is the bound.** Rows, chapter counts and tags are all narrowed to the
 *    twenty-four novels being returned, so the work per request is the same at thirty novels
 *    and at thirty thousand.
 *  - **Filtering is the database's.** Search, language, tag and author are predicates, which
 *    is what lets `total` describe the filtered set and the client stop holding the table.
 *  - **Ordering is total.** Every sort ends with `id`, so a page boundary can neither repeat
 *    nor skip a row when two novels share a timestamp.
 *
 * Visibility is the one rule that must never be restated: the public scope is `novelLive()`
 * and nothing else, and the `mine` scope is the viewer's own id. A guest can only ever reach
 * the first, and the publication filter is applied only inside the second.
 */

/**
 * The expression the trigram index is built on. It has to match `novels_search_trgm_idx`
 * exactly or the planner will not use it, which is why it is built once here rather than
 * inline in a predicate.
 */
const searchText = sql<string>`lower(coalesce(${novels.title}, '') || ' ' || coalesce(${novels.originalTitle}, '') || ' ' || coalesce(${novels.author}, ''))`;

/**
 * `%` and `_` are wildcards a reader may legitimately type ("100%"), so they are escaped
 * rather than refused: a search for `100%` should look for those three characters.
 */
function likePattern(term: string): string {
  const escaped = term.replace(/[\\%_]/g, (character) => `\\${character}`);
  return `%${escaped.toLowerCase()}%`;
}

/** ICU collations the title sort may use, and whether this server has each one. */
const collationPresence = new Map<string, boolean>();

async function hasCollation(name: string): Promise<boolean> {
  const cached = collationPresence.get(name);
  if (cached !== undefined) return cached;
  const rows = await db.execute<{ present: boolean }>(
    sql`select exists (select 1 from pg_collation where collname = ${name}) as present`,
  );
  const present = Boolean(rows[0]?.present);
  collationPresence.set(name, present);
  return present;
}

/**
 * A title sort is the one place the interface language touches the data: `th-x-icu` orders
 * Thai titles the way a Thai reader expects, while the database's default collation orders
 * them by code point. A server without that collation falls back to the default rather than
 * failing the page.
 */
async function titleOrder(locale: CatalogInput["locale"]): Promise<SQL> {
  const collation = locale === "th" && (await hasCollation("th-x-icu")) ? "th-x-icu" : null;
  return collation
    ? sql`${novels.title} collate ${sql.raw(`"${collation}"`)} asc nulls last`
    : sql`${novels.title} asc nulls last`;
}

function orderFor(input: CatalogInput): Promise<SQL[]> | SQL[] {
  switch (input.sort) {
    case "updated":
      // `nulls last` matches the index's own declaration; `updated_at` is not nullable
      // today, but the sort must not depend on that staying true.
      return [sql`${novels.updatedAt} desc nulls last`, asc(novels.id)];
    case "title":
      return (async () => [await titleOrder(input.locale), asc(novels.id)])();
    default:
      return [sql`${novels.createdAt} desc nulls last`, asc(novels.id)];
  }
}

export async function listCatalogForViewer(
  viewerId: string | null,
  input: CatalogInput,
): Promise<CatalogPage> {
  const now = new Date();
  const ownOnly = input.scope === "mine" && viewerId !== null;

  // Without a session `mine` yields nothing instead of falling back to a public filter, so
  // an expired session can never widen the query.
  if (input.scope === "mine" && viewerId === null) {
    return { novels: [], total: 0, page: input.page, pageSize: CATALOG_PAGE_SIZE, hasMore: false };
  }

  const conditions: (SQL | undefined)[] = [ownOnly ? eq(novels.userId, viewerId) : novelLive(now)];

  if (ownOnly && input.publication !== "all") {
    conditions.push(
      input.publication === "draft"
        ? isNull(novels.publishedAt)
        : input.publication === "scheduled"
          ? and(isNotNull(novels.publishedAt), gt(novels.publishedAt, now))
          : and(isNotNull(novels.publishedAt), lte(novels.publishedAt, now)),
    );
  }

  if (input.language) {
    const [sourceLang, targetLang] = input.language.split("->");
    conditions.push(eq(novels.sourceLang, sourceLang), eq(novels.targetLang, targetLang));
  }

  if (input.authorId) conditions.push(eq(novels.authorId, input.authorId));

  if (input.tag) {
    conditions.push(
      inArray(
        novels.id,
        db
          .select({ novelId: novelTags.novelId })
          .from(novelTags)
          .innerJoin(tags, eq(novelTags.tagId, tags.id))
          .where(eq(tags.slug, input.tag)),
      ),
    );
  }

  const term = input.q?.trim() ?? "";
  if (term) conditions.push(sql`${searchText} like ${likePattern(term)}`);

  const where = and(...conditions);

  const [totalRow] = await db.select({ value: count() }).from(novels).where(where);
  const total = Number(totalRow?.value ?? 0);

  const rows = await db
    .select({
      id: novels.id,
      title: novels.title,
      originalTitle: novels.originalTitle,
      author: novels.author,
      authorId: novels.authorId,
      description: sql<string | null>`case
        when length(${novels.description}) > ${CATALOG_DESCRIPTION_PREVIEW_LENGTH}
          then left(${novels.description}, ${CATALOG_DESCRIPTION_PREVIEW_LENGTH - 1}) || '…'
        else ${novels.description}
      end`,
      sourceLang: novels.sourceLang,
      targetLang: novels.targetLang,
      publishedAt: novels.publishedAt,
      createdAt: novels.createdAt,
      updatedAt: novels.updatedAt,
      hasCover: sql<number>`case when ${novels.coverKey} is not null then 1 else 0 end`,
      coverKey: novels.coverKey,
    })
    .from(novels)
    .where(where)
    .orderBy(...(await orderFor(input)))
    .limit(CATALOG_PAGE_SIZE)
    .offset((input.page - 1) * CATALOG_PAGE_SIZE);

  const ids = rows.map((row) => row.id);
  const aggregates =
    ids.length === 0
      ? []
      : await db
          .select({
            novelId: chapters.novelId,
            chapterCount: sql<number>`count(*)::int`,
            translatedCount: sql<number>`count(case when ${chapters.status} = 'translated' then 1 end)::int`,
          })
          .from(chapters)
          .where(
            and(
              inArray(chapters.novelId, ids),
              // The public count is what a guest can actually read; the owner's own shelf
              // counts every chapter, published or not.
              ownOnly ? undefined : chapterVisibleToGuests(now),
            ),
          )
          .groupBy(chapters.novelId);

  const tagRows =
    ids.length === 0
      ? []
      : await db
          .select({ novelId: novelTags.novelId, slug: tags.slug, name: tags.name })
          .from(novelTags)
          .innerJoin(tags, eq(novelTags.tagId, tags.id))
          .where(inArray(novelTags.novelId, ids))
          .orderBy(asc(tags.name));

  const countsByNovel = new Map(aggregates.map((row) => [row.novelId, row]));
  const tagsByNovel = new Map<string, CatalogTagRef[]>();
  for (const row of tagRows) {
    const list = tagsByNovel.get(row.novelId) ?? [];
    list.push({ slug: row.slug, name: row.name });
    tagsByNovel.set(row.novelId, list);
  }

  const novelsPage: CatalogNovel[] = rows.map((row) => {
    const cover = resolvePublicCover(row.coverKey, row.publishedAt);
    const counted = countsByNovel.get(row.id);
    const { coverKey: _coverKey, ...item } = row;
    return {
      ...item,
      chapterCount: Number(counted?.chapterCount ?? 0),
      translatedCount: Number(counted?.translatedCount ?? 0),
      hasCover: Number(row.hasCover || 0),
      coverUrl: cover?.url ?? null,
      coverSrcSet: cover?.srcSet ?? null,
      tags: tagsByNovel.get(row.id) ?? [],
    };
  });

  return {
    novels: novelsPage,
    total,
    page: input.page,
    pageSize: CATALOG_PAGE_SIZE,
    hasMore: input.page * CATALOG_PAGE_SIZE < total,
  };
}
