CREATE TABLE "translation_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"event_name" text NOT NULL,
	"payload_json" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp DEFAULT now() NOT NULL,
	"sent_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chapters" ADD COLUMN "source_revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "chapters" ADD COLUMN "translation_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "chapters" ADD COLUMN "active_translation_job_id" text;--> statement-breakpoint
ALTER TABLE "translation_jobs" ADD COLUMN "source_revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "translation_jobs" ADD COLUMN "generation" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
WITH ranked_active_jobs AS (
	SELECT "id", row_number() OVER (
		PARTITION BY "chapter_id" ORDER BY "created_at" DESC, "id" DESC
	) AS rank
	FROM "translation_jobs"
	WHERE "status" IN ('pending', 'running')
)
UPDATE "translation_jobs"
SET "status" = 'cancelled', "updated_at" = now()
WHERE "id" IN (SELECT "id" FROM ranked_active_jobs WHERE rank > 1);--> statement-breakpoint
UPDATE "translation_jobs" AS job
SET "source_revision" = chapter."source_revision", "generation" = 1
FROM "chapters" AS chapter
WHERE job."chapter_id" = chapter."id";--> statement-breakpoint
UPDATE "chapters" AS chapter
SET
	"translation_generation" = 1,
	"active_translation_job_id" = active_job."id",
	"status" = CASE WHEN active_job."status" = 'running' THEN 'translating'::chapter_status ELSE 'queued'::chapter_status END
FROM "translation_jobs" AS active_job
WHERE
	active_job."chapter_id" = chapter."id"
	AND active_job."status" IN ('pending', 'running');--> statement-breakpoint
CREATE INDEX "translation_outbox_pending_idx" ON "translation_outbox" USING btree ("status","available_at");--> statement-breakpoint
CREATE UNIQUE INDEX "translation_jobs_one_active_per_chapter_idx" ON "translation_jobs" USING btree ("chapter_id") WHERE "translation_jobs"."status" IN ('pending', 'running');