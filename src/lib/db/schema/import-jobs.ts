import { relations } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  integer,
  numeric,
  index,
  unique,
  primaryKey,
} from "drizzle-orm/pg-core";
import { bytea } from "./bytea";
import { novels } from "./novels";

export const importJobKindEnum = pgEnum("import_job_kind", ["scrape", "epub"]);

export const importJobStatusEnum = pgEnum("import_job_status", [
  "pending",
  "running",
  "done",
  "error",
  "cancelled",
]);

export const epubUploadStatusEnum = pgEnum("epub_upload_status", [
  "uploading",
  "queued",
  "staged",
  "error",
]);

export const epubItemStatusEnum = pgEnum("epub_item_status", ["pending", "imported", "skipped"]);

// One bulk chapter-import run (Inngest-driven).
// nextNumber is the resume cursor — chapters before it are already processed.
export const importJobs = pgTable(
  "import_jobs",
  {
    id: text("id").primaryKey(),
    novelId: text("novel_id")
      .notNull()
      .references(() => novels.id, { onDelete: "cascade" }),
    kind: importJobKindEnum("kind").notNull().default("scrape"),
    status: importJobStatusEnum("status").notNull().default("pending"),
    baseUrl: text("base_url").notNull(),
    sourceFileName: text("source_file_name"),
    epubUploadId: text("epub_upload_id"),
    fromNumber: integer("from_number").notNull(),
    toNumber: integer("to_number").notNull(),
    nextNumber: integer("next_number").notNull(),
    scrapeProvider: text("scrape_provider").notNull().default("auto"),
    added: integer("added").notNull().default(0),
    skipped: integer("skipped").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    error: text("error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [index("import_jobs_novel_id_idx").on(table.novelId)],
);

export const epubUploads = pgTable(
  "epub_uploads",
  {
    id: text("id").primaryKey(),
    novelId: text("novel_id")
      .notNull()
      .references(() => novels.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    fileSize: integer("file_size").notNull(),
    chunkCount: integer("chunk_count").notNull(),
    receivedBytes: integer("received_bytes").notNull().default(0),
    status: epubUploadStatusEnum("status").notNull().default("uploading"),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [index("epub_uploads_novel_id_idx").on(table.novelId)],
);

export const epubUploadChunks = pgTable(
  "epub_upload_chunks",
  {
    uploadId: text("upload_id")
      .notNull()
      .references(() => epubUploads.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    data: bytea("data").notNull(),
  },
  (table) => [primaryKey({ columns: [table.uploadId, table.chunkIndex] })],
);

export const importJobItems = pgTable(
  "import_job_items",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => importJobs.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    chapterNumber: numeric("chapter_number", { precision: 8, scale: 2 }).notNull(),
    title: text("title").notNull(),
    rawContent: text("raw_content").notNull(),
    rawCharCount: integer("raw_char_count").notNull(),
    status: epubItemStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    unique("unique_import_job_item_sequence").on(table.jobId, table.sequence),
    index("import_job_items_job_id_sequence_idx").on(table.jobId, table.sequence),
  ],
);

export const importJobsRelations = relations(importJobs, ({ one, many }) => ({
  novel: one(novels, {
    fields: [importJobs.novelId],
    references: [novels.id],
  }),
  items: many(importJobItems),
  epubUpload: one(epubUploads, {
    fields: [importJobs.epubUploadId],
    references: [epubUploads.id],
  }),
}));

export const epubUploadsRelations = relations(epubUploads, ({ one, many }) => ({
  novel: one(novels, {
    fields: [epubUploads.novelId],
    references: [novels.id],
  }),
  chunks: many(epubUploadChunks),
}));

export const epubUploadChunksRelations = relations(epubUploadChunks, ({ one }) => ({
  upload: one(epubUploads, {
    fields: [epubUploadChunks.uploadId],
    references: [epubUploads.id],
  }),
}));

export const importJobItemsRelations = relations(importJobItems, ({ one }) => ({
  job: one(importJobs, {
    fields: [importJobItems.jobId],
    references: [importJobs.id],
  }),
}));
