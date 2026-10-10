ALTER TABLE "novels" ALTER COLUMN "chunk_size" SET DEFAULT 4000;--> statement-breakpoint
ALTER TABLE "novels" ADD COLUMN "story_summary" text;--> statement-breakpoint
ALTER TABLE "provider_settings" ADD COLUMN "fast_model" text;