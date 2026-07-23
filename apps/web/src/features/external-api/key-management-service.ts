/**
 * API 密钥管理应用服务。
 *
 * 职责：集中处理密钥生成/散列、套餐能力、分组资格、额度归一、所有权条件和生命周期
 * 竞态；UOL binding 只注入可信 userId。默认依赖延迟加载数据库，纯工厂可 DB-free 单测。
 * 使用方：apps/web/src/server/uol-bindings.ts 与 API 密钥管理 Server Actions。
 * 关键依赖：Drizzle 仓储、套餐能力、后端分组选项、quota-math。
 */
import { createHash, randomBytes } from "node:crypto";

import type { externalApiKey as externalApiKeyTable } from "@repo/database/schema";
import type { SubscriptionPlan } from "@repo/shared/config/subscription-plan";
import type { PlanCapabilityKey } from "@repo/shared/subscription/services/plan-capabilities";
import { nanoid } from "nanoid";

import { normalizeExternalApiKeyCreditLimit } from "./quota-math";

const API_KEY_PREFIX = "g2i";
const DEFAULT_KEY_NAME = "默认 API 密钥";

export type ExternalApiKeyManagementErrorCode =
  | "capability_required"
  | "not_found"
  | "state_conflict"
  | "validation_error";

/** API 密钥管理中可安全映射到 UOL 的预期领域错误。 */
export class ExternalApiKeyManagementError extends Error {
  readonly code: ExternalApiKeyManagementErrorCode;

  /** 创建带稳定错误码的 API 密钥领域错误。 */
  constructor(code: ExternalApiKeyManagementErrorCode, message: string) {
    super(message);
    this.name = "ExternalApiKeyManagementError";
    this.code = code;
  }
}

/** 仓储返回的可信 API 密钥行；不包含明文和哈希。 */
export type ExternalApiKeyRecord = {
  id: string;
  userId: string;
  name: string;
  keyPrefix: string;
  lastFour: string;
  generationGroupId: string | null;
  creditLimit: number | null;
  creditsUsed: number;
  lastUsedAt: Date | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/** 服务内部使用的后端分组最小视图。 */
export type ExternalApiKeyGroupRecord = {
  id: string;
  name: string;
  isEnabled: boolean;
  isUserSelectable: boolean;
};

/** 对外列表和 mutation 统一返回的安全摘要。 */
export type ExternalApiKeySummary = Omit<ExternalApiKeyRecord, "userId"> & {
  currentGroup: {
    id: string;
    name: string;
    enabled: boolean;
    selectable: boolean;
  } | null;
};

/** 创建仓储行时唯一允许写入的字段。 */
export type ExternalApiKeyInsert = {
  id: string;
  userId: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
  lastFour: string;
  generationGroupId: string | null;
  creditLimit: number | null;
  createdAt: Date;
  updatedAt: Date;
};

/** 数据库仓储边界；所有生命周期写入都必须带 userId 和状态条件。 */
export interface ExternalApiKeyRepository {
  listByUser(userId: string): Promise<
    Array<{
      key: ExternalApiKeyRecord;
      currentGroup: ExternalApiKeyGroupRecord | null;
    }>
  >;
  insert(values: ExternalApiKeyInsert): Promise<ExternalApiKeyRecord | null>;
  revokeActive(
    userId: string,
    keyId: string,
    updatedAt: Date
  ): Promise<ExternalApiKeyRecord | null>;
  deleteRevoked(userId: string, keyId: string): Promise<{ id: string } | null>;
  updateActiveGroup(
    userId: string,
    keyId: string,
    generationGroupId: string | null,
    updatedAt: Date
  ): Promise<ExternalApiKeyRecord | null>;
  updateActiveQuota(
    userId: string,
    keyId: string,
    creditLimit: number | null,
    updatedAt: Date
  ): Promise<ExternalApiKeyRecord | null>;
  findState(
    userId: string,
    keyId: string
  ): Promise<{ isActive: boolean } | null>;
}

type ServiceDependencies = {
  repository: ExternalApiKeyRepository;
  getUserPlan(userId: string): Promise<SubscriptionPlan>;
  canUsePlanCapability(
    plan: SubscriptionPlan,
    capability: PlanCapabilityKey
  ): Promise<boolean>;
  listSelectableGroups(
    plan: SubscriptionPlan
  ): Promise<ExternalApiKeyGroupRecord[]>;
  getGroupById(groupId: string): Promise<ExternalApiKeyGroupRecord | null>;
  createId(): string;
  createSecret(): string;
  hashSecret(secret: string): string;
  now(): Date;
};

export type CreateExternalApiKeyInput = {
  name?: string;
  generationGroupId?: string | null;
  creditLimit?: number | null;
};

/** 将仓储行裁剪成绝不包含 userId、哈希或明文的公开摘要。 */
function toKeySummary(
  key: ExternalApiKeyRecord,
  currentGroup: ExternalApiKeyGroupRecord | null,
  selectableGroupIds: ReadonlySet<string>
): ExternalApiKeySummary {
  return {
    id: key.id,
    name: key.name,
    keyPrefix: key.keyPrefix,
    lastFour: key.lastFour,
    generationGroupId: key.generationGroupId,
    creditLimit: key.creditLimit,
    creditsUsed: key.creditsUsed,
    lastUsedAt: key.lastUsedAt,
    isActive: key.isActive,
    createdAt: key.createdAt,
    updatedAt: key.updatedAt,
    currentGroup: currentGroup
      ? {
          id: currentGroup.id,
          name: currentGroup.name,
          enabled: currentGroup.isEnabled,
          selectable: selectableGroupIds.has(currentGroup.id),
        }
      : null,
  };
}

/** 生成外部 API 密钥的 SHA-256 摘要，数据库永不保存明文。 */
function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

/** 生成带固定前缀的高熵 API 密钥；明文只从 create 调用返回一次。 */
function createApiKey(): string {
  return `${API_KEY_PREFIX}_${randomBytes(32).toString("base64url")}`;
}

/**
 * 创建可注入依赖的 API 密钥应用服务。
 *
 * 所有 mutation 先执行单条带所有权/状态条件的写入；0 行后才读取当前状态区分
 * not_found 与 state_conflict，避免先查后写导致假成功。
 */
export function createExternalApiKeyManagementService(
  dependencies: ServiceDependencies
) {
  /** 读取当前套餐，并在写操作前检查 API 密钥管理能力。 */
  async function requireManagementPlan(
    userId: string
  ): Promise<SubscriptionPlan> {
    const plan = await dependencies.getUserPlan(userId);
    if (
      !(await dependencies.canUsePlanCapability(
        plan,
        "externalApi.keys.manage"
      ))
    ) {
      throw new ExternalApiKeyManagementError(
        "capability_required",
        "当前套餐不支持管理 API 密钥"
      );
    }
    return plan;
  }

  /** 读取当前套餐下真实可编辑的分组；无分组选择能力时返回空集。 */
  async function loadEditableGroups(
    plan: SubscriptionPlan
  ): Promise<ExternalApiKeyGroupRecord[]> {
    if (
      !(await dependencies.canUsePlanCapability(plan, "backendGroups.select"))
    ) {
      return [];
    }
    return dependencies.listSelectableGroups(plan);
  }

  /** 将分组输入归一为 null 或当前套餐确实可选的分组 ID。 */
  async function normalizeGroupId(
    plan: SubscriptionPlan,
    groupId: string | null | undefined
  ): Promise<{
    groupId: string | null;
    editableGroups: ExternalApiKeyGroupRecord[];
  }> {
    const editableGroups = await loadEditableGroups(plan);
    if (!groupId || groupId === "default") {
      return { groupId: null, editableGroups };
    }
    if (!editableGroups.some((group) => group.id === groupId)) {
      throw new ExternalApiKeyManagementError(
        "validation_error",
        "所选生图分组当前不可用"
      );
    }
    return { groupId, editableGroups };
  }

  /** mutation 成功后用当前分组和当前套餐资格装饰数据库实际返回行。 */
  async function decorateMutationRow(
    userId: string,
    key: ExternalApiKeyRecord,
    editableGroups?: ExternalApiKeyGroupRecord[]
  ): Promise<ExternalApiKeySummary> {
    const groups =
      editableGroups ??
      (await loadEditableGroups(await dependencies.getUserPlan(userId)));
    const currentGroup = key.generationGroupId
      ? await dependencies.getGroupById(key.generationGroupId)
      : null;
    return toKeySummary(
      key,
      currentGroup,
      new Set(groups.map((group) => group.id))
    );
  }

  /** 0 行写入后读取同一用户范围内的状态，并抛出准确生命周期错误。 */
  async function throwMutationMiss(
    userId: string,
    keyId: string,
    conflictMessage: string
  ): Promise<never> {
    const state = await dependencies.repository.findState(userId, keyId);
    if (!state) {
      throw new ExternalApiKeyManagementError("not_found", "API 密钥不存在");
    }
    throw new ExternalApiKeyManagementError("state_conflict", conflictMessage);
  }

  return {
    /** 列出本人全部 Key，并把当前分组与可编辑候选分开返回。 */
    async listKeys(userId: string) {
      const plan = await dependencies.getUserPlan(userId);
      const [rows, editableGroups] = await Promise.all([
        dependencies.repository.listByUser(userId),
        loadEditableGroups(plan),
      ]);
      const selectableGroupIds = new Set(
        editableGroups.map((group) => group.id)
      );
      return {
        keys: rows.map(({ key, currentGroup }) =>
          toKeySummary(key, currentGroup, selectableGroupIds)
        ),
        editableGroups: editableGroups.map((group) => ({
          id: group.id,
          name: group.name,
          enabled: group.isEnabled,
          selectable: true,
        })),
      };
    },

    /** 创建 Key；只将哈希写入仓储，明文仅随本次返回值离开服务。 */
    async createKey(userId: string, input: CreateExternalApiKeyInput) {
      const plan = await requireManagementPlan(userId);
      const { groupId, editableGroups } = await normalizeGroupId(
        plan,
        input.generationGroupId
      );
      const apiKey = dependencies.createSecret();
      const timestamp = dependencies.now();
      const key = await dependencies.repository.insert({
        id: dependencies.createId(),
        userId,
        name: input.name?.trim() || DEFAULT_KEY_NAME,
        keyPrefix: apiKey.slice(0, 7),
        keyHash: dependencies.hashSecret(apiKey),
        lastFour: apiKey.slice(-4),
        generationGroupId: groupId,
        creditLimit: normalizeExternalApiKeyCreditLimit(input.creditLimit),
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      if (!key) {
        throw new Error("API key insert did not return a row");
      }
      return {
        apiKey,
        key: await decorateMutationRow(userId, key, editableGroups),
      };
    },

    /** 原子撤销本人启用 Key；重复撤销返回状态冲突。 */
    async revokeKey(
      userId: string,
      keyId: string
    ): Promise<ExternalApiKeySummary> {
      const updated = await dependencies.repository.revokeActive(
        userId,
        keyId,
        dependencies.now()
      );
      if (!updated) {
        return throwMutationMiss(userId, keyId, "API 密钥已被撤销");
      }
      return decorateMutationRow(userId, updated);
    },

    /** 仅删除本人已撤销 Key；启用态或竞态变化返回状态冲突。 */
    async deleteKey(userId: string, keyId: string) {
      const deleted = await dependencies.repository.deleteRevoked(
        userId,
        keyId
      );
      if (!deleted) {
        return throwMutationMiss(userId, keyId, "请先撤销 API 密钥再删除");
      }
      return deleted;
    },

    /** 仅更新本人启用 Key 的分组，并拒绝当前套餐不可选的候选。 */
    async updateKeyGroup(
      userId: string,
      keyId: string,
      generationGroupId: string | null
    ): Promise<ExternalApiKeySummary> {
      const plan = await requireManagementPlan(userId);
      const { groupId, editableGroups } = await normalizeGroupId(
        plan,
        generationGroupId
      );
      const updated = await dependencies.repository.updateActiveGroup(
        userId,
        keyId,
        groupId,
        dependencies.now()
      );
      if (!updated) {
        return throwMutationMiss(
          userId,
          keyId,
          "已撤销的 API 密钥不能修改分组"
        );
      }
      return decorateMutationRow(userId, updated, editableGroups);
    },

    /** 仅更新本人启用 Key 的额度，并沿用两位小数归一规则。 */
    async updateKeyQuota(
      userId: string,
      keyId: string,
      creditLimit: number | null
    ): Promise<ExternalApiKeySummary> {
      await requireManagementPlan(userId);
      const normalizedLimit = normalizeExternalApiKeyCreditLimit(creditLimit);
      const updated = await dependencies.repository.updateActiveQuota(
        userId,
        keyId,
        normalizedLimit,
        dependencies.now()
      );
      if (!updated) {
        return throwMutationMiss(
          userId,
          keyId,
          "已撤销的 API 密钥不能修改额度"
        );
      }
      return decorateMutationRow(userId, updated);
    },
  };
}

/** 从数据库选择安全 Key 字段，避免哈希和废弃治理列进入服务返回值。 */
function selectExternalApiKeyFields(
  externalApiKey: typeof externalApiKeyTable
) {
  return {
    id: externalApiKey.id,
    userId: externalApiKey.userId,
    name: externalApiKey.name,
    keyPrefix: externalApiKey.keyPrefix,
    lastFour: externalApiKey.lastFour,
    generationGroupId: externalApiKey.generationGroupId,
    creditLimit: externalApiKey.creditLimit,
    creditsUsed: externalApiKey.creditsUsed,
    lastUsedAt: externalApiKey.lastUsedAt,
    isActive: externalApiKey.isActive,
    createdAt: externalApiKey.createdAt,
    updatedAt: externalApiKey.updatedAt,
  };
}

/** 延迟加载数据库实现，避免 DB-free 服务测试在 import 阶段创建数据库依赖。 */
async function loadDatabaseModules() {
  return Promise.all([
    import("@repo/database"),
    import("@repo/database/schema"),
    import("drizzle-orm"),
  ]);
}

const databaseExternalApiKeyRepository: ExternalApiKeyRepository = {
  /** left join 当前分组，使已禁用现值仍可在摘要中识别。 */
  async listByUser(userId) {
    const [{ db }, { externalApiKey, imageBackendGroup }, { desc, eq }] =
      await loadDatabaseModules();
    const rows = await db
      .select({
        key: selectExternalApiKeyFields(externalApiKey),
        currentGroup: {
          id: imageBackendGroup.id,
          name: imageBackendGroup.name,
          isEnabled: imageBackendGroup.isEnabled,
          isUserSelectable: imageBackendGroup.isUserSelectable,
        },
      })
      .from(externalApiKey)
      .leftJoin(
        imageBackendGroup,
        eq(externalApiKey.generationGroupId, imageBackendGroup.id)
      )
      .where(eq(externalApiKey.userId, userId))
      .orderBy(desc(externalApiKey.createdAt));
    return rows as Array<{
      key: ExternalApiKeyRecord;
      currentGroup: ExternalApiKeyGroupRecord | null;
    }>;
  },

  /** 插入仅含哈希的 Key，并返回安全字段。 */
  async insert(values) {
    const [{ db }, { externalApiKey }] = await loadDatabaseModules();
    const [row] = await db
      .insert(externalApiKey)
      .values(values)
      .returning(selectExternalApiKeyFields(externalApiKey));
    return (row as ExternalApiKeyRecord | undefined) ?? null;
  },

  /** 仅撤销本人当前启用的 Key，并以 returning 判断真实写入。 */
  async revokeActive(userId, keyId, updatedAt) {
    const [{ db }, { externalApiKey }, { and, eq }] =
      await loadDatabaseModules();
    const [row] = await db
      .update(externalApiKey)
      .set({ isActive: false, updatedAt })
      .where(
        and(
          eq(externalApiKey.id, keyId),
          eq(externalApiKey.userId, userId),
          eq(externalApiKey.isActive, true)
        )
      )
      .returning(selectExternalApiKeyFields(externalApiKey));
    return (row as ExternalApiKeyRecord | undefined) ?? null;
  },

  /** 单条条件删除本人已撤销 Key，禁止先查后删。 */
  async deleteRevoked(userId, keyId) {
    const [{ db }, { externalApiKey }, { and, eq }] =
      await loadDatabaseModules();
    const [row] = await db
      .delete(externalApiKey)
      .where(
        and(
          eq(externalApiKey.id, keyId),
          eq(externalApiKey.userId, userId),
          eq(externalApiKey.isActive, false)
        )
      )
      .returning({ id: externalApiKey.id });
    return row ?? null;
  },

  /** 仅更新本人启用 Key 的后端分组。 */
  async updateActiveGroup(userId, keyId, generationGroupId, updatedAt) {
    const [{ db }, { externalApiKey }, { and, eq }] =
      await loadDatabaseModules();
    const [row] = await db
      .update(externalApiKey)
      .set({ generationGroupId, updatedAt })
      .where(
        and(
          eq(externalApiKey.id, keyId),
          eq(externalApiKey.userId, userId),
          eq(externalApiKey.isActive, true)
        )
      )
      .returning(selectExternalApiKeyFields(externalApiKey));
    return (row as ExternalApiKeyRecord | undefined) ?? null;
  },

  /** 仅更新本人启用 Key 的积分额度。 */
  async updateActiveQuota(userId, keyId, creditLimit, updatedAt) {
    const [{ db }, { externalApiKey }, { and, eq }] =
      await loadDatabaseModules();
    const [row] = await db
      .update(externalApiKey)
      .set({ creditLimit, updatedAt })
      .where(
        and(
          eq(externalApiKey.id, keyId),
          eq(externalApiKey.userId, userId),
          eq(externalApiKey.isActive, true)
        )
      )
      .returning(selectExternalApiKeyFields(externalApiKey));
    return (row as ExternalApiKeyRecord | undefined) ?? null;
  },

  /** 在条件写入 0 行后读取当前所有权范围内的真实生命周期状态。 */
  async findState(userId, keyId) {
    const [{ db }, { externalApiKey }, { and, eq }] =
      await loadDatabaseModules();
    const [row] = await db
      .select({ isActive: externalApiKey.isActive })
      .from(externalApiKey)
      .where(
        and(eq(externalApiKey.id, keyId), eq(externalApiKey.userId, userId))
      )
      .limit(1);
    return row ?? null;
  },
};

/** 默认生产服务；仅在实际调用时加载数据库、套餐与分组实现。 */
export const externalApiKeyManagementService =
  createExternalApiKeyManagementService({
    repository: databaseExternalApiKeyRepository,
    async getUserPlan(userId) {
      const { getUserPlan } = await import(
        "@repo/shared/subscription/services/user-plan"
      );
      return (await getUserPlan(userId)).plan;
    },
    async canUsePlanCapability(plan, capability) {
      const { canUsePlanCapability } = await import(
        "@repo/shared/subscription/services/plan-capabilities"
      );
      return canUsePlanCapability(plan, capability);
    },
    async listSelectableGroups(plan) {
      const { listImageBackendGroupOptions } = await import(
        "@/features/image-backend-pool/service"
      );
      return listImageBackendGroupOptions({
        userSelectableOnly: true,
        plan,
      });
    },
    async getGroupById(groupId) {
      const [{ db }, { imageBackendGroup }, { eq }] =
        await loadDatabaseModules();
      const [row] = await db
        .select({
          id: imageBackendGroup.id,
          name: imageBackendGroup.name,
          isEnabled: imageBackendGroup.isEnabled,
          isUserSelectable: imageBackendGroup.isUserSelectable,
        })
        .from(imageBackendGroup)
        .where(eq(imageBackendGroup.id, groupId))
        .limit(1);
      return row ?? null;
    },
    createId: nanoid,
    createSecret: createApiKey,
    hashSecret: hashApiKey,
    now: () => new Date(),
  });
