CREATE TYPE "public"."import_job_status" AS ENUM('pending', 'running', 'done', 'error', 'cancelled');--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"novel_id" text NOT NULL,
	"status" "import_job_status" DEFAULT 'pending' NOT NULL,
	"base_url" text NOT NULL,
	"from_number" integer NOT NULL,
	"to_number" integer NOT NULL,
	"next_number" integer NOT NULL,
	"added" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_novel_id_novels_id_fk" FOREIGN KEY ("novel_id") REFERENCES "public"."novels"("id") ON DELETE cascade ON UPDATE no action;