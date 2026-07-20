import { relations } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  integer,
  numeric,
  unique,
  customType,
} from "drizzle-orm/pg-core";
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

// Custom type for bytea mapping to Buffer in JS/TS
const bytea = customType<{ data: Buffer; driverData: unknown }>({
  dataType() {
    return "bytea";
  },
  toDriver(value: Buffer) {
    return value;
  },
  fromDriver(value: unknown) {
    if (Buffer.isBuffer(value)) return value;
    if (value instanceof Uint8Array) return Buffer.from(value);
    if (typeof value === "string") {
      if (value.startsWith("\\x")) {
        return Buffer.from(value.slice(2), "hex");
      }
      return Buffer.from(value, "hex");
    }
    return Buffer.from(value as any);
  },
});

export const novels = pgTable("novels", {
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
  chunkSize: integer("chunk_size").notNull().default(2000),
  contextTailLength: integer("context_tail_length").notNull().default(500),
  // null = draft (admin-only); <= now = live for guests; > now = scheduled
  publishedAt: timestamp("published_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

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
    publishedAt: timestamp("published_at"),
    translatedAt: timestamp("translated_at"),
    editedAt: timestamp("edited_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [unique("unique_novel_chapter_number").on(table.novelId, table.number)],
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
