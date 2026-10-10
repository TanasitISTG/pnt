CREATE TABLE "provider_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"base_url" text NOT NULL,
	"api_key_enc" text NOT NULL,
	"model" text NOT NULL,
	"temperature" real DEFAULT 0.7 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provider_settings" ADD CONSTRAINT "provider_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;