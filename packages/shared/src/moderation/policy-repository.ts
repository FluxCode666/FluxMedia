/**
 * 内容审核策略的 PostgreSQL 仓储适配器。
 *
 * 职责：用参数化 SQL 实现强一致读取、行锁、策略写入和事务内审计，
 * 并把 node-postgres 与 Neon 的结果归一为领域服务端口。
 * 使用方：policy-service.ts 的默认生产服务；集成测试直接验证本适配器。
 * 关键依赖：Drizzle SQL、@repo/database、policy-contract、policy-service 类型端口。
 */
import { sql } from "drizzle-orm";
import { z } from "zod";

import { APP_USER_ROLES } from "../auth/roles";
import { CONTENT_MODERATION_BLOCK_RISK_LEVEL_SETTING_KEY } from "./policy-contract";
import type {
  AdminAuditLogInsert,
  LockedGlobalPolicy,
  ModerationPolicyRepository,
  ModerationPolicyTransaction,
} from "./policy-service";

const appUserRoleSchema = z.enum(APP_USER_ROLES);

const globalPolicyRowSchema = z.object({
  value: z.unknown(),
  updated_at: z.coerce.date(),
});

const userPolicyReadRowSchema = z.object({
  global_default: z.unknown().optional(),
  user_id: z.string().nullable(),
  user_role: appUserRoleSchema.nullable(),
  user_override: z.unknown().optional(),
});

const lockedUserPolicyRowSchema = z.object({
  user_id: z.string(),
  user_role: appUserRoleSchema,
  user_override: z.unknown().optional(),
  updated_at: z.coerce.date(),
});

/**
 * 从 node-postgres 与 Neon 的不同 execute 返回形态中提取行数组。
 *
 * @param result - Drizzle execute 的未知返回值。
 * @returns 可安全逐行校验的未知值数组。
 */
function extractRows(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows: unknown }).rows;
    return Array.isArray(rows) ? rows : [];
  }
  return [];
}

/**
 * 校验并映射数据库全站设置行。
 *
 * @param value - 尚未信任的数据库行。
 * @returns 领域服务使用的全站策略记录。
 * @throws ZodError 数据库行结构不符合契约时抛出。
 */
function parseGlobalPolicyRow(value: unknown): LockedGlobalPolicy {
  const parsed = globalPolicyRowSchema.parse(value);
  return { value: parsed.value, updatedAt: parsed.updated_at };
}

/**
 * 确认写语句确实命中已加锁记录。
 *
 * @param result - 带 RETURNING 的写语句结果。
 * @param resource - 安全错误消息中的资源名称。
 * @throws Error 记录在锁内异常消失时抛出。
 */
function assertMutationReturnedRow(result: unknown, resource: string): void {
  if (extractRows(result).length > 0) return;
  throw new Error(`${resource} disappeared during the locked transaction`);
}

/** 将结构化审计值编码为 PostgreSQL JSON 输入。 */
function serializeJson(value: Record<string, unknown>): string {
  return JSON.stringify(value);
}

/**
 * 创建绑定到当前 Drizzle 事务的策略端口。
 *
 * @param tx - 仅暴露参数化 execute 的 Drizzle 事务。
 * @returns 领域服务可调用的加锁、写入和审计端口。
 */
function createDrizzleTransactionPort(tx: {
  execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
}): ModerationPolicyTransaction {
  return {
    async lockGlobalPolicy() {
      const result = await tx.execute(sql`
        select value, updated_at
        from system_setting
        where key = ${CONTENT_MODERATION_BLOCK_RISK_LEVEL_SETTING_KEY}
        for update
      `);
      const row = extractRows(result)[0];
      return row ? parseGlobalPolicyRow(row) : null;
    },
    async updateGlobalPolicy(input) {
      const result = await tx.execute(sql`
        update system_setting
        set value = ${JSON.stringify(input.level)}::json,
            updated_by = ${input.actorUserId},
            updated_at = ${input.updatedAt}
        where key = ${CONTENT_MODERATION_BLOCK_RISK_LEVEL_SETTING_KEY}
        returning key
      `);
      assertMutationReturnedRow(result, "global moderation policy");
    },
    async lockUserPolicy(userId) {
      const result = await tx.execute(sql`
        select id as user_id,
               role::text as user_role,
               moderation_block_risk_level_override as user_override,
               updated_at
        from "user"
        where id = ${userId}
        for update
      `);
      const row = extractRows(result)[0];
      if (!row) return null;
      const parsed = lockedUserPolicyRowSchema.parse(row);
      return {
        id: parsed.user_id,
        role: parsed.user_role,
        userOverride: parsed.user_override ?? null,
        updatedAt: parsed.updated_at,
      };
    },
    async updateUserOverride(input) {
      const result = await tx.execute(sql`
        update "user"
        set moderation_block_risk_level_override = ${input.level},
            updated_at = ${input.updatedAt}
        where id = ${input.userId}
        returning id
      `);
      assertMutationReturnedRow(result, "user moderation policy");
    },
    async readGlobalPolicy() {
      const result = await tx.execute(sql`
        select value, updated_at
        from system_setting
        where key = ${CONTENT_MODERATION_BLOCK_RISK_LEVEL_SETTING_KEY}
        limit 1
      `);
      const row = extractRows(result)[0];
      return row ? parseGlobalPolicyRow(row) : null;
    },
    async insertAuditLog(input: AdminAuditLogInsert) {
      const result = await tx.execute(sql`
        insert into admin_audit_log (
          id,
          admin_user_id,
          target_user_id,
          action,
          reason,
          before,
          after,
          metadata,
          created_at
        ) values (
          ${input.id},
          ${input.adminUserId},
          ${input.targetUserId},
          ${input.action},
          ${input.reason},
          ${serializeJson(input.before)}::json,
          ${serializeJson(input.after)}::json,
          ${serializeJson(input.metadata)}::json,
          ${input.createdAt}
        )
        returning id
      `);
      assertMutationReturnedRow(result, "moderation policy audit log");
    },
  };
}

/** 默认仓储：所有读取直达 PostgreSQL，不经过系统设置缓存。 */
export const defaultModerationPolicyRepository: ModerationPolicyRepository = {
  async readGlobalPolicy() {
    const { db } = await import("@repo/database");
    const result = await db.execute(sql`
      select value, updated_at
      from system_setting
      where key = ${CONTENT_MODERATION_BLOCK_RISK_LEVEL_SETTING_KEY}
      limit 1
    `);
    const row = extractRows(result)[0];
    return row ? parseGlobalPolicyRow(row) : null;
  },
  async readUserPolicy(userId) {
    const { db } = await import("@repo/database");
    const result = await db.execute(sql`
      select
        (
          select value
          from system_setting
          where key = ${CONTENT_MODERATION_BLOCK_RISK_LEVEL_SETTING_KEY}
          limit 1
        ) as global_default,
        target.id as user_id,
        target.role::text as user_role,
        target.moderation_block_risk_level_override as user_override
      from (select 1) as seed
      left join "user" as target on target.id = ${userId}
      limit 1
    `);
    const rawRow = extractRows(result)[0];
    const row = userPolicyReadRowSchema.parse(rawRow);
    return {
      globalDefault: row.global_default,
      user:
        row.user_id && row.user_role
          ? {
              id: row.user_id,
              role: row.user_role,
              userOverride: row.user_override ?? null,
            }
          : null,
    };
  },
  async transaction<T>(work: (tx: ModerationPolicyTransaction) => Promise<T>) {
    const { db } = await import("@repo/database");
    return db.transaction(async (tx) =>
      work(
        createDrizzleTransactionPort({
          execute: (query) => tx.execute(query),
        })
      )
    );
  },
};
