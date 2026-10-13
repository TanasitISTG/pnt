import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, type AnyPgColumn } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { chapters, novels } from "./novels";

/**
 * Chapter discussion comments.
 *
 * One level of replies: a top-level comment has `parent_id` null, a reply points at a
 * top-level comment, and the service refuses anything deeper. `novel_id` is denormalized
 * beside the chapter so the operator queue and the report case can reach the novel
 * without a three-table join, and so a novel deletion takes its whole discussion.
 *
 * `user_id` is nullable because deleting an account must not take other readers' replies
 * with it: the account's own comments are tombstoned by the deletion hook and then the
 * foreign key nulls the author, leaving the thread readable as "Deleted account".
 *
 * `body` is nullable for the same reason - a tombstoned row has no words left - and the
 * check below keeps every rendered comment nonblank. `deleted_at` is an author
 * tombstone; `removed_at` records an operator's removal, which is an enforcement
 * action separate from the report decision that prompted it.
 */
export const comments = pgTable(
  "comments",
  {
    id: text("id").primaryKey(),
    chapterId: text("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    novelId: text("novel_id")
      .notNull()
      .references(() => novels.id, { onDelete: "cascade" }),
    /** The author; null once the account is deleted, so replies outlive it. */
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    /** Null for a top-level comment; a reply's parent is always top-level. */
    parentId: text("parent_id").references((): AnyPgColumn => comments.id, {
      onDelete: "cascade",
    }),
    /** Max length is `COMMENT_BODY_MAX_LENGTH` in `@/lib/comments/schemas`. */
    body: text("body"),
    editedAt: timestamp("edited_at"),
    /** Set when the author deletes a comment that has replies. */
    deletedAt: timestamp("deleted_at"),
    /** Operator removal, snapshotted like every other moderation decision. */
    removedAt: timestamp("removed_at"),
    removedById: text("removed_by_id"),
    removedByEmail: text("removed_by_email"),
    removalReason: text("removal_reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("comments_chapter_parent_created_idx").on(
      table.chapterId,
      table.parentId,
      table.createdAt,
    ),
    index("comments_novel_id_idx").on(table.novelId),
    index("comments_user_id_idx").on(table.userId),
    check(
      "comments_body_length_check",
      sql`${table.body} is null or char_length(${table.body}) <= 2000`,
    ),
    check(
      "comments_body_present_check",
      sql`${table.body} is not null or ${table.deletedAt} is not null`,
    ),
  ],
);
