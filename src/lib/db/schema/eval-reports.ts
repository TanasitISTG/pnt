import { pgTable, pgEnum, text, timestamp, integer, index } from "drizzle-orm/pg-core";
import { novels } from "./novels";

export const evalReportStatusEnum = pgEnum("translation_eval_report_status", [
  "pending",
  "running",
  "done",
  "error",
]);

export const translationEvalReports = pgTable(
  "translation_eval_reports",
  {
    id: text("id").primaryKey(),
    novelId: text("novel_id")
      .notNull()
      .references(() => novels.id, { onDelete: "cascade" }),
    status: evalReportStatusEnum("status").notNull().default("pending"),
    chapterSelector: text("chapter_selector").notNull().default("first3"),
    chapterCount: integer("chapter_count").notNull().default(0),
    residualScriptLetters: integer("residual_script_letters").notNull().default(0),
    markerMismatches: integer("marker_mismatches").notNull().default(0),
    matchedGlossaryTerms: integer("matched_glossary_terms").notNull().default(0),
    adheredGlossaryTerms: integer("adhered_glossary_terms").notNull().default(0),
    summaryJson: text("summary_json"),
    resultsJson: text("results_json"),
    error: text("error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [index("translation_eval_reports_novel_id_idx").on(table.novelId)],
);
