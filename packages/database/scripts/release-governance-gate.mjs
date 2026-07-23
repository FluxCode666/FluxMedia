/**
 * 生产迁移的只读 PostgreSQL 门禁。
 *
 * 使用方：deploy-production.yml 在停止旧 Web 后执行 drain/preflight，并在迁移后
 * 执行 postcheck。脚本只输出非敏感计数与状态，不输出连接串、行内容或凭据。
 */
import process from "node:process";

import pg from "pg";

const { Pool } = pg;
const GLOBAL_SETTING_KEY = "CONTENT_MODERATION_BLOCK_RISK_LEVEL";
const PLAN_MATRIX_SETTING_KEY = "PLAN_CAPABILITY_MATRIX";

/** 将 PostgreSQL bigint 计数收窄为安全整数。 */
function parseCount(value, label) {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(`${label} returned an invalid count`);
  }
  return count;
}

/** 输出可由部署脚本解析且不包含数据库内容的键值证据。 */
function printEvidence(key, value) {
  process.stdout.write(`${key}=${value}\n`);
}

/** 在只读事务中执行检查，异常时显式回滚。 */
async function inReadOnlyTransaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query("begin read only");
    await work(client);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** 确认旧 Web 的稳定 application_name 连接已全部排空。 */
async function assertWebConnectionsDrained(pool) {
  await inReadOnlyTransaction(pool, async (client) => {
    const result = await client.query(`
      select count(*)::text as count
      from pg_stat_activity
      where datname = current_database()
        and application_name = 'fluxmedia-web'
        and pid <> pg_backend_pid()
    `);
    const count = parseCount(result.rows[0]?.count, "web connection drain");
    printEvidence("web_connection_count", count);
    if (count !== 0) {
      throw new Error(`web connection drain failed: ${count} remain`);
    }
  });
}

/**
 * 检查历史纯中转数据；旧列已不存在时表明 0056 已完成，后续发布可安全跳过。
 */
async function assertRelayPreflight(pool) {
  await inReadOnlyTransaction(pool, async (client) => {
    const columnResult = await client.query(`
      select exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'external_api_key'
          and column_name = 'relay_only'
      ) as present
    `);
    const columnPresent = columnResult.rows[0]?.present === true;
    printEvidence(
      "relay_only_column",
      columnPresent ? "present" : "absent"
    );
    if (!columnPresent) {
      printEvidence("relay_only_true_count", 0);
      return;
    }

    const countResult = await client.query(`
      select count(*)::text as count
      from external_api_key
      where relay_only is true
    `);
    const count = parseCount(
      countResult.rows[0]?.count,
      "relay-only preflight"
    );
    printEvidence("relay_only_true_count", count);
    if (count !== 0) {
      throw new Error(`relay-only preflight failed: ${count} rows found`);
    }
  });
}

/**
 * 验证 0056 的 schema、策略、套餐 JSON 与审计索引不变量。
 * 首次删除旧列时额外要求所有管理员覆盖为空，后续发布允许合法覆盖继续存在。
 */
async function assertPostMigrationState(pool, requireEmptyOverrides) {
  await inReadOnlyTransaction(pool, async (client) => {
    const result = await client.query(
      `
        select
          (
            select count(*)::text
            from information_schema.columns
            where table_schema = 'public'
              and (
                (table_name = 'user'
                  and column_name = 'moderation_block_risk_level')
                or (
                  table_name = 'external_api_key'
                  and column_name in (
                    'moderation_block_risk_level',
                    'relay_only'
                  )
                )
              )
          ) as old_column_count,
          (
            select count(*)::text
            from "user"
            where moderation_block_risk_level_override is not null
              and moderation_block_risk_level_override not in (
                'low',
                'medium',
                'high'
              )
          ) as invalid_override_count,
          (
            select count(*)::text
            from "user"
            where moderation_block_risk_level_override is not null
          ) as non_null_override_count,
          (
            select count(*)::text
            from system_setting
            where key = $1
              and json_typeof(value) = 'string'
              and value #>> '{}' in ('low', 'medium', 'high')
          ) as valid_global_count,
          (
            select count(*)::text
            from system_setting
            where key = $2
              and (
                value::jsonb ? 'moderation'
                or coalesce(
                  (value::jsonb -> 'features') ? 'externalApi.relay',
                  false
                )
              )
          ) as obsolete_plan_count,
          (
            select count(*)::text
            from pg_indexes
            where schemaname = 'public'
              and indexname in (
                'admin_audit_log_action_created_at_idx',
                'admin_audit_log_target_user_id_created_at_idx'
              )
          ) as audit_index_count,
          exists (
            select 1
            from information_schema.columns
            where table_schema = 'public'
              and table_name = 'user'
              and column_name = 'moderation_block_risk_level_override'
              and is_nullable = 'YES'
          ) as override_column_valid,
          exists (
            select 1
            from pg_constraint
            where conrelid = 'public.user'::regclass
              and conname =
                'user_moderation_block_risk_level_override_check'
          ) as override_check_present
      `,
      [GLOBAL_SETTING_KEY, PLAN_MATRIX_SETTING_KEY]
    );
    const row = result.rows[0] ?? {};
    const oldColumnCount = parseCount(
      row.old_column_count,
      "old governance columns"
    );
    const invalidOverrideCount = parseCount(
      row.invalid_override_count,
      "invalid user moderation overrides"
    );
    const nonNullOverrideCount = parseCount(
      row.non_null_override_count,
      "non-null user moderation overrides"
    );
    const validGlobalCount = parseCount(
      row.valid_global_count,
      "global moderation policy"
    );
    const obsoletePlanCount = parseCount(
      row.obsolete_plan_count,
      "obsolete plan governance fields"
    );
    const auditIndexCount = parseCount(
      row.audit_index_count,
      "moderation audit indexes"
    );

    printEvidence("old_governance_column_count", oldColumnCount);
    printEvidence("invalid_user_override_count", invalidOverrideCount);
    printEvidence("non_null_user_override_count", nonNullOverrideCount);
    printEvidence("valid_global_policy_count", validGlobalCount);
    printEvidence("obsolete_plan_node_count", obsoletePlanCount);
    printEvidence("moderation_audit_index_count", auditIndexCount);
    printEvidence(
      "override_column_valid",
      row.override_column_valid === true
    );
    printEvidence(
      "override_check_present",
      row.override_check_present === true
    );

    if (
      oldColumnCount !== 0 ||
      invalidOverrideCount !== 0 ||
      validGlobalCount !== 1 ||
      obsoletePlanCount !== 0 ||
      auditIndexCount !== 2 ||
      row.override_column_valid !== true ||
      row.override_check_present !== true ||
      (requireEmptyOverrides && nonNullOverrideCount !== 0)
    ) {
      throw new Error("post-migration governance invariants failed");
    }
  });
}

/** 解析命令并执行唯一对应的只读门禁。 */
async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const command = process.argv.slice(2).find((argument) => argument !== "--");
  const pool = new Pool({
    application_name: "fluxmedia-release-gate",
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5_000,
    max: 1,
    query_timeout: 15_000,
  });
  try {
    if (command === "drain") {
      await assertWebConnectionsDrained(pool);
      return;
    }
    if (command === "preflight") {
      await assertRelayPreflight(pool);
      return;
    }
    if (command === "postcheck" || command === "postcheck-initial") {
      await assertPostMigrationState(pool, command === "postcheck-initial");
      return;
    }
    throw new Error(
      "expected one of: drain, preflight, postcheck, postcheck-initial"
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "unknown failure";
  process.stderr.write(`release governance gate failed: ${message}\n`);
  process.exitCode = 1;
});
