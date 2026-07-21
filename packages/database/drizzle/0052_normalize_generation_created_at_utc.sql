-- 将旧图片生成记录的北京时间墙上值归一化为 UTC 墙上值。
--
-- 旧写入路径依赖 timestamp without time zone 的 DEFAULT now()；当 PostgreSQL 会话为
-- Asia/Shanghai 时，created_at 保存北京时间。Drizzle 会把无时区 timestamp 固定按
-- UTC 解析，页面再按 Asia/Shanghai 展示后就重复增加 8 小时。
--
-- 本迁移在新 Web 实例启动前执行；倒置的 completed_at 是 UTC、created_at 是北京时间，
-- 可作为旧数据存在的确定证据。首次执行归一化当时已有的全部记录；归一化后倒置消失，
-- 即使 SQL 被重复执行也会自然 no-op。新连接同时强制 UTC，后续 DEFAULT now() 不再混入
-- 本地墙上时间。
UPDATE "generation"
SET "created_at" =
  ("created_at" AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'UTC'
WHERE EXISTS (
  SELECT 1
  FROM "generation" AS "legacy_generation"
  WHERE "legacy_generation"."completed_at" IS NOT NULL
    AND "legacy_generation"."created_at" > "legacy_generation"."completed_at"
);
