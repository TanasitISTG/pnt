import { sql } from "drizzle-orm";
import { index, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { chapters, novels } from "./novels";
import { comments } from "./comments";
import { reports } from "./reports";

/**
 * What a notification is about. The kind decides which link column is set and which
 * sentence the interface renders; a new event is a new value here, never a new table.
 */
export const notificationKindEnum = pgEnum("notification_kind", [
  "chapter_published",
  "comment_reply",
  "novel_comment",
  "novel_review",
  "report_decided",
]);

/**
 * One delivered notification, read from the account that received it.
 *
 * The row is the truth and a realtime message is only a hint to refetch, which is what
 * makes a dropped socket harmless. Every target column is nullable and cleared on delete,
 * and the title/excerpt is snapshotted, so a notification outlives the chapter, comment or
 * case it names — the same rule the report queue follows.
 *
 * `dedupe_key` is the target's identity (`chapter:<id>`, `comment:<id>`, `report:<id>`) under
 * a unique index per account. It is what makes a publish fan-out idempotent: a sweep that
 * runs twice inserts the row once, so a scheduled chapter never notifies twice.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: notificationKindEnum("kind").notNull(),
    /** The target's identity under `unique(user_id, dedupe_key)`; see the module note. */
    dedupeKey: text("dedupe_key").notNull(),
    novelId: text("novel_id").references(() => novels.id, { onDelete: "set null" }),
    chapterId: text("chapter_id").references(() => chapters.id, { onDelete: "set null" }),
    commentId: text("comment_id").references(() => comments.id, { onDelete: "set null" }),
    reportId: text("report_id").references(() => reports.id, { onDelete: "set null" }),
    /** The novel's title when the notification was written, so a deleted novel still reads. */
    novelTitle: text("novel_title").notNull(),
    /** The chapter title or the comment excerpt; null when the event has nothing to quote. */
    detail: text("detail"),
    /** `upheld` | `dismissed` for a decided report, null for every other kind. */
    outcome: text("outcome"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    readAt: timestamp("read_at"),
  },
  (table) => [
    // The bell reads newest-first per account; `id` keeps the order stable across a tie.
    index("notifications_user_created_idx").on(table.userId, table.createdAt, table.id),
    // The unread badge asks only for the rows the first index would then filter.
    index("notifications_user_unread_idx")
      .on(table.userId)
      .where(sql`${table.readAt} is null`),
    uniqueIndex("notifications_user_dedupe_uidx").on(table.userId, table.dedupeKey),
  ],
);
