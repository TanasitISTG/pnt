import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { novels } from "./novels";

/**
 * Novel reviews: a 1-5 rating with an optional written body.
 *
 * One live review per account per novel, enforced by the partial unique index rather
 * than by a read-then-write check. The index is partial so a review an operator removed
 * stops blocking the author: they can post a fresh one, while the removed row keeps the
 * record and leaves every average.
 *
 * The body is optional on purpose - rating takes one tap, and writing is an invitation,
 * not a toll. `removed_at` mirrors the comment tombstone: a decision records, removal is
 * a separate audited enforcement step.
 */
export const reviews = pgTable(
  "reviews",
  {
    id: text("id").primaryKey(),
    novelId: text("novel_id")
      .notNull()
      .references(() => novels.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    rating: integer("rating").notNull(),
    /** Max length is `REVIEW_BODY_MAX_LENGTH` in `@/lib/reviews/schemas`. */
    body: text("body"),
    editedAt: timestamp("edited_at"),
    removedAt: timestamp("removed_at"),
    removedById: text("removed_by_id"),
    removedByEmail: text("removed_by_email"),
    removalReason: text("removal_reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("reviews_novel_user_live_uidx")
      .on(table.novelId, table.userId)
      .where(sql`${table.removedAt} is null`),
    index("reviews_novel_created_idx").on(table.novelId, table.createdAt),
    index("reviews_user_id_idx").on(table.userId),
    check("reviews_rating_check", sql`${table.rating} between 1 and 5`),
    check(
      "reviews_body_length_check",
      sql`${table.body} is null or char_length(${table.body}) <= 2000`,
    ),
  ],
);
