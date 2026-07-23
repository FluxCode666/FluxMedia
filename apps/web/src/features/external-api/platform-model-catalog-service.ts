/**
 * 平台公开模型目录的服务端运行时加载器。
 *
 * 使用方：UOL late binding；通过显式数据库列投影读取套餐能力、分组与成员事实，
 * 再交给 DB-free 构建器。关键依赖：Drizzle、套餐能力矩阵和平台目录构建器。
 */
import "server-only";

import { db } from "@repo/database";
import {
  imageBackendAccount,
  imageBackendAccountGroup,
  imageBackendAdobe,
  imageBackendAdobeGroup,
  imageBackendApi,
  imageBackendApiGroup,
  imageBackendGroup,
} from "@repo/database/schema";
import {
  normalizeSubscriptionPlan,
  type SubscriptionPlan,
} from "@repo/shared/config/subscription-plan";
import type {
  PlanCapabilityKey,
  PlanCapabilityMatrix,
} from "@repo/shared/subscription/services/plan-capabilities";
import { getPlanCapabilityMatrix } from "@repo/shared/subscription/services/plan-capabilities";
import { asc, eq } from "drizzle-orm";

import {
  buildPlatformModelCatalog,
  type PlatformModelCapabilityMinimums,
  type PlatformModelCatalog,
  type PlatformModelCatalogGroup,
  type PlatformModelCatalogMember,
} from "./platform-model-catalog";

type GroupRow = {
  id: string;
  isEnabled: boolean;
  isDefault: boolean;
  isUserSelectable: boolean;
  metadata: Record<string, unknown> | null;
};

type MemberGroupRow = {
  matchedGroupId: string | null;
  groupId: string | null;
  isEnabled: boolean;
  status: string;
  cooldownUntil?: Date | string | null;
};

type ApiMemberRow = MemberGroupRow & {
  interfaceMode: string;
  imageUpstreamMode: string;
  model: string | null;
  supportedModelIds: unknown;
  adobeSourced: boolean;
};

type AccountMemberRow = MemberGroupRow & {
  implementationMode: string;
};

type AdobeMemberRow = MemberGroupRow & {
  mode: string;
  enabledModels: unknown;
  supportsVideo: boolean;
};

/** 目录服务可替换的数据读取边界，测试无需连接数据库。 */
export type PlatformModelCatalogRepository = {
  listGroups: () => Promise<GroupRow[]>;
  listApiMembers: () => Promise<ApiMemberRow[]>;
  listAccountMembers: () => Promise<AccountMemberRow[]>;
  listAdobeMembers: () => Promise<AdobeMemberRow[]>;
};

/** 目录服务依赖；默认使用当前运行时数据库和套餐能力矩阵。 */
export type PlatformModelCatalogServiceDependencies = {
  repository: PlatformModelCatalogRepository;
  loadCapabilityMatrix: () => Promise<PlanCapabilityMatrix>;
};

/** 判断未知 metadata 是否可安全按记录读取。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/** 从分组 metadata 收窄后端车道，非法值沿用调度器的 mixed 默认。 */
function normalizeBackendType(
  value: unknown
): PlatformModelCatalogGroup["backendType"] {
  return value === "web" || value === "responses" ? value : "mixed";
}

/** 从分组 metadata 收窄一层子组 ID 并稳定去重。 */
function normalizeChildGroupIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const childGroupIds: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    childGroupIds.push(id);
  }
  return childGroupIds;
}

/** 将数据库分组行映射为不含描述、价格和内部 metadata 的构建器输入。 */
function toCatalogGroup(row: GroupRow): PlatformModelCatalogGroup {
  const metadata = isRecord(row.metadata) ? row.metadata : {};
  return {
    id: row.id,
    isEnabled: row.isEnabled,
    isDefault: row.isDefault,
    isUserSelectable: row.isUserSelectable,
    minPlan: normalizeSubscriptionPlan(metadata.minPlan, "free"),
    backendType: normalizeBackendType(metadata.backendType),
    childGroupIds: normalizeChildGroupIds(metadata.childGroupIds),
  };
}

/** 将成员的主分组和多对多分组收窄为无空值的稳定集合。 */
function toMemberGroupIds(row: MemberGroupRow): string[] {
  const groupIds: string[] = [];
  for (const value of [row.matchedGroupId, row.groupId]) {
    const id = value?.trim();
    if (id && !groupIds.includes(id)) groupIds.push(id);
  }
  return groupIds;
}

/** 从动态能力矩阵提取构建目录所需的最小能力门槛。 */
function toCapabilityMinimums(
  matrix: PlanCapabilityMatrix
): PlatformModelCapabilityMinimums {
  const feature = (key: PlanCapabilityKey): SubscriptionPlan =>
    matrix.features[key];
  return {
    backendGroupsSelect: feature("backendGroups.select"),
    externalModelsList: feature("externalApi.models.list"),
    externalImagesGenerate: feature("externalApi.images.generate"),
    externalChatCompletions: feature("externalApi.chat.completions"),
    externalResponses: feature("externalApi.responses"),
    gpt55: feature("models.gpt55"),
  };
}

/** 读取后端分组的公开可达性字段，排序与默认调度回退保持一致。 */
async function listGroups(): Promise<GroupRow[]> {
  return db
    .select({
      id: imageBackendGroup.id,
      isEnabled: imageBackendGroup.isEnabled,
      isDefault: imageBackendGroup.isDefault,
      isUserSelectable: imageBackendGroup.isUserSelectable,
      metadata: imageBackendGroup.metadata,
    })
    .from(imageBackendGroup)
    .orderBy(asc(imageBackendGroup.priority), asc(imageBackendGroup.createdAt));
}

/** 读取 API 成员的模型、接口模式、稳定状态和分组关系，不投影 URL 或密钥。 */
async function listApiMembers(): Promise<ApiMemberRow[]> {
  return db
    .select({
      matchedGroupId: imageBackendApiGroup.groupId,
      groupId: imageBackendApi.groupId,
      isEnabled: imageBackendApi.isEnabled,
      status: imageBackendApi.status,
      cooldownUntil: imageBackendApi.cooldownUntil,
      interfaceMode: imageBackendApi.interfaceMode,
      imageUpstreamMode: imageBackendApi.imageUpstreamMode,
      model: imageBackendApi.model,
      supportedModelIds: imageBackendApi.supportedModelIds,
      adobeSourced: imageBackendApi.adobeSourced,
    })
    .from(imageBackendApi)
    .leftJoin(
      imageBackendApiGroup,
      eq(imageBackendApiGroup.apiId, imageBackendApi.id)
    );
}

/** 读取账号成员的实现车道、稳定状态和分组关系，不投影凭据或远端账号信息。 */
async function listAccountMembers(): Promise<AccountMemberRow[]> {
  return db
    .select({
      matchedGroupId: imageBackendAccountGroup.groupId,
      groupId: imageBackendAccount.groupId,
      isEnabled: imageBackendAccount.isEnabled,
      status: imageBackendAccount.status,
      cooldownUntil: imageBackendAccount.cooldownUntil,
      implementationMode: imageBackendAccount.implementationMode,
    })
    .from(imageBackendAccount)
    .leftJoin(
      imageBackendAccountGroup,
      eq(imageBackendAccountGroup.accountId, imageBackendAccount.id)
    );
}

/** 读取 Adobe 成员的图像白名单、视频开关、稳定状态和分组关系。 */
async function listAdobeMembers(): Promise<AdobeMemberRow[]> {
  return db
    .select({
      matchedGroupId: imageBackendAdobeGroup.groupId,
      groupId: imageBackendAdobe.groupId,
      isEnabled: imageBackendAdobe.isEnabled,
      status: imageBackendAdobe.status,
      cooldownUntil: imageBackendAdobe.cooldownUntil,
      mode: imageBackendAdobe.mode,
      enabledModels: imageBackendAdobe.enabledModels,
      supportsVideo: imageBackendAdobe.supportsVideo,
    })
    .from(imageBackendAdobe)
    .leftJoin(
      imageBackendAdobeGroup,
      eq(imageBackendAdobeGroup.adobeId, imageBackendAdobe.id)
    );
}

/** 生产环境数据库读取器，只暴露构建目录需要的显式列。 */
export const databasePlatformModelCatalogRepository: PlatformModelCatalogRepository =
  {
    listGroups,
    listApiMembers,
    listAccountMembers,
    listAdobeMembers,
  };

/** 将 API 数据行显式映射为不含敏感字段的构建器成员。 */
function toApiMember(row: ApiMemberRow): PlatformModelCatalogMember {
  return {
    type: "api",
    groupIds: toMemberGroupIds(row),
    isEnabled: row.isEnabled,
    status: row.status,
    cooldownUntil: row.cooldownUntil,
    interfaceMode: row.interfaceMode,
    imageUpstreamMode: row.imageUpstreamMode,
    model: row.model,
    supportedModelIds: row.supportedModelIds,
    adobeSourced: row.adobeSourced,
  };
}

/** 将账号数据行显式映射为不含凭据的构建器成员。 */
function toAccountMember(row: AccountMemberRow): PlatformModelCatalogMember {
  return {
    type: "account",
    groupIds: toMemberGroupIds(row),
    isEnabled: row.isEnabled,
    status: row.status,
    cooldownUntil: row.cooldownUntil,
    implementationMode: row.implementationMode,
  };
}

/** 将 Adobe 数据行显式映射为不含地址、密钥和内部 ID 的构建器成员。 */
function toAdobeMember(row: AdobeMemberRow): PlatformModelCatalogMember {
  return {
    type: "adobe",
    groupIds: toMemberGroupIds(row),
    isEnabled: row.isEnabled,
    status: row.status,
    cooldownUntil: row.cooldownUntil,
    mode: row.mode,
    enabledModels: row.enabledModels,
    supportsVideo: row.supportsVideo,
  };
}

const defaultDependencies: PlatformModelCatalogServiceDependencies = {
  repository: databasePlatformModelCatalogRepository,
  loadCapabilityMatrix: getPlanCapabilityMatrix,
};

/**
 * 读取当前部署可公开展示的平台模型目录。
 *
 * @param dependencies - 可注入的数据库与能力矩阵读取器；生产调用使用默认实现。
 * @returns 只包含模型 ID 分类的稳定公开目录。
 * @throws 任一运行时事实源失败时原样上抛，由首页数据层收窄为“暂不可用”。
 */
export async function loadPlatformModelCatalog(
  dependencies: PlatformModelCatalogServiceDependencies = defaultDependencies
): Promise<PlatformModelCatalog> {
  const [groups, apiMembers, accountMembers, adobeMembers, matrix] =
    await Promise.all([
      dependencies.repository.listGroups(),
      dependencies.repository.listApiMembers(),
      dependencies.repository.listAccountMembers(),
      dependencies.repository.listAdobeMembers(),
      dependencies.loadCapabilityMatrix(),
    ]);

  return buildPlatformModelCatalog({
    capabilityMinimums: toCapabilityMinimums(matrix),
    groups: groups.map(toCatalogGroup),
    members: [
      ...apiMembers.map(toApiMember),
      ...accountMembers.map(toAccountMember),
      ...adobeMembers.map(toAdobeMember),
    ],
  });
}
