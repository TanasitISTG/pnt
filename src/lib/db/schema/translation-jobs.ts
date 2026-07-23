import { relations } from "drizzle-orm";
import { pgTable, pgEnum, text, timestamp, integer, index } from "drizzle-orm/pg-core";
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
    totalChunks: integer("total_chunks").notNull(),
    doneChunks: integer("done_chunks").notNull().default(0),
    chunksJson: text("chunks_json"),
    error: text("error"),
    usageJson: text("usage_json"),
    logsJson: text("logs_json"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [index("translation_jobs_chapter_id_idx").on(table.chapterId)],
);

export const translationJobsRelations = relations(translationJobs, ({ one }) => ({
  chapter: one(chapters, { fields: [translationJobs.chapterId], references: [chapters.id] }),
}));
