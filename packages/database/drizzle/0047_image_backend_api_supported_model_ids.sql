ALTER TABLE "image_backend_api"
  ADD COLUMN IF NOT EXISTS "supported_model_ids" json NOT NULL DEFAULT '[]'::json;
