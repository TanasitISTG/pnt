import { relations } from "drizzle-orm";
import { pgTable, pgEnum, text, timestamp, unique } from "drizzle-orm/pg-core";
import { novels } from "./novels";

export const termCategoryEnum = pgEnum("glossary_term_category", [
  "character",
  "place",
  "skill",
  "item",
  "other",
]);

export const termStatusEnum = pgEnum("glossary_term_status", ["approved", "pending"]);

export const glossaryTerms = pgTable(
  "glossary_terms",
  {
    id: text("id").primaryKey(),
    novelId: text("novel_id")
      .notNull()
      .references(() => novels.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    target: text("target").notNull(),
    category: termCategoryEnum("category").notNull().default("other"),
    note: text("note"),
    status: termStatusEnum("status").notNull().default("approved"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [unique("unique_novel_source_term").on(table.novelId, table.source)],
);

export const glossaryTermsRelations = relations(glossaryTerms, ({ one }) => ({
  novel: one(novels, { fields: [glossaryTerms.novelId], references: [novels.id] }),
}));
