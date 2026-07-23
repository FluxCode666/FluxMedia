-- API 密钥与审核级别治理的破坏性迁移。
--
-- 发布方必须先停止旧 Web 实例并排空连接。迁移也会在事务开头再次检查
-- relay_only=true；一旦发现历史纯中转数据，整次迁移失败且不删除任何旧列。
DO $$
DECLARE
  relay_key_count bigint;
BEGIN
  SELECT count(*)
  INTO relay_key_count
  FROM "external_api_key"
  WHERE "relay_only" IS TRUE;

  IF relay_key_count > 0 THEN
    RAISE EXCEPTION
      '0056 blocked: found % external_api_key rows with relay_only=true',
      relay_key_count;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO "system_setting" (
  "key",
  "value",
  "is_secret",
  "created_at",
  "updated_at"
)
VALUES (
  'CONTENT_MODERATION_BLOCK_RISK_LEVEL',
  '"high"'::json,
  false,
  now(),
  now()
)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
UPDATE "system_setting"
SET
  "value" = '"high"'::json,
  "updated_at" = now()
WHERE
  "key" = 'CONTENT_MODERATION_BLOCK_RISK_LEVEL'
  AND NOT COALESCE(
    json_typeof("value") = 'string'
    AND "value" #>> '{}' IN ('low', 'medium', 'high'),
    false
  );
--> statement-breakpoint
ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS "moderation_block_risk_level_override" text;
--> statement-breakpoint
UPDATE "user"
SET "moderation_block_risk_level_override" = NULL
WHERE "moderation_block_risk_level_override" IS NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.user'::regclass
      AND conname = 'user_moderation_block_risk_level_override_check'
  ) THEN
    ALTER TABLE "user"
      ADD CONSTRAINT "user_moderation_block_risk_level_override_check"
      CHECK (
        "moderation_block_risk_level_override" IS NULL
        OR "moderation_block_risk_level_override" IN ('low', 'medium', 'high')
      );
  END IF;
END $$;
--> statement-breakpoint
UPDATE "system_setting"
SET
  "value" = CASE
    WHEN json_typeof("value") IS DISTINCT FROM 'object' THEN "value"
    WHEN jsonb_typeof("value"::jsonb -> 'features') = 'object' THEN
      jsonb_set(
        "value"::jsonb - 'moderation',
        '{features}',
        ("value"::jsonb -> 'features') - 'externalApi.relay',
        false
      )::json
    ELSE ("value"::jsonb - 'moderation')::json
  END,
  "updated_at" = now()
WHERE "key" = 'PLAN_CAPABILITY_MATRIX';
--> statement-breakpoint
ALTER TABLE "user"
  DROP COLUMN IF EXISTS "moderation_block_risk_level";
--> statement-breakpoint
ALTER TABLE "external_api_key"
  DROP COLUMN IF EXISTS "moderation_block_risk_level",
  DROP COLUMN IF EXISTS "relay_only";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_audit_log_action_created_at_idx"
  ON "admin_audit_log" ("action", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_audit_log_target_user_id_created_at_idx"
  ON "admin_audit_log" ("target_user_id", "created_at");
