-- 外部 API Key 纯中转模式开关
--
-- relay_only=true 时，该 key 发起的 v1 请求不写生成历史(generation)、
-- 不上传对象存储、站内画廊不可查看；仅保留扣费/审核/额度计数。
-- 用于保护用户隐私与安全，且不额外占用服务器存储资源。
-- 默认 false（行为与现有 key 完全一致）。
ALTER TABLE "external_api_key"
 ADD COLUMN IF NOT EXISTS "relay_only" boolean NOT NULL DEFAULT false;
