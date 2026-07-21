/**
 * 积分账本到计费操作净消耗的事务投影核心。
 *
 * 使用方是 `consumeCredits` 与退款 `grantCredits`。本模块把 sourceRef 继续限定为
 * 单笔账本幂等键，独立使用 operation type、ID 和原操作创建时间做聚合。
 * 纯语义通过结构化 store 注入便于 DB-free 测试；生产 store 捕获现有 Drizzle 事务。
 */

import type { db } from "@repo/database";
import {
  creditsBalance,
  creditUsageOperation,
  creditUsageProjectionEntry,
} from "@repo/database/schema";
import { and, eq, gte, sql } from "drizzle-orm";

const CREDIT_AMOUNT_SCALE = 100;
const CREDIT_AMOUNT_TOLERANCE = 1e-8;

/** 与单笔 sourceRef 解耦的稳定计费操作上下文。 */
export type CreditOperationContext = {
  operationType: string;
  operationId: string;
  operationCreatedAt: Date;
};

/** 一条已写入账本的消费或退款投影贡献。 */
export type CreditUsageContribution = {
  transactionId: string;
  transactionType: "consumption" | "refund";
  transactionCreatedAt: Date;
  userId: string;
  amount: number;
  operation: CreditOperationContext;
};

/** 无业务任务 ID 的手工操作可显式选择账本交易回退。 */
export type CreditOperationContextFallback = {
  kind: "ledger_transaction";
  operationType: string;
};

/** 解析 operation context 所需的账本时点与显式回退策略。 */
export type ResolveCreditOperationContextInput = {
  transactionId: string;
  transactionCreatedAt: Date;
  fallback?: CreditOperationContextFallback;
};

export type CreditUsageProjectionErrorCode =
  | "balance_missing"
  | "contribution_conflict"
  | "operation_context_mismatch"
  | "orphan_refund"
  | "refund_exceeds_gross";

/** 可对账、可分类的财务投影完整性错误。 */
export class CreditUsageProjectionError extends Error {
  /**
   * @param code 稳定失败码，供回填器和对账器分类。
   * @param message 面向运维的简体中文诊断信息。
   */
  constructor(
    public readonly code: CreditUsageProjectionErrorCode,
    message: string
  ) {
    super(message);
    this.name = "CreditUsageProjectionError";
  }
}

export type InsertCreditUsageContributionResult =
  | "inserted"
  | "duplicate"
  | "conflict";

export type ApplyCreditUsageOperationResult =
  | "applied"
  | CreditUsageProjectionErrorCode;

/**
 * 贡献去重与操作聚合所需的最小事务存储。
 *
 * insert 冲突时实现必须比对全部字段；只有完全一致才能返回 duplicate。
 */
export interface CreditUsageProjectionStore {
  insertContribution: (
    contribution: CreditUsageContribution
  ) => Promise<InsertCreditUsageContributionResult>;
  applyConsumption: (
    contribution: CreditUsageContribution
  ) => Promise<ApplyCreditUsageOperationResult>;
  applyRefund: (
    contribution: CreditUsageContribution
  ) => Promise<ApplyCreditUsageOperationResult>;
}

/** 校验字符串 ID 不为空或纯空白。 */
function assertNonemptyIdentifier(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new RangeError(`${field} must not be empty`);
  }
  return normalized;
}

/** 校验时间为有效 Date 并返回防御性副本。 */
function assertValidDate(value: Date, field: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new RangeError(`${field} must be a valid date`);
  }
  return new Date(value);
}

/** 校验积分金额有限、为正数且最多两位小数。 */
function assertValidCreditAmount(amount: number): void {
  const scaled = amount * CREDIT_AMOUNT_SCALE;
  if (
    !Number.isFinite(amount) ||
    amount <= 0 ||
    Math.abs(scaled - Math.round(scaled)) > CREDIT_AMOUNT_TOLERANCE
  ) {
    throw new RangeError(
      "credit amount must be finite, positive, and have at most two decimals"
    );
  }
}

/** 运行时校验并规范化计费操作上下文。 */
function normalizeCreditOperationContext(
  context: CreditOperationContext
): CreditOperationContext {
  return {
    operationType: assertNonemptyIdentifier(
      context.operationType,
      "operationType"
    ),
    operationId: assertNonemptyIdentifier(context.operationId, "operationId"),
    operationCreatedAt: assertValidDate(
      context.operationCreatedAt,
      "operationCreatedAt"
    ),
  };
}

/**
 * 解析显式操作上下文，或仅在调用方明确声明无业务任务时回退到账本 ID。
 *
 * @param context 业务操作的稳定上下文。
 * @param input 当前账本交易与显式 fallback；不包含 sourceRef，因为严禁解析幂等键。
 * @returns 规范化上下文；业务调用缺失上下文且未声明 fallback 时返回 null。
 */
export function resolveCreditOperationContext(
  context: CreditOperationContext | undefined,
  input: ResolveCreditOperationContextInput
): CreditOperationContext | null {
  if (context) {
    return normalizeCreditOperationContext(context);
  }
  if (!input.fallback) {
    return null;
  }
  return normalizeCreditOperationContext({
    operationType: input.fallback.operationType,
    operationId: input.transactionId,
    operationCreatedAt: input.transactionCreatedAt,
  });
}

/** 校验并规范化完整账本投影贡献。 */
function normalizeCreditUsageContribution(
  contribution: CreditUsageContribution
): CreditUsageContribution {
  assertValidCreditAmount(contribution.amount);
  if (
    contribution.transactionType !== "consumption" &&
    contribution.transactionType !== "refund"
  ) {
    throw new RangeError("transactionType must be consumption or refund");
  }
  return {
    transactionId: assertNonemptyIdentifier(
      contribution.transactionId,
      "transactionId"
    ),
    transactionType: contribution.transactionType,
    transactionCreatedAt: assertValidDate(
      contribution.transactionCreatedAt,
      "transactionCreatedAt"
    ),
    userId: assertNonemptyIdentifier(contribution.userId, "userId"),
    amount: contribution.amount,
    operation: normalizeCreditOperationContext(contribution.operation),
  };
}

/** 将 store 返回的失败码转换为中断整个事务的异常。 */
function throwProjectionFailure(
  result: Exclude<ApplyCreditUsageOperationResult, "applied">,
  contribution: CreditUsageContribution
): never {
  const prefix = `${contribution.transactionType} transaction ${contribution.transactionId}`;
  const messages: Record<CreditUsageProjectionErrorCode, string> = {
    balance_missing: `${prefix}: 退款用户积分账户不存在`,
    contribution_conflict: `${prefix}: 同一交易 ID 的投影内容不一致`,
    operation_context_mismatch: `${prefix}: 计费操作创建时间不一致`,
    orphan_refund: `${prefix}: 退款找不到原计费操作`,
    refund_exceeds_gross: `${prefix}: 退款超过原操作可退毛消费`,
  };
  throw new CreditUsageProjectionError(result, messages[result]);
}

/**
 * 在同一账本事务内应用一条唯一投影贡献。
 *
 * @param store 捕获当前账本事务的投影存储。
 * @param contribution 已写入同一事务账本的消费/退款事实。
 * @returns applied 表示是否首次应用；完全一致的 transaction 重放返回 false。
 * @throws 金额、身份或财务不变量失败时抛出，调用方事务必须整体回滚。
 */
export async function applyCreditUsageContribution(
  store: CreditUsageProjectionStore,
  contribution: CreditUsageContribution
): Promise<{ applied: boolean }> {
  const normalized = normalizeCreditUsageContribution(contribution);
  const inserted = await store.insertContribution(normalized);
  if (inserted === "conflict") {
    throwProjectionFailure("contribution_conflict", normalized);
  }
  if (inserted === "duplicate") {
    return { applied: false };
  }

  const result =
    normalized.transactionType === "consumption"
      ? await store.applyConsumption(normalized)
      : await store.applyRefund(normalized);
  if (result !== "applied") {
    throwProjectionFailure(result, normalized);
  }
  return { applied: true };
}

/** 比较已存贡献与重放请求的全部财务身份字段。 */
function isSameStoredContribution(
  existing: typeof creditUsageProjectionEntry.$inferSelect,
  contribution: CreditUsageContribution
): boolean {
  return (
    existing.transactionId === contribution.transactionId &&
    existing.userId === contribution.userId &&
    existing.contributionKind === contribution.transactionType &&
    existing.amount === contribution.amount &&
    existing.operationType === contribution.operation.operationType &&
    existing.operationId === contribution.operation.operationId &&
    existing.operationCreatedAt.getTime() ===
      contribution.operation.operationCreatedAt.getTime() &&
    existing.transactionCreatedAt.getTime() ===
      contribution.transactionCreatedAt.getTime()
  );
}

/**
 * 在已有 Drizzle 事务上构造财务投影 store，不创建或嵌套新事务。
 *
 * @param tx `consumeCredits` 或 `grantCredits` 当前事务。
 * @returns 所有贡献、聚合与累计退款都使用该 tx 的 store。
 */
export function createCreditUsageProjectionStore(
  tx: Pick<typeof db, "insert" | "select" | "update">
): CreditUsageProjectionStore {
  return {
    async insertContribution(contribution) {
      const inserted = await tx
        .insert(creditUsageProjectionEntry)
        .values({
          transactionId: contribution.transactionId,
          userId: contribution.userId,
          contributionKind: contribution.transactionType,
          amount: contribution.amount,
          operationType: contribution.operation.operationType,
          operationId: contribution.operation.operationId,
          operationCreatedAt: contribution.operation.operationCreatedAt,
          transactionCreatedAt: contribution.transactionCreatedAt,
        })
        .onConflictDoNothing({
          target: creditUsageProjectionEntry.transactionId,
        })
        .returning({
          transactionId: creditUsageProjectionEntry.transactionId,
        });
      if (inserted.length === 1) return "inserted";

      const [existing] = await tx
        .select()
        .from(creditUsageProjectionEntry)
        .where(
          eq(
            creditUsageProjectionEntry.transactionId,
            contribution.transactionId
          )
        )
        .limit(1);
      return existing && isSameStoredContribution(existing, contribution)
        ? "duplicate"
        : "conflict";
    },
    async applyConsumption(contribution) {
      const operation = contribution.operation;
      const updated = await tx
        .insert(creditUsageOperation)
        .values({
          userId: contribution.userId,
          operationType: operation.operationType,
          operationId: operation.operationId,
          operationCreatedAt: operation.operationCreatedAt,
          grossConsumed: contribution.amount,
          refunded: 0,
          netConsumed: contribution.amount,
          createdAt: contribution.transactionCreatedAt,
          updatedAt: contribution.transactionCreatedAt,
        })
        .onConflictDoUpdate({
          target: [
            creditUsageOperation.userId,
            creditUsageOperation.operationType,
            creditUsageOperation.operationId,
          ],
          set: {
            grossConsumed: sql`${creditUsageOperation.grossConsumed} + ${contribution.amount}`,
            netConsumed: sql`${creditUsageOperation.netConsumed} + ${contribution.amount}`,
            updatedAt: contribution.transactionCreatedAt,
          },
          setWhere: eq(
            creditUsageOperation.operationCreatedAt,
            operation.operationCreatedAt
          ),
        })
        .returning({ operationId: creditUsageOperation.operationId });
      return updated.length === 1 ? "applied" : "operation_context_mismatch";
    },
    async applyRefund(contribution) {
      const operation = contribution.operation;
      const operationKey = and(
        eq(creditUsageOperation.userId, contribution.userId),
        eq(creditUsageOperation.operationType, operation.operationType),
        eq(creditUsageOperation.operationId, operation.operationId)
      );
      const [existing] = await tx
        .select({
          grossConsumed: creditUsageOperation.grossConsumed,
          refunded: creditUsageOperation.refunded,
          operationCreatedAt: creditUsageOperation.operationCreatedAt,
        })
        .from(creditUsageOperation)
        .where(operationKey)
        .limit(1)
        .for("update");
      if (!existing) return "orphan_refund";
      if (
        existing.operationCreatedAt.getTime() !==
        operation.operationCreatedAt.getTime()
      ) {
        return "operation_context_mismatch";
      }
      if (existing.refunded + contribution.amount > existing.grossConsumed) {
        return "refund_exceeds_gross";
      }

      const updated = await tx
        .update(creditUsageOperation)
        .set({
          refunded: sql`${creditUsageOperation.refunded} + ${contribution.amount}`,
          netConsumed: sql`${creditUsageOperation.netConsumed} - ${contribution.amount}`,
          updatedAt: contribution.transactionCreatedAt,
        })
        .where(
          and(
            operationKey,
            eq(
              creditUsageOperation.operationCreatedAt,
              operation.operationCreatedAt
            ),
            gte(
              sql`${creditUsageOperation.grossConsumed} - ${creditUsageOperation.refunded}`,
              contribution.amount
            )
          )
        )
        .returning({ operationId: creditUsageOperation.operationId });
      if (updated.length !== 1) return "refund_exceeds_gross";

      const balance = await tx
        .update(creditsBalance)
        .set({
          totalRefunded: sql`${creditsBalance.totalRefunded} + ${contribution.amount}`,
          updatedAt: contribution.transactionCreatedAt,
        })
        .where(eq(creditsBalance.userId, contribution.userId))
        .returning({ userId: creditsBalance.userId });
      return balance.length === 1 ? "applied" : "balance_missing";
    },
  };
}
