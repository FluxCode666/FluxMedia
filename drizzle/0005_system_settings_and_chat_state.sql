CREATE TABLE IF NOT EXISTS "system_setting" (
  "key" text PRIMARY KEY NOT NULL,
  "value" json NOT NULL,
  "is_secret" boolean DEFAULT false NOT NULL,
  "updated_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
 ALTER TABLE "system_setting"
 ADD CONSTRAINT "system_setting_updated_by_user_id_fk"
 FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id")
 ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "chat_no_image_state" (
  "user_id" text PRIMARY KEY NOT NULL,
  "consecutive_count" integer DEFAULT 0 NOT NULL,
  "last_generation_id" text,
  "last_penalty_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
 ALTER TABLE "chat_no_image_state"
 ADD CONSTRAINT "chat_no_image_state_user_id_user_id_fk"
 FOREIGN KEY ("user_id") REFERENCES "public"."user"("id")
 ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
