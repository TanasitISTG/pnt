CREATE INDEX "chapters_novel_metrics_idx" ON "chapters" USING btree ("novel_id","published_at","status","id");--> statement-breakpoint
CREATE INDEX "translation_job_chunks_metrics_idx" ON "translation_job_chunks" USING btree ("job_id","latency_ms","prompt_tokens","completion_tokens");--> statement-breakpoint
CREATE INDEX "translation_jobs_recent_idx" ON "translation_jobs" USING btree ("updated_at" DESC NULLS LAST,"chapter_id","id");--> statement-breakpoint
CREATE INDEX "import_jobs_recent_idx" ON "import_jobs" USING btree ("updated_at" DESC NULLS LAST,"novel_id","id");