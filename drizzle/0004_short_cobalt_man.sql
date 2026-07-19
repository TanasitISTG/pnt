CREATE TYPE "public"."translation_job_status" AS ENUM('pending', 'running', 'done', 'error', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."glossary_term_category" AS ENUM('character', 'place', 'skill', 'item', 'other');--> statement-breakpoint
CREATE TYPE "public"."glossary_term_status" AS ENUM('approved', 'pending');--> statement-breakpoint
CREATE TABLE "translation_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"chapter_id" text NOT NULL,
	"status" "translation_job_status" DEFAULT 'pending' NOT NULL,
	"total_chunks" integer NOT NULL,
	"done_chunks" integer DEFAULT 0 NOT NULL,
	"chunks_json" text,
	"error" text,
	"usage_json" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "glossary_terms" (
	"id" text PRIMARY KEY NOT NULL,
	"novel_id" text NOT NULL,
	"source" text NOT NULL,
	"target" text NOT NULL,
	"category" "glossary_term_category" DEFAULT 'other' NOT NULL,
	"note" text,
	"status" "glossary_term_status" DEFAULT 'approved' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_novel_source_term" UNIQUE("novel_id","source")
);
--> statement-breakpoint
ALTER TABLE "novels" ADD COLUMN "chunk_size" integer DEFAULT 2000 NOT NULL;--> statement-breakpoint
ALTER TABLE "novels" ADD COLUMN "context_tail_length" integer DEFAULT 500 NOT NULL;--> statement-breakpoint
ALTER TABLE "translation_jobs" ADD CONSTRAINT "translation_jobs_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "glossary_terms" ADD CONSTRAINT "glossary_terms_novel_id_novels_id_fk" FOREIGN KEY ("novel_id") REFERENCES "public"."novels"("id") ON DELETE cascade ON UPDATE no action;