/**
 * 积分计费操作投影的 DB-free 语义测试。
 *
 * 使用内存事务存储验证账本交易去重、消费与退款聚合、
 * 非法退款回滚和操作创建时间不变量，不连接 PostgreSQL。
 */

import { describe, expect, it } from "vitest";

import {
  applyCreditUsageContribution,
  type CreditOperationContext,
  type CreditUsageContribution,
  CreditUsageProjectionError,
  type CreditUsageProjectionStore,
  resolveCreditOperationContext,
} from "./usage-read-model";

type OperationState = CreditOperationContext & {
  grossConsumed: number;
  netConsumed: number;
  refunded: number;
  userId: string;
};

type MemoryState = {
  entries: Map<string, CreditUsageContribution>;
  operations: Map<string, OperationState>;
  totalRefunded: number;
  totalSpent: number;
};

const operation = {
  operationType: "image_generation",
  operationId: "generation-1",
  operationCreatedAt: new Date("2026-07-20T23:00:00.000Z"),
} satisfies CreditOperationContext;

/** 构造一条默认的消费贡献，允许测试定向覆盖字段。 */
function consumption(
  overrides: Partial<CreditUsageContribution> = {}
): CreditUsageContribution {
  return {
    transactionId: "transaction-consume-1",
    transactionType: "consumption",
    transactionCreatedAt: new Date("2026-07-21T00:00:00.000Z"),
    userId: "user-1",
    amount: 100,
    operation,
    ...overrides,
  };
}

/** 构造一条指向默认计费操作的退款贡献。 */
function refund(
  overrides: Partial<CreditUsageContribution> = {}
): CreditUsageContribution {
  return {
    transactionId: "transaction-refund-1",
    transactionType: "refund",
    transactionCreatedAt: new Date("2026-07-21T01:00:00.000Z"),
    userId: "user-1",
    amount: 100,
    operation,
    ...overrides,
  };
}

/** 使用用户、类型和操作 ID 构造聚合主键。 */
function operationKey(input: {
  userId: string;
  operation: CreditOperationContext;
}): string {
  return [
    input.userId,
    input.operation.operationType,
    input.operation.operationId,
  ].join(":");
}

/** 比较两条投影贡献是否为同一账本事实的完整重放。 */
function sameContribution(
  left: CreditUsageContribution,
  right: CreditUsageContribution
): boolean {
  return (
    left.transactionId === right.transactionId &&
    left.transactionType === right.transactionType &&
    left.transactionCreatedAt.getTime() ===
      right.transactionCreatedAt.getTime() &&
    left.userId === right.userId &&
    left.amount === right.amount &&
    left.operation.operationType === right.operation.operationType &&
    left.operation.operationId === right.operation.operationId &&
    left.operation.operationCreatedAt.getTime() ===
      right.operation.operationCreatedAt.getTime()
  );
}

/** 克隆内存数据库状态，使失败分支可以丢弃草稿模拟回滚。 */
function cloneState(state: MemoryState): MemoryState {
  return {
    entries: new Map(
      [...state.entries].map(([key, value]) => [
        key,
        {
          ...value,
          transactionCreatedAt: new Date(value.transactionCreatedAt),
          operation: {
            ...value.operation,
            operationCreatedAt: new Date(value.operation.operationCreatedAt),
          },
        },
      ])
    ),
    operations: new Map(
      [...state.operations].map(([key, value]) => [
        key,
        {
          ...value,
          operationCreatedAt: new Date(value.operationCreatedAt),
        },
      ])
    ),
    totalRefunded: state.totalRefunded,
    totalSpent: state.totalSpent,
  };
}

/**
 * 内存事务容器；只有投影全部成功才提交草稿状态。
 */
class MemoryProjectionDatabase {
  state: MemoryState = {
    entries: new Map(),
    operations: new Map(),
    totalRefunded: 0,
    totalSpent: 0,
  };

  /** 在可回滚草稿上应用一条账本贡献。 */
  async apply(contribution: CreditUsageContribution) {
    const draft = cloneState(this.state);
    const result = await applyCreditUsageContribution(
      createMemoryStore(draft),
      contribution
    );
    this.state = draft;
    return result;
  }
}

/** 在内存状态上创建与生产适配器同形的最小存储。 */
function createMemoryStore(state: MemoryState): CreditUsageProjectionStore {
  return {
    async insertContribution(contribution) {
      const existing = state.entries.get(contribution.transactionId);
      if (existing) {
        return sameContribution(existing, contribution)
          ? "duplicate"
          : "conflict";
      }
      state.entries.set(contribution.transactionId, contribution);
      return "inserted";
    },
    async applyConsumption(contribution) {
      const key = operationKey(contribution);
      const existing = state.operations.get(key);
      if (
        existing &&
        existing.operationCreatedAt.getTime() !==
          contribution.operation.operationCreatedAt.getTime()
      ) {
        return "operation_context_mismatch";
      }
      if (existing) {
        existing.grossConsumed += contribution.amount;
        existing.netConsumed += contribution.amount;
      } else {
        state.operations.set(key, {
          ...contribution.operation,
          userId: contribution.userId,
          grossConsumed: contribution.amount,
          refunded: 0,
          netConsumed: contribution.amount,
        });
      }
      return "applied";
    },
    async applyRefund(contribution) {
      const key = operationKey(contribution);
      const existing = state.operations.get(key);
      if (!existing) return "orphan_refund";
      if (
        existing.operationCreatedAt.getTime() !==
        contribution.operation.operationCreatedAt.getTime()
      ) {
        return "operation_context_mismatch";
      }
      if (existing.refunded + contribution.amount > existing.grossConsumed) {
        return "refund_exceeds_gross";
      }
      existing.refunded += contribution.amount;
      existing.netConsumed -= contribution.amount;
      state.totalRefunded += contribution.amount;
      return "applied";
    },
  };
}

describe("credit usage read model", () => {
  it("does not infer an operation id by parsing a legacy sourceRef", () => {
    const legacyTransaction = {
      sourceRef: "generation-1:image-actual-size:charge",
      transactionId: "transaction-1",
      transactionCreatedAt: new Date("2026-07-21T00:00:00.000Z"),
    };
    expect(
      resolveCreditOperationContext(undefined, legacyTransaction)
    ).toBeNull();

    expect(
      resolveCreditOperationContext(undefined, {
        transactionId: "transaction-2",
        transactionCreatedAt: new Date("2026-07-21T00:00:00.000Z"),
        fallback: { kind: "ledger_transaction", operationType: "manual" },
      })
    ).toEqual({
      operationType: "manual",
      operationId: "transaction-2",
      operationCreatedAt: new Date("2026-07-21T00:00:00.000Z"),
    });
  });

  it.each([
    0,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    1.001,
  ])("rejects invalid or over-precision amount %s before storage", async (amount) => {
    const database = new MemoryProjectionDatabase();
    await expect(database.apply(consumption({ amount }))).rejects.toThrow(
      /amount|credit/i
    );
    expect(database.state.entries).toHaveLength(0);
    expect(database.state.operations).toHaveLength(0);
  });

  it("applies the same transaction id at most once", async () => {
    const database = new MemoryProjectionDatabase();
    await expect(database.apply(consumption())).resolves.toEqual({
      applied: true,
    });
    await expect(database.apply(consumption())).resolves.toEqual({
      applied: false,
    });

    expect(database.state.entries).toHaveLength(1);
    expect(database.state.operations.get(operationKey(consumption()))).toEqual(
      expect.objectContaining({ grossConsumed: 100, netConsumed: 100 })
    );
  });

  it.each([
    ["user", { userId: "user-2" }],
    ["operation type", { operation: { ...operation, operationType: "chat" } }],
    ["operation id", { operation: { ...operation, operationId: "other" } }],
    [
      "operation createdAt",
      {
        operation: {
          ...operation,
          operationCreatedAt: new Date("2026-07-19T00:00:00.000Z"),
        },
      },
    ],
    ["direction", { transactionType: "refund" as const }],
    ["amount", { amount: 99 }],
    [
      "transaction createdAt",
      { transactionCreatedAt: new Date("2026-07-21T00:00:01.000Z") },
    ],
  ])("rejects a transaction-id conflict with different %s", async (_, patch) => {
    const database = new MemoryProjectionDatabase();
    await database.apply(consumption());

    await expect(database.apply(consumption(patch))).rejects.toMatchObject({
      code: "contribution_conflict",
    });
    expect(database.state.entries).toHaveLength(1);
    expect(database.state.operations.get(operationKey(consumption()))).toEqual(
      expect.objectContaining({ grossConsumed: 100, netConsumed: 100 })
    );
  });

  it("keeps totalSpent gross while a full refund makes operation net zero", async () => {
    const database = new MemoryProjectionDatabase();
    database.state.totalSpent = 100;

    await database.apply(consumption());
    await database.apply(refund());

    expect(database.state.totalSpent).toBe(100);
    expect(database.state.totalRefunded).toBe(100);
    expect(database.state.operations.get(operationKey(consumption()))).toEqual(
      expect.objectContaining({
        grossConsumed: 100,
        refunded: 100,
        netConsumed: 0,
      })
    );
  });

  it("supports partial followed by full refund without negative net", async () => {
    const database = new MemoryProjectionDatabase();
    await database.apply(consumption());
    await database.apply(refund({ amount: 30 }));
    await database.apply(
      refund({ transactionId: "transaction-refund-2", amount: 70 })
    );

    expect(database.state.operations.get(operationKey(consumption()))).toEqual(
      expect.objectContaining({
        grossConsumed: 100,
        refunded: 100,
        netConsumed: 0,
      })
    );
  });

  it("does not apply the same refund transaction twice", async () => {
    const database = new MemoryProjectionDatabase();
    await database.apply(consumption());
    await expect(database.apply(refund({ amount: 40 }))).resolves.toEqual({
      applied: true,
    });
    await expect(database.apply(refund({ amount: 40 }))).resolves.toEqual({
      applied: false,
    });

    expect(database.state.totalRefunded).toBe(40);
    expect(database.state.operations.get(operationKey(consumption()))).toEqual(
      expect.objectContaining({ refunded: 40, netConsumed: 60 })
    );
  });

  it("rejects a refund that arrives before its consumption", async () => {
    const database = new MemoryProjectionDatabase();

    await expect(database.apply(refund())).rejects.toMatchObject({
      code: "orphan_refund",
    });
    expect(database.state.entries).toHaveLength(0);
    expect(database.state.operations).toHaveLength(0);
    expect(database.state.totalRefunded).toBe(0);
  });

  it.each([
    ["orphan refund", refund(), "orphan_refund"],
    [
      "operation createdAt mismatch",
      refund({
        operation: {
          ...operation,
          operationCreatedAt: new Date("2026-07-19T00:00:00.000Z"),
        },
      }),
      "operation_context_mismatch",
    ],
    [
      "refund exceeds gross",
      refund({ amount: 100.01 }),
      "refund_exceeds_gross",
    ],
  ])("rolls back the contribution for %s", async (name, contribution, code) => {
    const database = new MemoryProjectionDatabase();
    if (name !== "orphan refund") {
      await database.apply(consumption());
    }
    const before = cloneState(database.state);

    await expect(database.apply(contribution)).rejects.toMatchObject({ code });
    expect(database.state).toEqual(before);
  });

  it("rejects a consumption that reuses an operation with another createdAt", async () => {
    const database = new MemoryProjectionDatabase();
    await database.apply(consumption());
    const before = cloneState(database.state);

    await expect(
      database.apply(
        consumption({
          transactionId: "transaction-consume-2",
          operation: {
            ...operation,
            operationCreatedAt: new Date("2026-07-19T00:00:00.000Z"),
          },
        })
      )
    ).rejects.toMatchObject({ code: "operation_context_mismatch" });
    expect(database.state).toEqual(before);
  });

  it("exposes typed financial failures for callers and transaction rollback", async () => {
    const database = new MemoryProjectionDatabase();

    try {
      await database.apply(refund());
      throw new Error("expected projection failure");
    } catch (error) {
      expect(error).toBeInstanceOf(CreditUsageProjectionError);
      expect(error).toMatchObject({ code: "orphan_refund" });
    }
    expect(database.state.entries).toHaveLength(0);
    expect(database.state.totalRefunded).toBe(0);
  });
});
