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
  temperature: real("temperature").notNull().default(0.3),
  // Optional USD prices per 1M tokens, used for per-chapter cost display (P8.3).
  inputPricePer1M: real("input_price_per_1m"),
  outputPricePer1M: real("output_price_per_1m"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const providerSettingsRelations = relations(providerSettings, ({ one }) => ({
  user: one(user, { fields: [providerSettings.userId], references: [user.id] }),
}));
