-- 历史记录按本人模型精确筛选和模型选项去重时使用的覆盖排序索引。
-- IF NOT EXISTS 允许新库迁移和线上预建同名索引安全汇合。
CREATE INDEX IF NOT EXISTS "generation_history_user_model_created_id_idx"
  ON "generation" ("user_id", "model", "created_at" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "video_generation_history_user_model_created_id_idx"
  ON "video_generation" ("user_id", "model", "created_at" DESC, "id" DESC);
