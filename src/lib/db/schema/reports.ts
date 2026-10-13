import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { comments } from "./comments";
import { novels } from "./novels";
import { reviews } from "./reviews";

/**
 * Content reports filed by members against published content.
 *
 * A report is the member's claim, not a verdict: the row keeps what was reported and
 * what the operator decided, and nothing here hides or alters the content itself.
 *
 * Three targets exist - a novel, a comment, and a review - and `target_type` says which
 * one the row is about. Only that target's column is populated (`novel_id`, `comment_id`,
 * or `review_id`), which is what keeps the case key and the one-open-report indexes
 * unambiguous; the parent novel of a comment or review is reached through its own row,
 * and its title snapshot below keeps the case legible once that row is gone.
 *
 * The title, the excerpt, and the target's owner are snapshotted into the row the way
 * the audit trail snapshots addresses: a case has to stay legible after the content is
 * renamed or edited, and after it is deleted the row must still say what was reported.
 * The target columns are nullable and cleared on delete, while the snapshots stay.
 *
 * The reporter keeps only a foreign key, because they are an account we still have;
 * deleting that account takes its reports with it.
 */
export const reports = pgTable(
  "reports",
  {
    id: text("id").primaryKey(),
    reporterUserId: text("reporter_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** One of the `REPORT_TARGET_TYPES` values; a plain string, as no enum guards the vocabulary. */
    targetType: text("target_type").notNull(),
    /** The novel itself, for a novel report; null for every other target and on delete. */
    novelId: text("novel_id").references(() => novels.id, { onDelete: "set null" }),
    /** The reported comment; null for other targets and once the comment is deleted. */
    commentId: text("comment_id").references(() => comments.id, { onDelete: "set null" }),
    /** The reported review; null for other targets and once the review is deleted. */
    reviewId: text("review_id").references(() => reviews.id, { onDelete: "set null" }),
    /** The reported novel's title as it read when the report was filed. */
    reportedNovelTitle: text("reported_novel_title"),
    /**
     * The reported words as they read when the report was filed: a comment body or a
     * review body, capped by the writer. A novel report leaves this null.
     */
    reportedExcerpt: text("reported_excerpt"),
    /** The novel's owner at that moment; the account whose conduct the case is about. */
    reportedUserId: text("reported_user_id"),
    /** One of the `REPORT_REASONS` values. */
    reason: text("reason").notNull(),
    details: text("details"),
    /** "open" | "upheld" | "dismissed" - see `REPORT_STATUSES`. */
    status: text("status").notNull().default("open"),
    resolutionNote: text("resolution_note"),
    /** Operator identity, snapshotted like the audit trail so the decision survives deletion. */
    resolvedById: text("resolved_by_id"),
    resolvedByEmail: text("resolved_by_email"),
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("reports_novel_id_idx").on(table.novelId),
    index("reports_comment_id_idx").on(table.commentId),
    index("reports_review_id_idx").on(table.reviewId),
    index("reports_status_created_at_idx").on(table.status, table.createdAt),
    index("reports_reporter_user_id_idx").on(table.reporterUserId),
    // One open report per account per target. Reporting again after a decision is
    // allowed - that is how a member says "this is still wrong" - but a case cannot be
    // stacked by reopening the dialog.
    uniqueIndex("reports_open_reporter_novel_uidx")
      .on(table.reporterUserId, table.novelId)
      .where(sql`${table.status} = 'open' and ${table.novelId} is not null`),
    uniqueIndex("reports_open_reporter_comment_uidx")
      .on(table.reporterUserId, table.commentId)
      .where(sql`${table.status} = 'open' and ${table.commentId} is not null`),
    uniqueIndex("reports_open_reporter_review_uidx")
      .on(table.reporterUserId, table.reviewId)
      .where(sql`${table.status} = 'open' and ${table.reviewId} is not null`),
  ],
);
