import "@tanstack/react-start/server-only";

import { and, asc, count, eq, ilike, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { novelAuthors, novels } from "@/lib/db/schema";
import { novelLive } from "@/lib/content/publish/publish";
import { encodeMessage } from "@/lib/i18n/message-code";
import { SafeServerError } from "@/lib/server-fn-error";
import { nanoid } from "@/lib/utils";
import type { CatalogAuthor } from "./catalog.types";

/**
 * Authors, from the text a publisher types to the identity the directory groups by.
 *
 * `novels.author` is free text and two publishers spell one name two ways, so the identity
 * is a row: `normalized_name` makes the same spelling resolve to the same row every time,
 * and its unique index is what stops two accounts saving the same author concurrently from
 * producing two rows. Everything the catalog groups by reads `author_id`, never the text.
 */

/**
 * The fold a normalized name is stored under.
 *
 * It is deliberately only trim, collapse and lowercase: SQL can reproduce it exactly, and
 * the backfill migration does. Unicode composition is left alone for that reason — the
 * application and the migration must agree byte for byte or one author becomes two rows.
 */
export function normalizeAuthorName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/** The display name as the publisher typed it, without the whitespace noise around it. */
function displayAuthorName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * The canonical row for a typed name, created on first use.
 *
 * Resolution runs before the novel's own write rather than inside its transaction: the
 * upsert is idempotent, and an author row that no novel ends up naming is inert — it has no
 * page anything links to and no count. Making the write wait on it would buy nothing.
 */
export async function resolveAuthorId(
  rawAuthor: string | null | undefined,
): Promise<string | null> {
  const display = rawAuthor ? displayAuthorName(rawAuthor) : "";
  if (!display) return null;

  const normalized = normalizeAuthorName(display);
  const [inserted] = await db
    .insert(novelAuthors)
    .values({ id: nanoid(), name: display, normalizedName: normalized })
    .onConflictDoNothing({ target: novelAuthors.normalizedName })
    .returning({ id: novelAuthors.id });
  if (inserted) return inserted.id;

  // Lost the race, or the author already existed: the row is the answer either way.
  const [existing] = await db
    .select({ id: novelAuthors.id })
    .from(novelAuthors)
    .where(eq(novelAuthors.normalizedName, normalized))
    .limit(1);
  return existing?.id ?? null;
}

/** The author as a reader sees them: a name and how many live novels carry it. */
export async function getAuthorForViewer(authorId: string): Promise<CatalogAuthor | null> {
  const [row] = await db
    .select({
      id: novelAuthors.id,
      name: novelAuthors.name,
      novelCount: count(novels.id),
    })
    .from(novelAuthors)
    .leftJoin(novels, and(eq(novels.authorId, novelAuthors.id), novelLive()))
    .where(eq(novelAuthors.id, authorId))
    .groupBy(novelAuthors.id, novelAuthors.name)
    .limit(1);

  if (!row) return null;
  return { id: row.id, name: row.name, novelCount: Number(row.novelCount ?? 0) };
}

/**
 * Folds one author into another.
 *
 * The novels are repointed and their `author` text is rewritten to the target's spelling in
 * the same statement, so a merge leaves no row still claiming the old name — which is the
 * whole reason the text column stays beside the identity. The source row is then deleted; a
 * novel still pointing at it would be impossible, because the foreign key sets null.
 */
export async function mergeAuthorsForOperator(
  fromAuthorId: string,
  intoAuthorId: string,
): Promise<{ moved: number; name: string }> {
  if (fromAuthorId === intoAuthorId) {
    throw new SafeServerError(encodeMessage("errors.authorMergeSame"));
  }

  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({ id: novelAuthors.id, name: novelAuthors.name })
      .from(novelAuthors)
      .where(eq(novelAuthors.id, intoAuthorId))
      .limit(1);
    const [source] = await tx
      .select({ id: novelAuthors.id })
      .from(novelAuthors)
      .where(eq(novelAuthors.id, fromAuthorId))
      .limit(1);
    if (!target || !source) {
      throw new SafeServerError(encodeMessage("errors.authorNotFound"));
    }

    const moved = await tx
      .update(novels)
      .set({ authorId: intoAuthorId, author: target.name })
      .where(eq(novels.authorId, fromAuthorId))
      .returning({ id: novels.id });
    await tx.delete(novelAuthors).where(eq(novelAuthors.id, fromAuthorId));

    return { moved: moved.length, name: target.name };
  });
}

/**
 * Author candidates for a merge, by name. Operator-only and deliberately small: a merge is
 * a correction of a duplicate, and ten answers named after what was typed is enough to
 * recognize the one it should fold into.
 */
export async function searchAuthorsForOperator(
  term: string,
): Promise<{ id: string; name: string }[]> {
  const query = term.trim();
  if (query.length < 2) return [];
  return db
    .select({ id: novelAuthors.id, name: novelAuthors.name })
    .from(novelAuthors)
    .where(
      ilike(novelAuthors.name, `%${query.replace(/[\\%_]/g, (character) => `\\${character}`)}%`),
    )
    .orderBy(asc(novelAuthors.name))
    .limit(10);
}

/**
 * Every author with at least one live novel, for the sitemap.
 *
 * Authors of drafts are absent for the same reason their novels are: a URL in the sitemap is
 * a promise that an anonymous reader can open it.
 */
export async function listAuthorsWithLiveNovels(): Promise<
  { id: string; updatedAt: Date | null }[]
> {
  return db
    .select({ id: novelAuthors.id, updatedAt: sql<Date | null>`max(${novels.updatedAt})` })
    .from(novelAuthors)
    .innerJoin(novels, eq(novels.authorId, novelAuthors.id))
    .where(novelLive())
    .groupBy(novelAuthors.id)
    .orderBy(asc(novelAuthors.id));
}
