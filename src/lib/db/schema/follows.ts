import { index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { novels } from "./novels";

/**
 * A reader's subscription to a novel they do not own.
 *
 * Following is a reader relation, not a workspace one: it hangs off a novel the viewer may
 * merely be reading, exactly like bookmarks and progress, so the write gate is read
 * visibility rather than ownership. The composite key is the uniqueness rule — following
 * twice is the same follow — and the `novel_id` index is what the publish fan-out reads by,
 * because that is the only query that asks the table from the other side.
 */
export const novelFollows = pgTable(
  "novel_follows",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    novelId: text("novel_id")
      .notNull()
      .references(() => novels.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.novelId] }),
    index("novel_follows_novel_id_idx").on(table.novelId),
  ],
);
