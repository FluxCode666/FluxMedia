ALTER TABLE "image_backend_api"
  ADD COLUMN IF NOT EXISTS "parameter_mappings" json NOT NULL DEFAULT '[]'::json;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "image_backend_parameter_mapping_template" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "parameter_mappings" json NOT NULL DEFAULT '[]'::json,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "image_backend_parameter_mapping_template_name_unique"
  ON "image_backend_parameter_mapping_template" ("name");
