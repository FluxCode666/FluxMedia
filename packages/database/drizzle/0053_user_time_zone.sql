-- 用户展示时区只保存显式偏好；NULL 表示继承部署环境 APP_TIME_ZONE。
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "time_zone" text;
--> statement-breakpoint
-- APP_TIME_ZONE 不再属于可写系统设置，清理旧值以防启动引导覆盖真实部署环境。
DELETE FROM "system_setting" WHERE "key" = 'APP_TIME_ZONE';
