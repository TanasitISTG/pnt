import { relations } from "drizzle-orm";
import { index, integer, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { chapters } from "./novels";

/**
 * Where a stored translation came from.
 *
 * The value is what the history list names beside a version, and the rollback path writes its
 * own row rather than deleting anything, so "restore" is visible in the same list as the
 * changes it undoes.
 */
export const chapterTranslationOriginEnum = pgEnum("chapter_translation_origin", [
  "translation",
  "manual",
  "glossary",
  "rollback",
  "import",
]);

/**
 * One generation of a chapter's translated text.
 *
 * `chapters.translated_content` holds the current translation only, so a re-translate or a
 * glossary pass overwrites what was there. This table is the trail: every write to that
 * column records the value it wrote, in the same transaction, and the newest row is the
 * current text by construction. That is what lets a bad glossary edit be undone instead of
 * having burned good work with no way back.
 *
 * The row is a snapshot, never a live reference: `content` is the whole chapter as it stood,
 * and `sourceRevision`/`generation` say which source and which run produced it. A version
 * from an earlier source revision is still restorable — it is simply not a diff of the same
 * source text, and the interface says so rather than pretending otherwise.
 *
 * `jobId` carries no foreign key on purpose: a translation run pruned by retention must not
 * take its history with it, and the id is only ever displayed.
 *
 * One row per chapter is kept bounded (see `CHAPTER_TRANSLATION_HISTORY_LIMIT`), pruned by
 * the same transaction that appends, which is why the list index is newest-first per chapter.
 */
export const chapterTranslationVersions = pgTable(
  "chapter_translation_versions",
  {
    id: text("id").primaryKey(),
    chapterId: text("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    generation: integer("generation").notNull(),
    sourceRevision: integer("source_revision").notNull(),
    origin: chapterTranslationOriginEnum("origin").notNull(),
    jobId: text("job_id"),
    translatedTitle: text("translated_title"),
    content: text("content").notNull(),
    summary: text("summary"),
    charCount: integer("char_count").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    // The history list, the retention prune, and the "newest row is current" rule all read
    // this one index, newest first.
    index("chapter_translation_versions_chapter_created_idx").on(
      table.chapterId,
      table.createdAt.desc(),
      table.id,
    ),
  ],
);

export const chapterTranslationVersionsRelations = relations(
  chapterTranslationVersions,
  ({ one }) => ({
    chapter: one(chapters, {
      fields: [chapterTranslationVersions.chapterId],
      references: [chapters.id],
    }),
  }),
);
