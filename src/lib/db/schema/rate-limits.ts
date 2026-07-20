import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";

// App-level fixed-window rate limiting for public (guest) endpoints.
// key = "<bucket>:<ip>". Rows self-overwrite on next hit after reset_at — no cleanup job.
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  resetAt: timestamp("reset_at").notNull(),
});
