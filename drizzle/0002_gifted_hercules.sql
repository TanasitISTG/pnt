CREATE TYPE "public"."chapter_status" AS ENUM('raw', 'queued', 'translating', 'translated', 'error');--> statement-breakpoint
ALTER TABLE "chapters" ALTER COLUMN "status" SET DEFAULT 'raw'::"public"."chapter_status";--> statement-breakpoint
ALTER TABLE "chapters" ALTER COLUMN "status" SET DATA TYPE "public"."chapter_status" USING "status"::"public"."chapter_status";