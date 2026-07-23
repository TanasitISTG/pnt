import { pgTable, pgEnum, text, timestamp, integer, index } from "drizzle-orm/pg-core";
import { novels } from "./novels";

export const importJobStatusEnum = pgEnum("import_job_status", [
  "pending",
  "running",
  "done",
  "error",
  "cancelled",
]);

// One bulk chapter-import run (Inngest-driven; see src/lib/scrape.worker.ts).
// nextNumber is the resume cursor — chapters before it are already processed.
export const importJobs = pgTable(
  "import_jobs",
  {
    id: text("id").primaryKey(),
    novelId: text("novel_id")
      .notNull()
      .references(() => novels.id, { onDelete: "cascade" }),
    status: importJobStatusEnum("status").notNull().default("pending"),
    baseUrl: text("base_url").notNull(),
    fromNumber: integer("from_number").notNull(),
    toNumber: integer("to_number").notNull(),
    nextNumber: integer("next_number").notNull(),
    added: integer("added").notNull().default(0),
    skipped: integer("skipped").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    error: text("error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [index("import_jobs_novel_id_idx").on(table.novelId)],
);
