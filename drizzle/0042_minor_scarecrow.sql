CREATE TABLE "comments" (
	"id" text PRIMARY KEY NOT NULL,
	"chapter_id" text NOT NULL,
	"novel_id" text NOT NULL,
	"user_id" text,
	"parent_id" text,
	"body" text,
	"edited_at" timestamp,
	"deleted_at" timestamp,
	"removed_at" timestamp,
	"removed_by_id" text,
	"removed_by_email" text,
	"removal_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "comments_body_length_check" CHECK ("comments"."body" is null or char_length("comments"."body") <= 2000),
	CONSTRAINT "comments_body_present_check" CHECK ("comments"."body" is not null or "comments"."deleted_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"novel_id" text NOT NULL,
	"user_id" text NOT NULL,
	"rating" integer NOT NULL,
	"body" text,
	"edited_at" timestamp,
	"removed_at" timestamp,
	"removed_by_id" text,
	"removed_by_email" text,
	"removal_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_rating_check" CHECK ("reviews"."rating" between 1 and 5),
	CONSTRAINT "reviews_body_length_check" CHECK ("reviews"."body" is null or char_length("reviews"."body") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "comment_id" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "review_id" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "reported_excerpt" text;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_novel_id_novels_id_fk" FOREIGN KEY ("novel_id") REFERENCES "public"."novels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_id_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_novel_id_novels_id_fk" FOREIGN KEY ("novel_id") REFERENCES "public"."novels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comments_chapter_parent_created_idx" ON "comments" USING btree ("chapter_id","parent_id","created_at");--> statement-breakpoint
CREATE INDEX "comments_novel_id_idx" ON "comments" USING btree ("novel_id");--> statement-breakpoint
CREATE INDEX "comments_user_id_idx" ON "comments" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_novel_user_live_uidx" ON "reviews" USING btree ("novel_id","user_id") WHERE "reviews"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "reviews_novel_created_idx" ON "reviews" USING btree ("novel_id","created_at");--> statement-breakpoint
CREATE INDEX "reviews_user_id_idx" ON "reviews" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reports_comment_id_idx" ON "reports" USING btree ("comment_id");--> statement-breakpoint
CREATE INDEX "reports_review_id_idx" ON "reports" USING btree ("review_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_open_reporter_comment_uidx" ON "reports" USING btree ("reporter_user_id","comment_id") WHERE "reports"."status" = 'open' and "reports"."comment_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "reports_open_reporter_review_uidx" ON "reports" USING btree ("reporter_user_id","review_id") WHERE "reports"."status" = 'open' and "reports"."review_id" is not null;