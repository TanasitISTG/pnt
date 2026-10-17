CREATE TABLE "novel_authors" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "novel_tags" (
	"novel_id" text NOT NULL,
	"tag_id" text NOT NULL,
	CONSTRAINT "novel_tags_novel_id_tag_id_pk" PRIMARY KEY("novel_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tags_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "novels" ADD COLUMN "author_id" text;--> statement-breakpoint
ALTER TABLE "novel_tags" ADD CONSTRAINT "novel_tags_novel_id_novels_id_fk" FOREIGN KEY ("novel_id") REFERENCES "public"."novels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "novel_tags" ADD CONSTRAINT "novel_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "novel_authors_normalized_name_idx" ON "novel_authors" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX "novel_tags_tag_id_idx" ON "novel_tags" USING btree ("tag_id");--> statement-breakpoint
ALTER TABLE "novels" ADD CONSTRAINT "novels_author_id_novel_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."novel_authors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "novels_author_id_idx" ON "novels" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "novels_catalog_order_idx" ON "novels" USING btree ("created_at" DESC NULLS LAST,"id") WHERE "novels"."published_at" is not null;--> statement-breakpoint
CREATE INDEX "novels_updated_order_idx" ON "novels" USING btree ("updated_at" DESC NULLS LAST,"id");