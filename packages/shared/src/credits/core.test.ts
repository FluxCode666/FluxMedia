/**
 * 积分核心与财务投影的事务边界测试。
 *
 * 通过最小 Drizzle 事务替身证明退款投影失败会让 batch、ledger 和 balance
 * 变更一起回滚，并验证消费幂等快路不会补写投影；测试不连接真实数据库。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({
  select: vi.fn(),
  transaction: vi.fn(),
}));
const projectionMocks = vi.hoisted(() => ({
  apply: vi.fn(),
  createStore: vi.fn(() => ({})),
}));

vi.mock("@repo/database", () => ({
  db: {
    select: databaseMocks.select,
    transaction: databaseMocks.transaction,
  },
}));

vi.mock("./usage-read-model", async (importOriginal) => {
  const original = await importOriginal<typeof import("./usage-read-model")>();
  return {
    ...original,
    applyCreditUsageContribution: projectionMocks.apply,
    createCreditUsageProjectionStore: projectionMocks.createStore,
  };
});

import {
  creditsBalance,
  creditsBatch,
  creditsTransaction,
} from "@repo/database/schema";
import { consumeCredits, grantCredits } from "./core";

type CommittedFinancialState = {
  balanceWrites: number;
  batchWrites: number;
  ledgerWrites: number;
};

let committed: CommittedFinancialState;
let insideTransaction = false;

/** 创建只覆盖 grantCredits 退款路径的最小 Drizzle 事务替身。 */
function createGrantTransaction(draft: CommittedFinancialState) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => [
            {
              id: "balance-1",
              userId: "user-1",
              balance: 100,
              totalEarned: 100,
              totalSpent: 100,
              totalRefunded: 0,
              status: "active",
            },
          ]),
        })),
      })),
    })),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn(() => {
        if (table === creditsBatch) {
          return {
            onConflictDoNothing: vi.fn(() => ({
              returning: vi.fn(async () => {
                draft.batchWrites += 1;
                return [{ id: "batch-refund-1" }];
              }),
            })),
          };
        }
        if (table === creditsTransaction) {
          draft.ledgerWrites += 1;
          return Promise.resolve();
        }
        throw new Error("unexpected insert table in grant transaction test");
      }),
    })),
    update: vi.fn((table: unknown) => {
      if (table !== creditsBalance) {
        throw new Error("unexpected update table in grant transaction test");
      }
      return {
        set: vi.fn(() => ({
          where: vi.fn(async () => {
            draft.balanceWrites += 1;
          }),
        })),
      };
    }),
  };
}

/** 创建只命中 sourceRef 幂等快路的查询事务替身。 */
function createConsumptionFastPathTransaction() {
  return {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => {
            if (table === creditsTransaction) {
              return [
                {
                  id: "transaction-consume-1",
                  amount: 20,
                  metadata: { consumedBatches: [] },
                  operationType: "image_generation",
                  operationId: "generation-1",
                  operationCreatedAt: new Date("2026-07-20T23:00:00.000Z"),
                  createdAt: new Date("2026-07-21T00:00:00.000Z"),
                },
              ];
            }
            if (table === creditsBalance) {
              return [{ balance: 80 }];
            }
            throw new Error(
              "unexpected select table in consume fast-path test"
            );
          }),
        })),
      })),
    })),
  };
}

describe("credits core projection transaction", () => {
  beforeEach(() => {
    committed = { balanceWrites: 0, batchWrites: 0, ledgerWrites: 0 };
    insideTransaction = false;
    databaseMocks.transaction.mockReset();
    databaseMocks.select.mockReset();
    databaseMocks.select.mockReturnValue({
      from: vi.fn(() => ({ where: vi.fn(async () => []) })),
    });
    projectionMocks.apply.mockReset();
    projectionMocks.createStore.mockClear();

    databaseMocks.transaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) => {
        const draft = { ...committed };
        insideTransaction = true;
        try {
          const result = await callback(createGrantTransaction(draft));
          committed = draft;
          return result;
        } finally {
          insideTransaction = false;
        }
      }
    );
  });

  it("rolls back refund ledger and balance writes when projection rejects", async () => {
    projectionMocks.apply.mockImplementation(async () => {
      expect(insideTransaction).toBe(true);
      throw new Error("orphan refund projection");
    });

    await expect(
      grantCredits({
        userId: "user-1",
        amount: 25,
        sourceType: "refund",
        debitAccount: "SYSTEM:generation_refund",
        transactionType: "refund",
        expiresAt: null,
        sourceRef: "generation-1:refund",
        operation: {
          operationType: "image_generation",
          operationId: "generation-1",
          operationCreatedAt: new Date("2026-07-20T23:00:00.000Z"),
        },
      })
    ).rejects.toThrow("orphan refund projection");

    expect(projectionMocks.createStore).toHaveBeenCalledOnce();
    expect(projectionMocks.apply).toHaveBeenCalledOnce();
    expect(committed).toEqual({
      balanceWrites: 0,
      batchWrites: 0,
      ledgerWrites: 0,
    });
  });

  it("does not upsert projection again on the consumption idempotency fast path", async () => {
    databaseMocks.transaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(createConsumptionFastPathTransaction())
    );

    await expect(
      consumeCredits({
        userId: "user-1",
        amount: 20,
        serviceName: "image-generation",
        sourceRef: "generation-1:charge",
        operation: {
          operationType: "image_generation",
          operationId: "generation-1",
          operationCreatedAt: new Date("2026-07-20T23:00:00.000Z"),
        },
      })
    ).resolves.toEqual(
      expect.objectContaining({
        alreadyConsumed: true,
        transactionId: "transaction-consume-1",
      })
    );

    expect(projectionMocks.createStore).not.toHaveBeenCalled();
    expect(projectionMocks.apply).not.toHaveBeenCalled();
  });
});
