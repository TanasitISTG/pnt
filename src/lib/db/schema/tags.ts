import { relations } from "drizzle-orm";
import { index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { novels } from "./novels";

/**
 * The tag vocabulary, and the join that applies it.
 *
 * A tag is a row rather than free text on the novel: a vocabulary is what lets the catalog
 * offer "every novel tagged `xianxia`" as one filter, and what keeps two spellings of the
 * same genre from becoming two filters. `slug` is unique and Unicode-preserving, so a Thai
 * tag keeps a readable, linkable form in the query string.
 */
export const tags = pgTable("tags", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * The application of a tag to a novel.
 *
 * Both foreign keys cascade: deleting a novel drops its applications, and deleting a tag
 * from the vocabulary drops them too, so no row can outlive either side. The reverse index
 * is what the catalog filter reads (one tag, its novels); the primary key already serves the
 * novel-first direction a detail page uses.
 */
export const novelTags = pgTable(
  "novel_tags",
  {
    novelId: text("novel_id")
      .notNull()
      .references(() => novels.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.novelId, table.tagId] }),
    index("novel_tags_tag_id_idx").on(table.tagId),
  ],
);

export const tagsRelations = relations(tags, ({ many }) => ({
  novelTags: many(novelTags),
}));

export const novelTagsRelations = relations(novelTags, ({ one }) => ({
  novel: one(novels, { fields: [novelTags.novelId], references: [novels.id] }),
  tag: one(tags, { fields: [novelTags.tagId], references: [tags.id] }),
}));
