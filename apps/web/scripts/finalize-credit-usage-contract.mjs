/**
 * 积分 operation context 的显式 contract 收口命令。
 *
 * 普通部署迁移不得提前约束仍在线的旧 Web 写入。本命令只能在新版双写已部署、
 * credit_usage 回填对账 ready 且旧实例全部退出后由运维显式执行；随后添加并验证
 * consumption/refund 非空 context 约束，以及 expand 阶段留下的 NOT VALID 约束。
 */
import { pathToFileURL } from "node:url";

import pg from "pg";

const { Client } = pg;
const CONFIRMATION_FLAG = "--confirm-no-legacy-writers";
const CONTRACT_LOCK_NAME = "credit_usage_contract_v1";

/** 校验唯一确认参数，避免普通脚本或自动部署误触发 contract。 */
function assertConfirmation(argumentsList) {
  const normalized = argumentsList.filter((argument) => argument !== "--");
  if (normalized.length !== 1 || normalized[0] !== CONFIRMATION_FLAG) {
    throw new RangeError(
      `必须仅传入 ${CONFIRMATION_FLAG}，并确认所有旧 Web 写入者已退出`
    );
  }
}

/** 将数据库 count 文本安全转换为非负整数。 */
function countValue(value, field) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`数据库返回非法计数 ${field}`);
  }
  return parsed;
}

/** 验证 credit_usage 已 ready，且账本、贡献投影不存在缺口。 */
async function assertCreditUsageReady(client) {
  const result = await client.query(
    `SELECT
       (SELECT count(*)::integer
          FROM analytics_read_model_state
         WHERE read_model = 'credit_usage'
           AND version = 1
           AND status = 'ready'
           AND last_reconciled_at IS NOT NULL) AS ready_count,
       (SELECT count(*)::integer
          FROM credits_transaction
         WHERE type IN ('consumption', 'refund')
           AND (
             operation_type IS NULL OR length(btrim(operation_type)) = 0
             OR operation_id IS NULL OR length(btrim(operation_id)) = 0
             OR operation_created_at IS NULL
           )) AS missing_context,
       (SELECT count(*)::integer
          FROM credits_transaction ledger
          FULL JOIN credit_usage_projection_entry projected
            ON projected.transaction_id = ledger.id
         WHERE (ledger.type IN ('consumption', 'refund') OR ledger.id IS NULL)
           AND (ledger.id IS NULL OR projected.transaction_id IS NULL))
         AS projection_gap`
  );
  const row = result.rows[0];
  if (
    countValue(row?.ready_count, "ready_count") !== 1 ||
    countValue(row?.missing_context, "missing_context") !== 0 ||
    countValue(row?.projection_gap, "projection_gap") !== 0
  ) {
    throw new Error(
      "credit_usage 尚未达到 contract 条件，请先完成回填和零差异对账"
    );
  }
}

/** 添加最终约束并验证所有 expand 阶段约束，任一失败时整体回滚。 */
async function finalizeConstraints(client) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      CONTRACT_LOCK_NAME,
    ]);
    await assertCreditUsageReady(client);
    await client.query(
      `DO $$ BEGIN
         ALTER TABLE credits_transaction
         ADD CONSTRAINT credits_transaction_credit_usage_operation_required_check
         CHECK (
           type NOT IN ('consumption', 'refund')
           OR (
             operation_type IS NOT NULL
             AND length(btrim(operation_type)) > 0
             AND operation_id IS NOT NULL
             AND length(btrim(operation_id)) > 0
             AND operation_created_at IS NOT NULL
           )
         ) NOT VALID;
       EXCEPTION WHEN duplicate_object THEN null;
       END $$`
    );
    for (const [table, constraint] of [
      [
        "credits_transaction",
        "credits_transaction_operation_context_all_or_none_check",
      ],
      [
        "credits_transaction",
        "credits_transaction_credit_usage_operation_required_check",
      ],
      ["credits_balance", "credits_balance_total_refunded_nonnegative_check"],
    ]) {
      await client.query(
        `ALTER TABLE ${table} VALIDATE CONSTRAINT ${constraint}`
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

/** 连接目标数据库并执行一次显式 contract 收口。 */
export async function main(argumentsList = process.argv.slice(2)) {
  assertConfirmation(argumentsList);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL 环境变量未设置");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("SET TIME ZONE 'UTC'");
    await finalizeConstraints(client);
    console.log("credit_usage contract 约束已添加并全部验证");
  } finally {
    await client.end();
  }
}

/** 仅在作为脚本直接运行时设置稳定退出码，导入测试不会连接数据库。 */
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : "未知 contract 错误"
    );
    process.exitCode = 1;
  });
}
