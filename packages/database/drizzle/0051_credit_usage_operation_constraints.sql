-- 积分账本 operation context 的 contract 阶段约束。
--
-- 仅在所有旧 Web 实例退出且 credit_usage 回填对账为 ready 后投放。NOT VALID 仍会
-- 约束迁移后的新写入，但避免在本次短锁窗口内扫描历史账本；验证由 0052 独立执行。
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credits_transaction"
 ADD CONSTRAINT "credits_transaction_credit_usage_operation_required_check"
 CHECK (
   "type" NOT IN ('consumption', 'refund')
   OR (
     "operation_type" IS NOT NULL
     AND length(btrim("operation_type")) > 0
     AND "operation_id" IS NOT NULL
     AND length(btrim("operation_id")) > 0
     AND "operation_created_at" IS NOT NULL
   )
 ) NOT VALID;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
