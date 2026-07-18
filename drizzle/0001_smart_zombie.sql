CREATE TABLE "chapters" (
	"id" text PRIMARY KEY NOT NULL,
	"novel_id" text NOT NULL,
	"number" numeric(8, 2) NOT NULL,
	"title" text NOT NULL,
	"raw_content" text NOT NULL,
	"translated_content" text,
	"status" text DEFAULT 'raw' NOT NULL,
	"summary" text,
	"raw_char_count" integer NOT NULL,
	"translated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_novel_chapter_number" UNIQUE("novel_id","number")
);
--> statement-breakpoint
CREATE TABLE "novels" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"original_title" text,
	"author" text,
	"description" text,
	"cover" "bytea",
	"cover_mime" text,
	"source_lang" text NOT NULL,
	"target_lang" text NOT NULL,
	"custom_prompt" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_novel_id_novels_id_fk" FOREIGN KEY ("novel_id") REFERENCES "public"."novels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "novels" ADD CONSTRAINT "novels_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;