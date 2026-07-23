/**
 * API 密钥管理应用服务的 DB-free 单元测试。
 *
 * 职责：验证套餐能力、分组资格、额度归一、密钥散列、所有权条件及生命周期竞态。
 * 使用方：UOL externalApi.*Key bindings 的业务回归门。
 * 关键依赖：Vitest；仓储、套餐、分组与密码学依赖均使用内存替身。
 */
import type { SubscriptionPlan } from "@repo/shared/config/subscription-plan";
import type { PlanCapabilityKey } from "@repo/shared/subscription/services/plan-capabilities";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import {
  createExternalApiKeyManagementService,
  ExternalApiKeyManagementError,
  type ExternalApiKeyRecord,
  type ExternalApiKeyRepository,
} from "./key-management-service";

const now = new Date("2026-07-23T04:00:00.000Z");

const activeKey: ExternalApiKeyRecord = {
  id: "key-1",
  name: "Production",
  keyPrefix: "g2i_abc",
  lastFour: "wxyz",
  generationGroupId: "group-1",
  creditLimit: 100,
  creditsUsed: 12.5,
  lastUsedAt: null,
  isActive: true,
  createdAt: new Date("2026-07-20T04:00:00.000Z"),
  updatedAt: new Date("2026-07-20T04:00:00.000Z"),
};

const disabledCurrentGroup = {
  id: "group-1",
  name: "Legacy Group",
  isEnabled: false,
};

const selectableGroup = {
  id: "group-2",
  name: "Selectable Group",
  isEnabled: true,
};

type RepositoryMocks = {
  [K in keyof ExternalApiKeyRepository]: Mock<ExternalApiKeyRepository[K]>;
};

let repository: RepositoryMocks;
let getUserPlan: Mock<(userId: string) => Promise<SubscriptionPlan>>;
let canUsePlanCapability: Mock<
  (plan: SubscriptionPlan, capability: PlanCapabilityKey) => Promise<boolean>
>;
let listSelectableGroups: Mock<
  (plan: SubscriptionPlan) => Promise<(typeof selectableGroup)[]>
>;
let getGroupById: Mock<
  (groupId: string) => Promise<typeof selectableGroup | null>
>;

/** 构造完全注入依赖的服务，确保测试不会加载数据库连接。 */
function createService() {
  return createExternalApiKeyManagementService({
    repository,
    getUserPlan,
    canUsePlanCapability,
    listSelectableGroups,
    getGroupById,
    createId: () => "key-new",
    createSecret: () => "g2i_plaintext",
    hashSecret: (secret) => `hash:${secret}`,
    now: () => now,
  });
}

/** 断言领域服务以指定稳定错误码失败。 */
async function expectServiceError(
  promise: Promise<unknown>,
  code: ExternalApiKeyManagementError["code"]
): Promise<void> {
  try {
    await promise;
    throw new Error("Expected service to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(ExternalApiKeyManagementError);
    expect((error as ExternalApiKeyManagementError).code).toBe(code);
  }
}

beforeEach(() => {
  repository = {
    listByUser: vi
      .fn()
      .mockResolvedValue([
        { key: activeKey, currentGroup: disabledCurrentGroup },
      ]),
    insert: vi.fn().mockResolvedValue({
      ...activeKey,
      id: "key-new",
      generationGroupId: "group-2",
      creditLimit: 12.35,
      creditsUsed: 0,
      createdAt: now,
      updatedAt: now,
    }),
    revokeActive: vi.fn().mockResolvedValue({
      ...activeKey,
      isActive: false,
      updatedAt: now,
    }),
    deleteRevoked: vi.fn().mockResolvedValue({ id: "key-1" }),
    updateActiveGroup: vi.fn().mockResolvedValue({
      ...activeKey,
      generationGroupId: "group-2",
      updatedAt: now,
    }),
    updateActiveQuota: vi.fn().mockResolvedValue({
      ...activeKey,
      creditLimit: 25.68,
      updatedAt: now,
    }),
    findState: vi.fn().mockResolvedValue({ isActive: true }),
  };
  getUserPlan = vi.fn().mockResolvedValue("pro");
  canUsePlanCapability = vi
    .fn()
    .mockImplementation(
      async (_plan: SubscriptionPlan, capability: PlanCapabilityKey) =>
        capability === "externalApi.keys.manage" ||
        capability === "backendGroups.select"
    );
  listSelectableGroups = vi.fn().mockResolvedValue([selectableGroup]);
  getGroupById = vi
    .fn()
    .mockImplementation(async (groupId: string) =>
      groupId === disabledCurrentGroup.id
        ? disabledCurrentGroup
        : groupId === selectableGroup.id
          ? selectableGroup
          : null
    );
});

describe("list API keys", () => {
  it("keeps a disabled current group visible and returns separate editable candidates", async () => {
    const result = await createService().listKeys("user-1");

    expect(result).toEqual({
      keys: [
        {
          id: "key-1",
          name: "Production",
          keyPrefix: "g2i_abc",
          lastFour: "wxyz",
          generationGroupId: "group-1",
          creditLimit: 100,
          creditsUsed: 12.5,
          lastUsedAt: null,
          isActive: true,
          createdAt: activeKey.createdAt,
          updatedAt: activeKey.updatedAt,
          currentGroup: {
            id: "group-1",
            name: "Legacy Group",
            enabled: false,
            selectable: false,
          },
        },
      ],
      editableGroups: [
        {
          id: "group-2",
          name: "Selectable Group",
          enabled: true,
          selectable: true,
        },
      ],
    });
  });

  it("returns no editable candidates when the plan cannot select groups", async () => {
    canUsePlanCapability.mockImplementation(
      async (_plan: SubscriptionPlan, capability: PlanCapabilityKey) =>
        capability === "externalApi.keys.manage"
    );

    const result = await createService().listKeys("user-1");

    expect(result.editableGroups).toEqual([]);
    expect(result.keys[0]?.currentGroup?.selectable).toBe(false);
    expect(listSelectableGroups).not.toHaveBeenCalled();
  });
});

describe("create API key", () => {
  it("validates the group, normalizes quota and stores only the hash", async () => {
    const result = await createService().createKey("user-1", {
      name: "Production",
      generationGroupId: "group-2",
      creditLimit: 12.345,
    });

    expect(repository.insert).toHaveBeenCalledWith({
      id: "key-new",
      userId: "user-1",
      name: "Production",
      keyPrefix: "g2i_pla",
      keyHash: "hash:g2i_plaintext",
      lastFour: "text",
      generationGroupId: "group-2",
      creditLimit: 12.35,
      createdAt: now,
      updatedAt: now,
    });
    expect(result.apiKey).toBe("g2i_plaintext");
    expect(result.key.currentGroup).toEqual({
      id: "group-2",
      name: "Selectable Group",
      enabled: true,
      selectable: true,
    });
    expect(result.key).not.toHaveProperty("keyHash");
  });

  it("rejects creation without the API key management capability", async () => {
    canUsePlanCapability.mockResolvedValue(false);

    await expectServiceError(
      createService().createKey("user-1", {
        name: "Production",
        generationGroupId: null,
        creditLimit: null,
      }),
      "capability_required"
    );
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it("rejects a group outside the current editable candidates", async () => {
    await expectServiceError(
      createService().createKey("user-1", {
        name: "Production",
        generationGroupId: "group-missing",
        creditLimit: null,
      }),
      "validation_error"
    );
    expect(repository.insert).not.toHaveBeenCalled();
  });
});

describe("API key lifecycle mutations", () => {
  it("uses one conditional revoke and returns the actual updated row", async () => {
    const result = await createService().revokeKey("user-1", "key-1");

    expect(repository.revokeActive).toHaveBeenCalledWith(
      "user-1",
      "key-1",
      now
    );
    expect(result.isActive).toBe(false);
    expect(repository.findState).not.toHaveBeenCalled();
  });

  it("distinguishes a missing key from an already-revoked key", async () => {
    repository.revokeActive.mockResolvedValue(null);
    repository.findState.mockResolvedValueOnce(null);
    await expectServiceError(
      createService().revokeKey("user-1", "foreign-key"),
      "not_found"
    );

    repository.findState.mockResolvedValueOnce({ isActive: false });
    await expectServiceError(
      createService().revokeKey("user-1", "key-1"),
      "state_conflict"
    );
  });

  it("deletes only a revoked owned key and reports active-state conflicts", async () => {
    expect(await createService().deleteKey("user-1", "key-1")).toEqual({
      id: "key-1",
    });

    repository.deleteRevoked.mockResolvedValue(null);
    repository.findState.mockResolvedValue({ isActive: true });
    await expectServiceError(
      createService().deleteKey("user-1", "key-1"),
      "state_conflict"
    );
  });

  it("updates group and quota only through active-row conditions", async () => {
    const service = createService();
    const groupResult = await service.updateKeyGroup(
      "user-1",
      "key-1",
      "group-2"
    );
    const quotaResult = await service.updateKeyQuota("user-1", "key-1", 25.678);

    expect(repository.updateActiveGroup).toHaveBeenCalledWith(
      "user-1",
      "key-1",
      "group-2",
      now
    );
    expect(repository.updateActiveQuota).toHaveBeenCalledWith(
      "user-1",
      "key-1",
      25.68,
      now
    );
    expect(groupResult.generationGroupId).toBe("group-2");
    expect(quotaResult.creditLimit).toBe(25.68);
  });

  it("reports inactive edit races as state conflicts", async () => {
    repository.updateActiveGroup.mockResolvedValue(null);
    repository.findState.mockResolvedValue({ isActive: false });

    await expectServiceError(
      createService().updateKeyGroup("user-1", "key-1", "group-2"),
      "state_conflict"
    );
  });
});
