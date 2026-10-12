CREATE TABLE "admin_audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text NOT NULL,
	"actor_email" text,
	"action" text NOT NULL,
	"target_user_id" text,
	"target_email" text,
	"detail" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "admin_audit_log_created_at_idx" ON "admin_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "admin_audit_log_target_user_id_idx" ON "admin_audit_log" USING btree ("target_user_id");