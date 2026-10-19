CREATE TYPE "public"."chapter_translation_origin" AS ENUM('translation', 'manual', 'glossary', 'rollback', 'import');--> statement-breakpoint
CREATE TABLE "chapter_translation_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"chapter_id" text NOT NULL,
	"generation" integer NOT NULL,
	"source_revision" integer NOT NULL,
	"origin" "chapter_translation_origin" NOT NULL,
	"job_id" text,
	"translated_title" text,
	"content" text NOT NULL,
	"summary" text,
	"char_count" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chapter_translation_versions" ADD CONSTRAINT "chapter_translation_versions_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chapter_translation_versions_chapter_created_idx" ON "chapter_translation_versions" USING btree ("chapter_id","created_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "reader_chapter_reads_novel_chapter_read_at_idx" ON "reader_chapter_reads" USING btree ("novel_id","chapter_id","read_at");