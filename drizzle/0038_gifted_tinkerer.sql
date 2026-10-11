ALTER TABLE "epub_upload_chunks" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "epub_upload_chunks" CASCADE;--> statement-breakpoint
ALTER TABLE "epub_uploads" ALTER COLUMN "object_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "novels" DROP COLUMN "cover";--> statement-breakpoint
ALTER TABLE "epub_uploads" DROP COLUMN "chunk_count";--> statement-breakpoint
ALTER TABLE "epub_uploads" DROP COLUMN "received_bytes";