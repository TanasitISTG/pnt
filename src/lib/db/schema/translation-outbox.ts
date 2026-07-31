import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const translationOutbox = pgTable(
  "translation_outbox",
  {
    id: text("id").primaryKey(),
    eventName: text("event_name").notNull(),
    payloadJson: text("payload_json").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at").notNull().defaultNow(),
    sentAt: timestamp("sent_at"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [index("translation_outbox_pending_idx").on(table.status, table.availableAt)],
);
