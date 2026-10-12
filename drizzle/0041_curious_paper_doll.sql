CREATE TABLE "reports" (
	"id" text PRIMARY KEY NOT NULL,
	"reporter_user_id" text NOT NULL,
	"target_type" text NOT NULL,
	"novel_id" text,
	"reported_novel_title" text,
	"reported_user_id" text,
	"reason" text NOT NULL,
	"details" text,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution_note" text,
	"resolved_by_id" text,
	"resolved_by_email" text,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_user_id_user_id_fk" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_novel_id_novels_id_fk" FOREIGN KEY ("novel_id") REFERENCES "public"."novels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reports_novel_id_idx" ON "reports" USING btree ("novel_id");--> statement-breakpoint
CREATE INDEX "reports_status_created_at_idx" ON "reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "reports_reporter_user_id_idx" ON "reports" USING btree ("reporter_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_open_reporter_novel_uidx" ON "reports" USING btree ("reporter_user_id","novel_id") WHERE "reports"."status" = 'open' and "reports"."novel_id" is not null;