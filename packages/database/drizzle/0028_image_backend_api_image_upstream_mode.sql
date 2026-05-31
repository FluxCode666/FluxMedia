ALTER TABLE "image_backend_api"
  ADD COLUMN IF NOT EXISTS "image_upstream_mode" text NOT NULL DEFAULT 'images';
