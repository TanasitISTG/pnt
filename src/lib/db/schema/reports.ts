import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { novels } from "./novels";

/**
 * Content reports filed by members against published content.
 *
 * A report is the member's claim, not a verdict: the row keeps what was reported and
 * what the operator decided, and nothing here hides or alters the content itself.
 *
 * The novel title and its owner are snapshotted into the row the way the audit trail
 * snapshots addresses: a case has to stay legible after the novel is renamed, and
 * after the novel is deleted the row must still say what was reported. `novel_id` is
 * therefore nullable and cleared on delete, while the snapshot stays.
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
    novelId: text("novel_id").references(() => novels.id, { onDelete: "set null" }),
    /** The reported novel's title as it read when the report was filed. */
    reportedNovelTitle: text("reported_novel_title"),
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
    index("reports_status_created_at_idx").on(table.status, table.createdAt),
    index("reports_reporter_user_id_idx").on(table.reporterUserId),
    // One open report per account per novel. Reporting again after a decision is
    // allowed - that is how a member says "this is still wrong" - but a case cannot be
    // stacked by reopening the dialog.
    uniqueIndex("reports_open_reporter_novel_uidx")
      .on(table.reporterUserId, table.novelId)
      .where(sql`${table.status} = 'open' and ${table.novelId} is not null`),
  ],
);
