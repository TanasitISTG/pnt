CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reader_bookmarks_spot_uidx" ON "reader_bookmarks" USING btree ("user_id","chapter_id","paragraph_index",coalesce("source_column", ''));--> statement-breakpoint
CREATE INDEX "reader_bookmarks_chapter_id_idx" ON "reader_bookmarks" USING btree ("chapter_id");--> statement-breakpoint
CREATE INDEX "reader_bookmarks_novel_id_idx" ON "reader_bookmarks" USING btree ("novel_id");--> statement-breakpoint
CREATE INDEX "reader_chapter_reads_chapter_id_idx" ON "reader_chapter_reads" USING btree ("chapter_id");--> statement-breakpoint
CREATE INDEX "reader_chapter_reads_novel_id_idx" ON "reader_chapter_reads" USING btree ("novel_id");--> statement-breakpoint
CREATE INDEX "reader_progress_novel_id_idx" ON "reader_progress" USING btree ("novel_id");