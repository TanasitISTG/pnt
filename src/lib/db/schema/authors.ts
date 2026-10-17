import { relations } from "drizzle-orm";
import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { novels } from "./novels";

/**
 * A canonically identified author.
 *
 * `novels.author` is a publisher's own text for the same person, and two publishers spell
 * one name two ways. This table is the identity behind that text: a novel links to a row
 * here, and the row survives a spelling correction because an operator merges duplicates
 * instead of leaving a second page nobody can find from the first.
 *
 * `normalized_name` is what makes resolution idempotent — the same trimmed, folded name
 * resolves to the same row on every save — and its uniqueness is what stops a race between
 * two accounts creating the same author from producing two rows.
 */
export const novelAuthors = pgTable(
  "novel_authors",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("novel_authors_normalized_name_idx").on(table.normalizedName)],
);

export const novelAuthorsRelations = relations(novelAuthors, ({ many }) => ({
  novels: many(novels),
}));
