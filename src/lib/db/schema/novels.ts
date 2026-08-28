import { relations } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  integer,
  numeric,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { bytea } from "./bytea";
import { user } from "./auth";
import { translationJobs } from "./translation-jobs";
import { glossaryTerms } from "./glossary-terms";

export const chapterStatusEnum = pgEnum("chapter_status", [
  "raw",
  "queued",
  "translating",
  "translated",
  "error",
]);

export const novels = pgTable(
  "novels",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    originalTitle: text("original_title"),
    author: text("author"),
    description: text("description"),
    cover: bytea("cover"),
    coverMime: text("cover_mime"),
    sourceLang: text("source_lang").notNull(),
    targetLang: text("target_lang").notNull(),
    customPrompt: text("custom_prompt"),
    storySummary: text("story_summary"),
    relationshipMapJson: text("relationship_map_json")
      .notNull()
      .default('{"version":1,"characters":[],"relationships":[]}'),
    chunkSize: integer("chunk_size").notNull().default(4000),
    contextTailLength: integer("context_tail_length").notNull().default(500),
    // null = draft (admin-only); <= now = live for guests; > now = scheduled
    publishedAt: timestamp("published_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("novels_published_at_idx").on(table.publishedAt),
    index("novels_user_id_idx").on(table.userId),
  ],
);

export const chapters = pgTable(
  "chapters",
  {
    id: text("id").primaryKey(),
    novelId: text("novel_id")
      .notNull()
      .references(() => novels.id, { onDelete: "cascade" }),
    number: numeric("number", { precision: 8, scale: 2 }).notNull(),
    title: text("title").notNull(),
    translatedTitle: text("translated_title"),
    rawContent: text("raw_content").notNull(),
    translatedContent: text("translated_content"),
    status: chapterStatusEnum("status").notNull().default("raw"),
    summary: text("summary"),
    rawCharCount: integer("raw_char_count").notNull(),
    sourceRevision: integer("source_revision").notNull().default(1),
    translationGeneration: integer("translation_generation").notNull().default(0),
    activeTranslationJobId: text("active_translation_job_id"),
    publishedAt: timestamp("published_at"),
    translatedAt: timestamp("translated_at"),
    editedAt: timestamp("edited_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    unique("unique_novel_chapter_number").on(table.novelId, table.number),
    index("chapters_published_at_idx").on(table.publishedAt),
  ],
);

export const novelsRelations = relations(novels, ({ one, many }) => ({
  user: one(user, { fields: [novels.userId], references: [user.id] }),
  chapters: many(chapters),
  glossaryTerms: many(glossaryTerms),
}));

export const chaptersRelations = relations(chapters, ({ one, many }) => ({
  novel: one(novels, { fields: [chapters.novelId], references: [novels.id] }),
  translationJobs: many(translationJobs),
}));
