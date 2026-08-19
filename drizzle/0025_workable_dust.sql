CREATE TYPE "public"."epub_item_status" AS ENUM('pending', 'imported', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."epub_upload_status" AS ENUM('uploading', 'queued', 'staged', 'error');--> statement-breakpoint
CREATE TYPE "public"."import_job_kind" AS ENUM('scrape', 'epub');--> statement-breakpoint
CREATE TABLE "epub_upload_chunks" (
	"upload_id" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"data" "bytea" NOT NULL,
	CONSTRAINT "epub_upload_chunks_upload_id_chunk_index_pk" PRIMARY KEY("upload_id","chunk_index")
);
--> statement-breakpoint
CREATE TABLE "epub_uploads" (
	"id" text PRIMARY KEY NOT NULL,
	"novel_id" text NOT NULL,
	"file_name" text NOT NULL,
	"file_size" integer NOT NULL,
	"chunk_count" integer NOT NULL,
	"received_bytes" integer DEFAULT 0 NOT NULL,
	"status" "epub_upload_status" DEFAULT 'uploading' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_job_items" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"chapter_number" numeric(8, 2) NOT NULL,
	"title" text NOT NULL,
	"raw_content" text NOT NULL,
	"raw_char_count" integer NOT NULL,
	"status" "epub_item_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_import_job_item_sequence" UNIQUE("job_id","sequence")
);
--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "kind" "import_job_kind" DEFAULT 'scrape' NOT NULL;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "source_file_name" text;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "epub_upload_id" text;--> statement-breakpoint
ALTER TABLE "epub_upload_chunks" ADD CONSTRAINT "epub_upload_chunks_upload_id_epub_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."epub_uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "epub_uploads" ADD CONSTRAINT "epub_uploads_novel_id_novels_id_fk" FOREIGN KEY ("novel_id") REFERENCES "public"."novels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_job_items" ADD CONSTRAINT "import_job_items_job_id_import_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."import_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "epub_uploads_novel_id_idx" ON "epub_uploads" USING btree ("novel_id");--> statement-breakpoint
CREATE INDEX "import_job_items_job_id_sequence_idx" ON "import_job_items" USING btree ("job_id","sequence");