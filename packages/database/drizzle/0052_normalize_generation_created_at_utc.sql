-- 将旧图片生成记录的本地墙上时间归一化为 UTC，并原子切换后续默认值。
--
-- 旧写入路径依赖 timestamp without time zone 的 DEFAULT now()。当 PostgreSQL 会话不在
-- UTC 时，created_at 保存会话时区的墙上时间；Drizzle 却固定按 UTC 解析，前端随后再按
-- 应用时区格式化，导致时区偏移被重复计算。
--
-- 迁移期间旧 Web 仍可能承接请求，因此必须先锁住 generation 的写入。锁释放后，即便
-- 旧代码仍省略 created_at，也会使用与会话时区无关的 UTC 默认值，不会产生迁移漏网行。
LOCK TABLE "generation" IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
DO $$
DECLARE
  legacy_time_zone text := current_setting('TimeZone');
  completed_count bigint;
  legacy_evidence_count bigint;
  utc_evidence_count bigint;
  generation_count bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_timezone_names
    WHERE name = legacy_time_zone
  ) THEN
    RAISE EXCEPTION '0052 无法识别旧 PostgreSQL 会话时区：%', legacy_time_zone;
  END IF;

  SELECT
    count(*),
    count(*) FILTER (WHERE "completed_at" IS NOT NULL),
    count(*) FILTER (
      WHERE "completed_at" IS NOT NULL
        AND "completed_at" >=
          (("created_at" AT TIME ZONE legacy_time_zone) AT TIME ZONE 'UTC')
        -- 生图运行时硬超时为 20 分钟；45 分钟上限留出队列与落库余量。对本次
        -- Asia/Shanghai 数据可明确区分两种口径；较小时区偏移若证据重叠则拒绝迁移。
        AND "completed_at" -
          (("created_at" AT TIME ZONE legacy_time_zone) AT TIME ZONE 'UTC')
          <= interval '45 minutes'
    ),
    count(*) FILTER (
      WHERE "completed_at" IS NOT NULL
        AND "completed_at" >= "created_at"
        AND "completed_at" - "created_at" <= interval '45 minutes'
    )
  INTO
    generation_count,
    completed_count,
    legacy_evidence_count,
    utc_evidence_count
  FROM "generation";

  IF generation_count = 0 THEN
    NULL;
  ELSIF legacy_time_zone = 'UTC' THEN
    IF completed_count > 0 AND utc_evidence_count <> completed_count THEN
      RAISE EXCEPTION
        '0052 当前会话已是 UTC，但 % 条完成记录中仅 % 条符合 UTC 口径，无法推断旧时区',
        completed_count,
        utc_evidence_count;
    END IF;
  ELSIF completed_count = 0 THEN
    RAISE EXCEPTION
      '0052 无完成记录可判断 % 条 generation 的旧时间口径，请先人工核验',
      generation_count;
  ELSIF
    legacy_evidence_count = completed_count
    AND utc_evidence_count = 0
  THEN
    UPDATE "generation"
    SET "created_at" =
      ("created_at" AT TIME ZONE legacy_time_zone) AT TIME ZONE 'UTC';
  ELSIF utc_evidence_count = completed_count AND legacy_evidence_count = 0 THEN
    NULL;
  ELSE
    RAISE EXCEPTION
      '0052 检测到混合或不明确的 generation 时间口径：完成记录 % 条，旧口径证据 % 条，UTC 证据 % 条',
      completed_count,
      legacy_evidence_count,
      utc_evidence_count;
  END IF;

  ALTER TABLE "generation"
    ALTER COLUMN "created_at"
    SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC');
END $$;
