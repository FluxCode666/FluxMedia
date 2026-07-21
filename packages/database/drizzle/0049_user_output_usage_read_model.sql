-- 用户控制台成功产物统计的可重建读模型。
-- 使用方：图片/视频完成事务、统计回填与本人用量查询；源任务表仍是产物真相。
DO $$ BEGIN
 CREATE TYPE "public"."output_usage_kind" AS ENUM('image', 'video');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."analytics_read_model_status" AS ENUM('building', 'backfilling', 'reconciling', 'ready', 'failed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_output_usage_event" (
  "output_kind" "output_usage_kind" NOT NULL,
  "source_task_id" text NOT NULL,
  "user_id" text NOT NULL,
  "operation_created_at" timestamp NOT NULL,
  "image_count" integer DEFAULT 0 NOT NULL,
  "video_seconds" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "user_output_usage_event_output_kind_source_task_id_pk" PRIMARY KEY("output_kind", "source_task_id"),
  CONSTRAINT "user_output_usage_event_metric_check" CHECK (
    ("output_kind" = 'image' AND "image_count" > 0 AND "video_seconds" = 0)
    OR
    ("output_kind" = 'video' AND "image_count" = 0 AND "video_seconds" > 0)
  )
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_usage_summary" (
  "user_id" text PRIMARY KEY NOT NULL,
  "total_image_count" bigint DEFAULT 0 NOT NULL,
  "total_video_seconds" bigint DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "user_usage_summary_nonnegative_check" CHECK (
    "total_image_count" >= 0 AND "total_video_seconds" >= 0
  )
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "analytics_read_model_state" (
  "read_model" text PRIMARY KEY NOT NULL,
  "version" integer NOT NULL,
  "status" "analytics_read_model_status" DEFAULT 'building' NOT NULL,
  "snapshot_high_water" json,
  "catch_up_water" json,
  "details" json,
  "last_reconciled_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_output_usage_event" ADD CONSTRAINT "user_output_usage_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_usage_summary" ADD CONSTRAINT "user_usage_summary_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_output_usage_event_user_created_kind_idx" ON "user_output_usage_event" USING btree ("user_id", "operation_created_at", "output_kind");
--> statement-breakpoint
INSERT INTO "analytics_read_model_state" ("read_model", "version", "status")
VALUES ('output_usage', 1, 'building')
ON CONFLICT ("read_model") DO NOTHING;
