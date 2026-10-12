import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import type { AdminActionDetail } from "@/lib/admin/audit";

/**
 * Append-only record of what operators did to whose account.
 *
 * The actor and target addresses are snapshotted into the row on purpose: a row has
 * to stay readable after the account it names is deleted, so nothing here is a
 * foreign key and nothing is joined at read time. Rows are only ever inserted.
 */
export const adminAuditLog = pgTable(
  "admin_audit_log",
  {
    id: text("id").primaryKey(),
    actorId: text("actor_id").notNull(),
    actorEmail: text("actor_email"),
    /** One of the `ADMIN_ACTIONS` values; a plain string, as no enum guards the vocabulary. */
    action: text("action").notNull(),
    targetUserId: text("target_user_id"),
    targetEmail: text("target_email"),
    detail: jsonb("detail").$type<AdminActionDetail | null>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("admin_audit_log_created_at_idx").on(table.createdAt),
    index("admin_audit_log_target_user_id_idx").on(table.targetUserId),
  ],
);
