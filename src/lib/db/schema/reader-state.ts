import { pgTable, text, integer, real, timestamp, primaryKey, index } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { novels, chapters } from "./novels";

// Account-scoped reader state for signed-in users. Guests keep the localStorage equivalent.
export const readerProgress = pgTable(
  "reader_progress",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    novelId: text("novel_id")
      .notNull()
      .references(() => novels.id, { onDelete: "cascade" }),
    lastChapterId: text("last_chapter_id"),
    scrollFraction: real("scroll_fraction").notNull().default(0),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.novelId] })],
);

export const readerChapterReads = pgTable(
  "reader_chapter_reads",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    novelId: text("novel_id")
      .notNull()
      .references(() => novels.id, { onDelete: "cascade" }),
    chapterId: text("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    readAt: timestamp("read_at").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.chapterId] }),
    index("reader_chapter_reads_novel_idx").on(table.userId, table.novelId),
  ],
);

export const readerBookmarks = pgTable(
  "reader_bookmarks",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    novelId: text("novel_id")
      .notNull()
      .references(() => novels.id, { onDelete: "cascade" }),
    chapterId: text("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    paragraphIndex: integer("paragraph_index").notNull(),
    // "raw" | "translated" | null (pair-level bookmark in side-by-side view)
    column: text("source_column"),
    excerpt: text("excerpt").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("reader_bookmarks_user_novel_idx").on(table.userId, table.novelId, table.createdAt),
  ],
);
