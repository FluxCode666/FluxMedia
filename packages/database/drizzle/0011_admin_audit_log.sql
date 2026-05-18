CREATE TABLE IF NOT EXISTS "admin_audit_log" (
  "id" text PRIMARY KEY NOT NULL,
  "admin_user_id" text,
  "target_user_id" text,
  "action" text NOT NULL,
  "reason" text,
  "before" json,
  "after" json,
  "metadata" json,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_admin_user_id_user_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_target_user_id_user_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_audit_log_target_user_id_idx" ON "admin_audit_log" ("target_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_audit_log_admin_user_id_idx" ON "admin_audit_log" ("admin_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_audit_log_created_at_idx" ON "admin_audit_log" ("created_at");
