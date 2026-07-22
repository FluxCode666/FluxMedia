-- 使用日志不可变可见性证据与四分支 keyset 索引。
-- 旧 API 视频不能证明非 relay，因此列保持 NULL；仅新请求由应用显式写 true。
ALTER TABLE "generation"
  ADD COLUMN IF NOT EXISTS "usage_log_visible" boolean;

ALTER TABLE "video_generation"
  ADD COLUMN IF NOT EXISTS "usage_log_visible" boolean;

-- 新库直接执行普通索引；大表线上先 CONCURRENTLY 预建同名索引，再运行迁移。
CREATE INDEX IF NOT EXISTS "generation_usage_log_user_created_id_idx"
  ON "generation" ("user_id", "created_at" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "generation_usage_log_user_status_created_id_idx"
  ON "generation" ("user_id", "status", "created_at" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "video_generation_usage_log_user_created_id_idx"
  ON "video_generation" ("user_id", "created_at" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "video_generation_usage_log_user_status_created_id_idx"
  ON "video_generation" ("user_id", "status", "created_at" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "credit_usage_operation_usage_log_keyset_idx"
  ON "credit_usage_operation"
  ("user_id", "operation_created_at" DESC, "operation_type" DESC, "operation_id" DESC);

CREATE INDEX IF NOT EXISTS "credits_transaction_usage_log_refund_keyset_idx"
  ON "credits_transaction" ("user_id", "created_at" DESC, "id" DESC)
  WHERE "type" = 'refund';
