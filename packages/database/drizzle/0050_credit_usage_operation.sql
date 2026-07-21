-- 积分计费操作净消耗读模型（expand 阶段）。
--
-- 账本 credits_transaction 仍是唯一财务真相。source_ref 继续只负责单笔幂等；
-- operation_* 把同一操作的初扣、补扣和退款关联到可重建投影。
DO $$ BEGIN
 CREATE TYPE "public"."credit_usage_contribution_kind" AS ENUM('consumption', 'refund');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "credits_transaction"
 ADD COLUMN IF NOT EXISTS "operation_type" text,
 ADD COLUMN IF NOT EXISTS "operation_id" text,
 ADD COLUMN IF NOT EXISTS "operation_created_at" timestamp;
--> statement-breakpoint
ALTER TABLE "credits_balance"
 ADD COLUMN IF NOT EXISTS "total_refunded" numeric(18,2) DEFAULT 0 NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credits_balance"
 ADD CONSTRAINT "credits_balance_total_refunded_nonnegative_check"
 CHECK ("total_refunded" >= 0) NOT VALID;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credits_transaction"
 ADD CONSTRAINT "credits_transaction_operation_context_all_or_none_check"
 CHECK (
   ("operation_type" IS NULL AND "operation_id" IS NULL AND "operation_created_at" IS NULL)
   OR
   ("operation_type" IS NOT NULL AND "operation_id" IS NOT NULL AND "operation_created_at" IS NOT NULL)
 ) NOT VALID;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "credit_usage_operation" (
  "user_id" text NOT NULL,
  "operation_type" text NOT NULL,
  "operation_id" text NOT NULL,
  "operation_created_at" timestamp NOT NULL,
  "gross_consumed" numeric(18,2) DEFAULT 0 NOT NULL,
  "refunded" numeric(18,2) DEFAULT 0 NOT NULL,
  "net_consumed" numeric(18,2) DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "credit_usage_operation_user_type_id_pk"
    PRIMARY KEY("user_id", "operation_type", "operation_id"),
  CONSTRAINT "credit_usage_operation_identity_nonempty_check"
    CHECK (length(btrim("operation_type")) > 0 AND length(btrim("operation_id")) > 0),
  CONSTRAINT "credit_usage_operation_amounts_check"
    CHECK (
      "gross_consumed" >= 0
      AND "refunded" >= 0
      AND "refunded" <= "gross_consumed"
      AND "net_consumed" = "gross_consumed" - "refunded"
    )
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "credit_usage_projection_entry" (
  "transaction_id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "contribution_kind" "credit_usage_contribution_kind" NOT NULL,
  "amount" numeric(18,2) NOT NULL,
  "operation_type" text NOT NULL,
  "operation_id" text NOT NULL,
  "operation_created_at" timestamp NOT NULL,
  "transaction_created_at" timestamp NOT NULL,
  "projected_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "credit_usage_projection_entry_identity_nonempty_check"
    CHECK (length(btrim("operation_type")) > 0 AND length(btrim("operation_id")) > 0),
  CONSTRAINT "credit_usage_projection_entry_amount_positive_check"
    CHECK ("amount" > 0)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credit_usage_operation"
 ADD CONSTRAINT "credit_usage_operation_user_id_user_id_fk"
 FOREIGN KEY ("user_id") REFERENCES "public"."user"("id")
 ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credit_usage_projection_entry"
 ADD CONSTRAINT "credit_usage_projection_entry_transaction_id_fk"
 FOREIGN KEY ("transaction_id") REFERENCES "public"."credits_transaction"("id")
 ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credit_usage_projection_entry"
 ADD CONSTRAINT "credit_usage_projection_entry_user_id_user_id_fk"
 FOREIGN KEY ("user_id") REFERENCES "public"."user"("id")
 ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_usage_operation_user_created_at_idx"
 ON "credit_usage_operation" USING btree ("user_id", "operation_created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_usage_projection_entry_user_operation_idx"
 ON "credit_usage_projection_entry" USING btree ("user_id", "operation_type", "operation_id");
--> statement-breakpoint
INSERT INTO "analytics_read_model_state" ("read_model", "version", "status")
VALUES ('credit_usage', 1, 'building')
ON CONFLICT ("read_model") DO NOTHING;
