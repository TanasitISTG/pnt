CREATE TABLE "reader_bookmarks" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"novel_id" text NOT NULL,
	"chapter_id" text NOT NULL,
	"paragraph_index" integer NOT NULL,
	"source_column" text,
	"excerpt" text NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reader_chapter_reads" (
	"user_id" text NOT NULL,
	"novel_id" text NOT NULL,
	"chapter_id" text NOT NULL,
	"read_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reader_chapter_reads_user_id_chapter_id_pk" PRIMARY KEY("user_id","chapter_id")
);
--> statement-breakpoint
CREATE TABLE "reader_progress" (
	"user_id" text NOT NULL,
	"novel_id" text NOT NULL,
	"last_chapter_id" text,
	"scroll_fraction" real DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reader_progress_user_id_novel_id_pk" PRIMARY KEY("user_id","novel_id")
);
--> statement-breakpoint
ALTER TABLE "reader_bookmarks" ADD CONSTRAINT "reader_bookmarks_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reader_bookmarks" ADD CONSTRAINT "reader_bookmarks_novel_id_novels_id_fk" FOREIGN KEY ("novel_id") REFERENCES "public"."novels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reader_bookmarks" ADD CONSTRAINT "reader_bookmarks_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reader_chapter_reads" ADD CONSTRAINT "reader_chapter_reads_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reader_chapter_reads" ADD CONSTRAINT "reader_chapter_reads_novel_id_novels_id_fk" FOREIGN KEY ("novel_id") REFERENCES "public"."novels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reader_chapter_reads" ADD CONSTRAINT "reader_chapter_reads_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reader_progress" ADD CONSTRAINT "reader_progress_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reader_progress" ADD CONSTRAINT "reader_progress_novel_id_novels_id_fk" FOREIGN KEY ("novel_id") REFERENCES "public"."novels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reader_bookmarks_user_novel_idx" ON "reader_bookmarks" USING btree ("user_id","novel_id","created_at");--> statement-breakpoint
CREATE INDEX "reader_chapter_reads_novel_idx" ON "reader_chapter_reads" USING btree ("user_id","novel_id");