DROP INDEX "reader_bookmarks_user_novel_idx";--> statement-breakpoint
CREATE INDEX "reader_bookmarks_user_novel_idx" ON "reader_bookmarks" USING btree ("user_id","novel_id","created_at","id");