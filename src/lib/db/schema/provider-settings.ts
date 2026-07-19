import { relations } from "drizzle-orm";
import { pgTable, text, timestamp, real } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const providerSettings = pgTable("provider_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  baseUrl: text("base_url").notNull(),
  apiKeyEnc: text("api_key_enc").notNull(),
  model: text("model").notNull(),
  temperature: real("temperature").notNull().default(0.7),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const providerSettingsRelations = relations(providerSettings, ({ one }) => ({
  user: one(user, { fields: [providerSettings.userId], references: [user.id] }),
}));
