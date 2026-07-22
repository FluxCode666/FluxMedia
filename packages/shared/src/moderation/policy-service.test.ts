/**
 * 内容审核策略服务的 DB-free 单元测试。
 *
 * 职责：通过可回滚的内存事务端口验证读取、权限、同值短路、原子审计与
 * 缓存失效降级，不导入真实数据库或系统设置缓存。
 * 使用方：审核策略 UOL 与生成管线接线前的领域服务回归门。
 * 关键依赖：Vitest、policy-service.ts、policy-contract.ts。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppUserRole } from "../auth/roles";
import {
  type AdminAuditLogInsert,
  CONTENT_MODERATION_BLOCK_RISK_LEVEL_SETTING_KEY,
  createModerationPolicyService,
  type LockedGlobalPolicy,
  type ModerationPolicyRepository,
  type ModerationPolicyServiceError,
  type ModerationPolicyTransaction,
} from "./policy-service";

interface MemoryUser {
  id: string;
  role: AppUserRole;
  userOverride: unknown;
  updatedAt: Date;
}

interface MemoryState {
  global: LockedGlobalPolicy | null;
  users: Map<string, MemoryUser>;
  audits: AdminAuditLogInsert[];
}

interface MemoryRepositoryControl {
  repository: ModerationPolicyRepository;
  getState: () => MemoryState;
  transactionEvents: string[];
  failReadsWith: (error: Error | null) => void;
  failAuditWith: (error: Error | null) => void;
}

const FIXED_NOW = new Date("2026-07-23T08:00:00.000Z");
const INITIAL_TIME = new Date("2026-07-22T08:00:00.000Z");

/** 克隆内存状态，模拟数据库事务的隔离写集。 */
function cloneState(state: MemoryState): MemoryState {
  return {
    global: state.global
      ? { value: state.global.value, updatedAt: state.global.updatedAt }
      : null,
    users: new Map(
      [...state.users].map(([id, item]) => [
        id,
        { ...item, updatedAt: item.updatedAt },
      ])
    ),
    audits: state.audits.map((item) => ({
      ...item,
      before: { ...item.before },
      after: { ...item.after },
      metadata: { ...item.metadata },
    })),
  };
}

/** 创建带提交/回滚语义的可注入仓储。 */
function createMemoryRepository(initial: MemoryState): MemoryRepositoryControl {
  let committed = cloneState(initial);
  let readError: Error | null = null;
  let auditError: Error | null = null;
  const transactionEvents: string[] = [];

  const repository: ModerationPolicyRepository = {
    async readGlobalPolicy() {
      if (readError) throw readError;
      return committed.global
        ? {
            value: committed.global.value,
            updatedAt: committed.global.updatedAt,
          }
        : null;
    },
    async readUserPolicy(userId) {
      if (readError) throw readError;
      const target = committed.users.get(userId);
      return {
        globalDefault: committed.global?.value,
        user: target
          ? {
              id: target.id,
              role: target.role,
              userOverride: target.userOverride,
            }
          : null,
      };
    },
    async transaction<T>(
      work: (tx: ModerationPolicyTransaction) => Promise<T>
    ) {
      const working = cloneState(committed);
      const tx: ModerationPolicyTransaction = {
        async lockGlobalPolicy() {
          transactionEvents.push("lock-global");
          return working.global
            ? {
                value: working.global.value,
                updatedAt: working.global.updatedAt,
              }
            : null;
        },
        async updateGlobalPolicy(input) {
          transactionEvents.push("update-global");
          if (!working.global) throw new Error("missing global policy");
          working.global = {
            value: input.level,
            updatedAt: input.updatedAt,
          };
        },
        async lockUserPolicy(userId) {
          transactionEvents.push("lock-user");
          const target = working.users.get(userId);
          return target
            ? {
                id: target.id,
                role: target.role,
                userOverride: target.userOverride,
                updatedAt: target.updatedAt,
              }
            : null;
        },
        async updateUserOverride(input) {
          transactionEvents.push("update-user");
          const target = working.users.get(input.userId);
          if (!target) throw new Error("missing user");
          working.users.set(input.userId, {
            ...target,
            userOverride: input.level,
            updatedAt: input.updatedAt,
          });
        },
        async readGlobalPolicy() {
          transactionEvents.push("read-global");
          return working.global
            ? {
                value: working.global.value,
                updatedAt: working.global.updatedAt,
              }
            : null;
        },
        async insertAuditLog(input) {
          transactionEvents.push("insert-audit");
          if (auditError) throw auditError;
          working.audits.push(input);
        },
      };

      const result = await work(tx);
      committed = working;
      transactionEvents.push("commit");
      return result;
    },
  };

  return {
    repository,
    getState: () => cloneState(committed),
    transactionEvents,
    failReadsWith(error) {
      readError = error;
    },
    failAuditWith(error) {
      auditError = error;
    },
  };
}

/** 创建覆盖常用角色与覆盖值的默认内存状态。 */
function createInitialState(): MemoryState {
  return {
    global: { value: "low", updatedAt: INITIAL_TIME },
    users: new Map([
      [
        "user-1",
        {
          id: "user-1",
          role: "user",
          userOverride: null,
          updatedAt: INITIAL_TIME,
        },
      ],
      [
        "observer-1",
        {
          id: "observer-1",
          role: "observer_admin",
          userOverride: "medium",
          updatedAt: INITIAL_TIME,
        },
      ],
      [
        "admin-1",
        {
          id: "admin-1",
          role: "admin",
          userOverride: "high",
          updatedAt: INITIAL_TIME,
        },
      ],
      [
        "super-1",
        {
          id: "super-1",
          role: "super_admin",
          userOverride: null,
          updatedAt: INITIAL_TIME,
        },
      ],
    ]),
    audits: [],
  };
}

describe("moderation policy service", () => {
  const invalidateSystemSettingsCache = vi.fn<() => Promise<void>>();
  const warn =
    vi.fn<(message: string, data: Record<string, unknown>) => void>();

  beforeEach(() => {
    invalidateSystemSettingsCache.mockReset().mockResolvedValue(undefined);
    warn.mockReset();
  });

  it("uses the fixed global setting key", () => {
    expect(CONTENT_MODERATION_BLOCK_RISK_LEVEL_SETTING_KEY).toBe(
      "CONTENT_MODERATION_BLOCK_RISK_LEVEL"
    );
  });

  it("resolves a valid user override directly from repository values", async () => {
    const control = createMemoryRepository(createInitialState());
    const service = createModerationPolicyService({
      repository: control.repository,
      invalidateSystemSettingsCache,
      warn,
      now: () => FIXED_NOW,
      createAuditId: () => "audit-1",
    });

    await expect(service.resolveEffectivePolicy("observer-1")).resolves.toEqual(
      {
        globalDefault: "low",
        userOverride: "medium",
        effectiveLevel: "medium",
        source: "user_override",
      }
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("returns high and emits a structured warning for fallback_high", async () => {
    const state = createInitialState();
    state.global = { value: "invalid", updatedAt: INITIAL_TIME };
    const control = createMemoryRepository(state);
    const service = createModerationPolicyService({
      repository: control.repository,
      invalidateSystemSettingsCache,
      warn,
      now: () => FIXED_NOW,
      createAuditId: () => "audit-1",
    });

    await expect(service.resolveEffectivePolicy("user-1")).resolves.toEqual({
      globalDefault: "high",
      userOverride: null,
      effectiveLevel: "high",
      source: "fallback_high",
    });
    expect(warn).toHaveBeenCalledWith(
      "内容审核策略回退到 high",
      expect.objectContaining({
        event: "moderation_policy_fallback_high",
        settingKey: CONTENT_MODERATION_BLOCK_RISK_LEVEL_SETTING_KEY,
        userId: "user-1",
      })
    );
  });

  it("propagates repository read failures without disguising them as high", async () => {
    const control = createMemoryRepository(createInitialState());
    const databaseError = new Error("database unavailable");
    control.failReadsWith(databaseError);
    const service = createModerationPolicyService({
      repository: control.repository,
      invalidateSystemSettingsCache,
      warn,
      now: () => FIXED_NOW,
      createAuditId: () => "audit-1",
    });

    await expect(service.resolveEffectivePolicy("user-1")).rejects.toBe(
      databaseError
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("allows only super_admin to change the global policy", async () => {
    const control = createMemoryRepository(createInitialState());
    const service = createModerationPolicyService({
      repository: control.repository,
      invalidateSystemSettingsCache,
      warn,
      now: () => FIXED_NOW,
      createAuditId: () => "audit-1",
    });

    await expect(
      service.setGlobalRiskLevel({
        actor: { userId: "admin-1", role: "admin" },
        level: "medium",
        reason: "不应生效",
        requestId: "request-1",
      })
    ).rejects.toMatchObject({
      code: "forbidden",
    } satisfies Partial<ModerationPolicyServiceError>);
    expect(control.transactionEvents).toEqual([]);
  });

  it("trims the global reason and writes policy plus audit in one transaction", async () => {
    const control = createMemoryRepository(createInitialState());
    const service = createModerationPolicyService({
      repository: control.repository,
      invalidateSystemSettingsCache,
      warn,
      now: () => FIXED_NOW,
      createAuditId: () => "audit-global",
    });

    await expect(
      service.setGlobalRiskLevel({
        actor: { userId: "super-1", role: "super_admin" },
        level: "medium",
        reason: "  调整全站阈值  ",
        requestId: "request-global",
      })
    ).resolves.toEqual({
      changed: true,
      before: "low",
      after: "medium",
      auditLogId: "audit-global",
      updatedAt: FIXED_NOW,
    });
    expect(control.transactionEvents).toEqual([
      "lock-global",
      "update-global",
      "insert-audit",
      "commit",
    ]);
    expect(control.getState().audits).toEqual([
      expect.objectContaining({
        id: "audit-global",
        adminUserId: "super-1",
        targetUserId: null,
        action: "moderation.setGlobalRiskLevel",
        reason: "调整全站阈值",
        before: { level: "low" },
        after: { level: "medium" },
        metadata: {
          requestId: "request-global",
          operation: "moderation.setGlobalRiskLevel",
          actorUserId: "super-1",
          actorRole: "super_admin",
          targetUserId: null,
          targetRole: null,
        },
        createdAt: FIXED_NOW,
      }),
    ]);
    expect(invalidateSystemSettingsCache).toHaveBeenCalledOnce();
  });

  it("returns changed false without update, audit, or cache invalidation", async () => {
    const control = createMemoryRepository(createInitialState());
    const service = createModerationPolicyService({
      repository: control.repository,
      invalidateSystemSettingsCache,
      warn,
      now: () => FIXED_NOW,
      createAuditId: () => "unused",
    });

    await expect(
      service.setGlobalRiskLevel({
        actor: { userId: "super-1", role: "super_admin" },
        level: "low",
        reason: "确认不变",
        requestId: "request-same",
      })
    ).resolves.toEqual({
      changed: false,
      before: "low",
      after: "low",
      auditLogId: null,
      updatedAt: INITIAL_TIME,
    });
    expect(control.transactionEvents).toEqual(["lock-global", "commit"]);
    expect(control.getState().audits).toEqual([]);
    expect(invalidateSystemSettingsCache).not.toHaveBeenCalled();
  });

  it("rolls back the global write when audit insertion fails", async () => {
    const control = createMemoryRepository(createInitialState());
    const auditError = new Error("audit unavailable");
    control.failAuditWith(auditError);
    const service = createModerationPolicyService({
      repository: control.repository,
      invalidateSystemSettingsCache,
      warn,
      now: () => FIXED_NOW,
      createAuditId: () => "audit-global",
    });

    await expect(
      service.setGlobalRiskLevel({
        actor: { userId: "super-1", role: "super_admin" },
        level: "high",
        reason: "提升阈值",
        requestId: "request-fail",
      })
    ).rejects.toBe(auditError);
    expect(control.getState().global?.value).toBe("low");
    expect(control.getState().audits).toEqual([]);
    expect(invalidateSystemSettingsCache).not.toHaveBeenCalled();
  });

  it("blocks observer and admin from writing forbidden user targets", async () => {
    const control = createMemoryRepository(createInitialState());
    const service = createModerationPolicyService({
      repository: control.repository,
      invalidateSystemSettingsCache,
      warn,
      now: () => FIXED_NOW,
      createAuditId: () => "audit-user",
    });

    await expect(
      service.setUserRiskLevelOverride({
        actor: { userId: "observer-1", role: "observer_admin" },
        userId: "user-1",
        level: "medium",
        reason: "越权",
        requestId: "request-observer",
      })
    ).rejects.toMatchObject({
      code: "forbidden",
    } satisfies Partial<ModerationPolicyServiceError>);
    await expect(
      service.setUserRiskLevelOverride({
        actor: { userId: "admin-1", role: "admin" },
        userId: "admin-1",
        level: null,
        reason: "不能修改自己",
        requestId: "request-self",
      })
    ).rejects.toMatchObject({
      code: "forbidden",
    } satisfies Partial<ModerationPolicyServiceError>);
    await expect(
      service.setUserRiskLevelOverride({
        actor: { userId: "admin-1", role: "admin" },
        userId: "super-1",
        level: "low",
        reason: "不能越级",
        requestId: "request-higher",
      })
    ).rejects.toMatchObject({
      code: "forbidden",
    } satisfies Partial<ModerationPolicyServiceError>);
  });

  it("writes a lower-role user override with complete audit metadata", async () => {
    const control = createMemoryRepository(createInitialState());
    const service = createModerationPolicyService({
      repository: control.repository,
      invalidateSystemSettingsCache,
      warn,
      now: () => FIXED_NOW,
      createAuditId: () => "audit-user",
    });

    await expect(
      service.setUserRiskLevelOverride({
        actor: { userId: "admin-1", role: "admin" },
        userId: "observer-1",
        level: null,
        reason: "  恢复继承全站  ",
        requestId: "request-user",
      })
    ).resolves.toEqual({
      changed: true,
      before: "medium",
      after: null,
      effectiveLevel: "low",
      source: "global",
      auditLogId: "audit-user",
      updatedAt: FIXED_NOW,
    });
    expect(control.transactionEvents).toEqual([
      "lock-user",
      "read-global",
      "update-user",
      "insert-audit",
      "commit",
    ]);
    expect(control.getState().audits).toEqual([
      expect.objectContaining({
        adminUserId: "admin-1",
        targetUserId: "observer-1",
        action: "moderation.setUserRiskLevelOverride",
        reason: "恢复继承全站",
        before: { level: "medium" },
        after: { level: null },
        metadata: {
          requestId: "request-user",
          operation: "moderation.setUserRiskLevelOverride",
          actorUserId: "admin-1",
          actorRole: "admin",
          targetUserId: "observer-1",
          targetRole: "observer_admin",
        },
      }),
    ]);
    expect(invalidateSystemSettingsCache).toHaveBeenCalledOnce();
  });

  it("returns unchanged user policy without audit or cache invalidation", async () => {
    const control = createMemoryRepository(createInitialState());
    const service = createModerationPolicyService({
      repository: control.repository,
      invalidateSystemSettingsCache,
      warn,
      now: () => FIXED_NOW,
      createAuditId: () => "unused",
    });

    await expect(
      service.setUserRiskLevelOverride({
        actor: { userId: "super-1", role: "super_admin" },
        userId: "observer-1",
        level: "medium",
        reason: "确认保持覆盖",
        requestId: "request-user-same",
      })
    ).resolves.toEqual({
      changed: false,
      before: "medium",
      after: "medium",
      effectiveLevel: "medium",
      source: "user_override",
      auditLogId: null,
      updatedAt: INITIAL_TIME,
    });
    expect(control.transactionEvents).toEqual([
      "lock-user",
      "read-global",
      "commit",
    ]);
    expect(control.getState().audits).toEqual([]);
    expect(invalidateSystemSettingsCache).not.toHaveBeenCalled();
  });

  it("rolls back a user override when its audit insertion fails", async () => {
    const control = createMemoryRepository(createInitialState());
    const auditError = new Error("audit unavailable");
    control.failAuditWith(auditError);
    const service = createModerationPolicyService({
      repository: control.repository,
      invalidateSystemSettingsCache,
      warn,
      now: () => FIXED_NOW,
      createAuditId: () => "audit-user",
    });

    await expect(
      service.setUserRiskLevelOverride({
        actor: { userId: "admin-1", role: "admin" },
        userId: "user-1",
        level: "high",
        reason: "单用户覆盖",
        requestId: "request-user-fail",
      })
    ).rejects.toBe(auditError);
    expect(control.getState().users.get("user-1")?.userOverride).toBeNull();
    expect(control.getState().audits).toEqual([]);
    expect(invalidateSystemSettingsCache).not.toHaveBeenCalled();
  });

  it("requires a trimmed reason between one and 300 characters", async () => {
    const control = createMemoryRepository(createInitialState());
    const service = createModerationPolicyService({
      repository: control.repository,
      invalidateSystemSettingsCache,
      warn,
      now: () => FIXED_NOW,
      createAuditId: () => "audit-1",
    });

    await expect(
      service.setGlobalRiskLevel({
        actor: { userId: "super-1", role: "super_admin" },
        level: "medium",
        reason: "   ",
        requestId: "request-empty",
      })
    ).rejects.toMatchObject({
      code: "validation_error",
    } satisfies Partial<ModerationPolicyServiceError>);
    await expect(
      service.setGlobalRiskLevel({
        actor: { userId: "super-1", role: "super_admin" },
        level: "medium",
        reason: "x".repeat(301),
        requestId: "request-long",
      })
    ).rejects.toMatchObject({
      code: "validation_error",
    } satisfies Partial<ModerationPolicyServiceError>);
    expect(control.transactionEvents).toEqual([]);
  });

  it("keeps a committed write when cache invalidation fails", async () => {
    const control = createMemoryRepository(createInitialState());
    invalidateSystemSettingsCache.mockRejectedValueOnce(
      new Error("redis unavailable")
    );
    const service = createModerationPolicyService({
      repository: control.repository,
      invalidateSystemSettingsCache,
      warn,
      now: () => FIXED_NOW,
      createAuditId: () => "audit-user",
    });

    await expect(
      service.setUserRiskLevelOverride({
        actor: { userId: "super-1", role: "super_admin" },
        userId: "user-1",
        level: "high",
        reason: "单用户例外",
        requestId: "request-cache",
      })
    ).resolves.toMatchObject({ changed: true, after: "high" });
    expect(control.getState().users.get("user-1")?.userOverride).toBe("high");
    expect(control.getState().audits).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(
      "审核策略已提交，但系统设置缓存失效失败",
      expect.objectContaining({
        event: "moderation_policy_cache_invalidation_failed",
        operation: "moderation.setUserRiskLevelOverride",
        errorName: "Error",
      })
    );
  });
});
