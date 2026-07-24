-- 管理端全局历史按创建时间 keyset 浏览及按模型精确筛选使用。
-- IF NOT EXISTS 允许大表在维护窗口预建同名索引后，应用迁移安全汇合。
CREATE INDEX IF NOT EXISTS "generation_admin_history_created_id_idx"
  ON "generation" ("created_at" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "video_generation_admin_history_created_id_idx"
  ON "video_generation" ("created_at" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "generation_admin_history_model_created_id_idx"
  ON "generation" ("model", "created_at" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "video_generation_admin_history_model_created_id_idx"
  ON "video_generation" ("model", "created_at" DESC, "id" DESC);
