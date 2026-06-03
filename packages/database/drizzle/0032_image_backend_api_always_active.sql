ALTER TABLE "image_backend_api"
  ADD COLUMN IF NOT EXISTS "always_active" boolean DEFAULT false NOT NULL;
