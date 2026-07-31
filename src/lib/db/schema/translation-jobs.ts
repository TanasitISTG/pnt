import { relations, sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  integer,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";
import { chapters } from "./novels";

export const jobStatusEnum = pgEnum("translation_job_status", [
  "pending",
  "running",
  "done",
  "error",
  "cancelled",
]);

export const translationJobs = pgTable(
  "translation_jobs",
  {
    id: text("id").primaryKey(),
    chapterId: text("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    status: jobStatusEnum("status").notNull().default("pending"),
    sourceRevision: integer("source_revision").notNull().default(1),
    generation: integer("generation").notNull().default(1),
    totalChunks: integer("total_chunks").notNull(),
    doneChunks: integer("done_chunks").notNull().default(0),
    // Expand/contract compatibility only. New code persists progress in translation_job_chunks.
    chunksJson: text("chunks_json"),
    error: text("error"),
    usageJson: text("usage_json"),
    logsJson: text("logs_json"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("translation_jobs_chapter_id_idx").on(table.chapterId),
    uniqueIndex("translation_jobs_one_active_per_chapter_idx")
      .on(table.chapterId)
      .where(sql`${table.status} IN ('pending', 'running')`),
  ],
);

export const translationJobChunks = pgTable(
  "translation_job_chunks",
  {
    jobId: text("job_id")
      .notNull()
      .references(() => translationJobs.id, { onDelete: "cascade" }),
    index: integer("chunk_index").notNull(),
    sourceText: text("source_text").notNull(),
    textLength: integer("text_length").notNull(),
    translation: text("translation"),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    latencyMs: integer("latency_ms"),
    error: text("error"),
    completedAt: timestamp("completed_at"),
  },
  (table) => [primaryKey({ columns: [table.jobId, table.index] })],
);

export const translationJobsRelations = relations(translationJobs, ({ one }) => ({
  chapter: one(chapters, { fields: [translationJobs.chapterId], references: [chapters.id] }),
}));

export const translationJobChunksRelations = relations(translationJobChunks, ({ one }) => ({
  job: one(translationJobs, {
    fields: [translationJobChunks.jobId],
    references: [translationJobs.id],
  }),
}));
