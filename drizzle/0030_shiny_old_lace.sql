ALTER TABLE "translation_outbox" RENAME TO "workflow_outbox";--> statement-breakpoint
DROP INDEX "translation_outbox_pending_idx";--> statement-breakpoint
ALTER TABLE "translation_jobs" ADD COLUMN "overwrite_existing" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "translation_jobs" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "translation_jobs" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "translation_jobs" ADD COLUMN "fast_model" text;--> statement-breakpoint
ALTER TABLE "translation_jobs" ADD COLUMN "source_char_count" integer;--> statement-breakpoint
ALTER TABLE "translation_jobs" ADD COLUMN "input_price_per_1m" real;--> statement-breakpoint
ALTER TABLE "translation_jobs" ADD COLUMN "output_price_per_1m" real;--> statement-breakpoint
CREATE INDEX "workflow_outbox_pending_idx" ON "workflow_outbox" USING btree ("status","available_at");--> statement-breakpoint
CREATE UNIQUE INDEX "import_jobs_one_active_per_novel_idx" ON "import_jobs" USING btree ("novel_id") WHERE "import_jobs"."status" IN ('pending', 'running');