CREATE TYPE "public"."translation_eval_report_status" AS ENUM('pending', 'running', 'done', 'error');--> statement-breakpoint
CREATE TABLE "translation_eval_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"novel_id" text NOT NULL,
	"status" "translation_eval_report_status" DEFAULT 'pending' NOT NULL,
	"chapter_selector" text DEFAULT 'first3' NOT NULL,
	"chapter_count" integer DEFAULT 0 NOT NULL,
	"residual_cjk" integer DEFAULT 0 NOT NULL,
	"marker_mismatches" integer DEFAULT 0 NOT NULL,
	"matched_glossary_terms" integer DEFAULT 0 NOT NULL,
	"adhered_glossary_terms" integer DEFAULT 0 NOT NULL,
	"summary_json" text,
	"results_json" text,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "translation_eval_reports" ADD CONSTRAINT "translation_eval_reports_novel_id_novels_id_fk" FOREIGN KEY ("novel_id") REFERENCES "public"."novels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "translation_eval_reports_novel_id_idx" ON "translation_eval_reports" USING btree ("novel_id");