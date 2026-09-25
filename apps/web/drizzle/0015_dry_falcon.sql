CREATE INDEX "chapters_published_at_idx" ON "chapters" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "novels_published_at_idx" ON "novels" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "novels_user_id_idx" ON "novels" USING btree ("user_id");