ALTER TABLE "import_jobs" ALTER COLUMN "kind" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "import_jobs" ALTER COLUMN "kind" SET DEFAULT 'epub'::text;--> statement-breakpoint
DROP TYPE "public"."import_job_kind";--> statement-breakpoint
CREATE TYPE "public"."import_job_kind" AS ENUM('epub');--> statement-breakpoint
ALTER TABLE "import_jobs" ALTER COLUMN "kind" SET DEFAULT 'epub'::"public"."import_job_kind";--> statement-breakpoint
ALTER TABLE "import_jobs" ALTER COLUMN "kind" SET DATA TYPE "public"."import_job_kind" USING "kind"::"public"."import_job_kind";--> statement-breakpoint
ALTER TABLE "import_jobs" DROP COLUMN "scrape_provider";