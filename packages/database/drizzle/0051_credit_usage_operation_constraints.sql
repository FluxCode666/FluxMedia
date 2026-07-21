-- 积分账本 operation context 的 contract 阶段占位迁移。
--
-- 普通部署会在旧 Web 实例仍承接流量时先执行全部 migration。即使使用 NOT VALID，
-- 新约束也会立刻检查旧实例的新写入，因此不能在自动迁移链中投放。
-- 双写部署、credit_usage 回填对账和旧实例退出后，必须显式执行：
-- pnpm --filter @repo/web analytics:finalize-credit-contract -- --confirm-no-legacy-writers
SELECT 1;
