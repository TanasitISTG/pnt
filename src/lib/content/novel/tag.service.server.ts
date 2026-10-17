import "@tanstack/react-start/server-only";

import { and, asc, desc, eq, inArray, notInArray, sql, count } from "drizzle-orm";

import { db } from "@/lib/db";
import { novelTags, novels, tags } from "@/lib/db/schema";
import { novelLive } from "@/lib/content/publish/publish";
import { encodeMessage } from "@/lib/i18n/message-code";
import { SafeServerError } from "@/lib/server-fn-error";
import { nanoid } from "@/lib/utils";
import { MAX_NOVEL_TAGS, setNovelTagsSchema } from "./catalog.schemas";
import type { CatalogTag, CatalogTagRef } from "./catalog.types";

/**
 * The tag vocabulary.
 *
 * A tag is a row, not a string on the novel: the catalog filter offers "every novel tagged
 * `xianxia`", and that only works if one spelling is one thing. `slug` is the identity and
 * is Unicode-preserving, so a Thai tag keeps a readable, linkable form in the query string
 * instead of being folded to nothing.
 */

export function slugifyTag(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s/?#&]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * The tags in use by live novels, with how many carry each.
 *
 * Only live novels count: the filter must never advertise a tag whose only novels a guest
 * cannot open. The list is bounded because it is a filter row, not an index.
 */
export async function listCatalogTags(): Promise<CatalogTag[]> {
  const rows = await db
    .select({ slug: tags.slug, name: tags.name, count: count() })
    .from(novelTags)
    .innerJoin(tags, eq(novelTags.tagId, tags.id))
    .innerJoin(novels, eq(novelTags.novelId, novels.id))
    .where(novelLive())
    .groupBy(tags.slug, tags.name)
    .orderBy(desc(sql<number>`count(*)`), asc(tags.slug))
    .limit(60);

  return rows.map((row) => ({ slug: row.slug, name: row.name, count: Number(row.count ?? 0) }));
}

/**
 * Replaces a novel's tags.
 *
 * The write is a set, not a diff from the client: the request says what the novel should
 * carry, and one transaction converges to it. The novel row is locked first, so two saves
 * racing each other cannot interleave into a set neither asked for.
 */
export async function setNovelTagsForUser(
  userId: string,
  rawInput: unknown,
): Promise<{ tags: CatalogTagRef[] }> {
  const input = setNovelTagsSchema.parse(rawInput);
  const desired = new Map<string, string>();
  for (const value of input.tags) {
    const slug = slugifyTag(value);
    const name = value.trim().replace(/\s+/g, " ");
    if (slug && name && !desired.has(slug)) desired.set(slug, name);
  }
  if (desired.size > MAX_NOVEL_TAGS) {
    throw new SafeServerError(encodeMessage("validation.tooManyTags", { max: MAX_NOVEL_TAGS }));
  }

  return db.transaction(async (tx) => {
    const [owned] = await tx
      .select({ id: novels.id })
      .from(novels)
      .where(and(eq(novels.id, input.novelId), eq(novels.userId, userId)))
      .limit(1)
      .for("update");
    if (!owned) {
      throw new SafeServerError(encodeMessage("errors.novelNotFoundOrUnauthorized"));
    }

    const tagIds: string[] = [];
    for (const [slug, name] of desired) {
      const [inserted] = await tx
        .insert(tags)
        .values({ id: nanoid(), slug, name })
        .onConflictDoNothing({ target: tags.slug })
        .returning({ id: tags.id });
      if (inserted) {
        tagIds.push(inserted.id);
        continue;
      }
      const [existing] = await tx
        .select({ id: tags.id })
        .from(tags)
        .where(eq(tags.slug, slug))
        .limit(1);
      if (existing) tagIds.push(existing.id);
    }

    await tx
      .delete(novelTags)
      .where(
        and(
          eq(novelTags.novelId, input.novelId),
          tagIds.length > 0 ? notInArray(novelTags.tagId, tagIds) : undefined,
        ),
      );
    if (tagIds.length > 0) {
      await tx
        .insert(novelTags)
        .values(tagIds.map((tagId) => ({ novelId: input.novelId, tagId })))
        .onConflictDoNothing();
    }

    return { tags: [...desired].map(([slug, name]) => ({ slug, name })) };
  });
}

/** A novel's tags, for a read that wants them beside the novel itself. */
export async function listTagsForNovel(novelId: string): Promise<CatalogTagRef[]> {
  if (!novelId) return [];
  const rows = await db
    .select({ slug: tags.slug, name: tags.name })
    .from(novelTags)
    .innerJoin(tags, eq(novelTags.tagId, tags.id))
    .where(eq(novelTags.novelId, novelId))
    .orderBy(asc(tags.name));
  return rows;
}

/** Tags for a set of novels, keyed by novel, for a page of cards. */
export async function listTagsForNovels(
  novelIds: readonly string[],
): Promise<Map<string, CatalogTagRef[]>> {
  const result = new Map<string, CatalogTagRef[]>();
  if (novelIds.length === 0) return result;
  const rows = await db
    .select({ novelId: novelTags.novelId, slug: tags.slug, name: tags.name })
    .from(novelTags)
    .innerJoin(tags, eq(novelTags.tagId, tags.id))
    .where(inArray(novelTags.novelId, [...novelIds]))
    .orderBy(asc(tags.name));
  for (const row of rows) {
    const list = result.get(row.novelId) ?? [];
    list.push({ slug: row.slug, name: row.name });
    result.set(row.novelId, list);
  }
  return result;
}
