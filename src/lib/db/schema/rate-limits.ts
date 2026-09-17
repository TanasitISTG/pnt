import { index, pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";

// key = "<bucket>:<subject>". Rows self-overwrite on next hit after reset_at;
// expired rows are removed hourly by the cleanup-expired-rate-limits Inngest cron.
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").primaryKey(),
    count: integer("count").notNull().default(0),
    resetAt: timestamp("reset_at").notNull(),
  },
  (table) => [index("rate_limits_reset_at_idx").on(table.resetAt)],
);
