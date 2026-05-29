-- 积分消费幂等性约束（请求级 source_ref）
--
-- 背景：consumeCredits（扣费）此前无任何幂等键，重试 / 并发会重复扣费。
-- 与 grantCredits（发放，credits_batch (source_type, source_ref) 偏唯一）形成对比。
--
-- 本迁移给 credits_transaction 增加可空 source_ref 列，并建立
-- (type, source_ref) 偏唯一索引。consumeCredits 传入请求级 source_ref（如
-- `${generationId}:charge`）后，重复扣费将在数据库层被拒绝；配合应用层重查返回
-- 幂等结果。source_ref 为空的交易（绝大多数历史/无幂等需求扣费）不受约束，
-- 行为完全不变。
--
-- ⚠️ 应用前置检查：理论上历史交易 source_ref 均为 NULL，不会冲突。
-- 若先前已写入过非空 source_ref，请先排查重复：
--   SELECT type, source_ref, count(*)
--   FROM credits_transaction WHERE source_ref IS NOT NULL
--   GROUP BY type, source_ref HAVING count(*) > 1;
ALTER TABLE "credits_transaction"
 ADD COLUMN IF NOT EXISTS "source_ref" text;

CREATE UNIQUE INDEX IF NOT EXISTS "credits_transaction_type_source_ref_unique"
 ON "credits_transaction" ("type","source_ref")
 WHERE "source_ref" IS NOT NULL;
