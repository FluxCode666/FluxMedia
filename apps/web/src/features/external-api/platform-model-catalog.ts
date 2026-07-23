/**
 * 平台公开模型目录的 DB-free 构建逻辑。
 *
 * 使用方：运行时目录服务将套餐能力、后端分组和成员事实收窄为首页可公开的三类
 * 模型 ID。关键依赖：现有 Adobe、对话和后端声明目录；本模块不读取数据库。
 */
import { collectAdvertisedAdobeImageModelIds } from "@repo/shared/adobe/enabled-models";
import {
  FIREFLY_VIDEO_MODEL_CATALOG,
  isFireflyVideoModelId,
} from "@repo/shared/adobe/firefly-direct";
import {
  GPT55_CHAT_MODEL,
  isPlanAtLeast,
  RESPONSES_IMAGE_MODELS,
  SUBSCRIPTION_PLANS,
  type SubscriptionPlan,
} from "@repo/shared/config/subscription-plan";
import { collectAdvertisedModelIds } from "@repo/shared/image-backend/supported-models";
import { imageBackendApiInterfaceAllowsRequest } from "@/features/image-backend-pool/api-interface-mode";
import { DEFAULT_IMAGE_MODEL } from "@/features/image-generation/resolution";

/** 平台模型目录最终公开的单条模型。 */
export type PlatformModelCatalogItem = { id: string };

/** 平台模型目录按首页展示类别拆分的公开结构。 */
export type PlatformModelCatalog = {
  image: PlatformModelCatalogItem[];
  video: PlatformModelCatalogItem[];
  conversation: PlatformModelCatalogItem[];
};

/** 构建器判断所有有效套餐能力并集所需的动态最低套餐。 */
export type PlatformModelCapabilityMinimums = {
  backendGroupsSelect: SubscriptionPlan;
  externalModelsList: SubscriptionPlan;
  externalImagesGenerate: SubscriptionPlan;
  externalChatCompletions: SubscriptionPlan;
  externalResponses: SubscriptionPlan;
  gpt55: SubscriptionPlan;
};

/** 后端池分组中与公开可达性有关的非敏感字段。 */
export type PlatformModelCatalogGroup = {
  id: string;
  isEnabled: boolean;
  isDefault: boolean;
  isUserSelectable: boolean;
  minPlan: SubscriptionPlan;
  backendType: "mixed" | "web" | "responses";
  childGroupIds: readonly string[];
};

type PlatformModelCatalogMemberBase = {
  groupIds: readonly string[];
  isEnabled: boolean;
  status: string;
  cooldownUntil?: Date | string | null;
};

/** API 供应商成员中可用于判定公开模型的白名单字段。 */
export type PlatformModelCatalogApiMember = PlatformModelCatalogMemberBase & {
  type: "api";
  interfaceMode: string;
  imageUpstreamMode: string;
  model?: string | null;
  supportedModelIds?: unknown;
  adobeSourced: boolean;
};

/** Web/Responses 账号成员中可用于判定平台能力的白名单字段。 */
export type PlatformModelCatalogAccountMember =
  PlatformModelCatalogMemberBase & {
    type: "account";
    implementationMode: string;
  };

/** Adobe 成员中可用于判定图像和视频目录的白名单字段。 */
export type PlatformModelCatalogAdobeMember = PlatformModelCatalogMemberBase & {
  type: "adobe";
  mode: string;
  enabledModels?: unknown;
  supportsVideo: boolean;
};

/** 构建器接受的无敏感成员事实。 */
export type PlatformModelCatalogMember =
  | PlatformModelCatalogApiMember
  | PlatformModelCatalogAccountMember
  | PlatformModelCatalogAdobeMember;

/** 平台目录构建器的完整输入。 */
export type PlatformModelCatalogSource = {
  capabilityMinimums: PlatformModelCapabilityMinimums;
  groups: readonly PlatformModelCatalogGroup[];
  members: readonly PlatformModelCatalogMember[];
};

type CatalogCategory = keyof PlatformModelCatalog;

const CONVERSATION_MODEL_IDS = new Set<string>(
  RESPONSES_IMAGE_MODELS.map((modelId) => modelId.toLowerCase())
);
const NON_EXECUTABLE_IMAGE_MODEL_IDS = new Set(["auto", "default", "unknown"]);

/**
 * 判断一个套餐是否达到动态能力门槛。
 *
 * @param plan - 待判断的套餐。
 * @param minimumPlan - 能力要求的最低套餐。
 * @returns 套餐等级达到门槛时返回 true。
 * @remarks 纯函数，无副作用；套餐排序由共享能力模块决定，非法值由类型层阻止。
 */
function planAllows(
  plan: SubscriptionPlan,
  minimumPlan: SubscriptionPlan
): boolean {
  return isPlanAtLeast(plan, minimumPlan);
}

/**
 * 判断分组是否对指定套餐开放。
 *
 * @param group - 待检查的后端分组。
 * @param plan - 请求访问分组的套餐。
 * @returns 分组已启用且套餐达到分组门槛时返回 true。
 * @remarks 纯函数，无副作用；停用分组始终拒绝，不执行额外回退。
 */
function groupAllowsPlan(
  group: PlatformModelCatalogGroup,
  plan: SubscriptionPlan
): boolean {
  return group.isEnabled && planAllows(plan, group.minPlan);
}

/**
 * 建立成员实际归属分组到可达套餐的映射。
 *
 * 默认路径只取调度器会选择的首个默认组（无默认时取首个启用组）；可选路径必须同时
 * 满足分组开关、套餐门槛和动态 `backendGroups.select` 能力。mixed 仅展开一层有效叶子。
 *
 * @param source - 已收窄的套餐能力、分组和成员事实。
 * @returns 每个可达成员分组对应的套餐集合；没有启用分组时返回空映射。
 * @remarks 仅创建本地集合，无外部副作用；缺失、嵌套或非法 mixed 子组会被保守跳过。
 */
function buildReachablePlansByMemberGroup(
  source: PlatformModelCatalogSource
): Map<string, Set<SubscriptionPlan>> {
  const enabledGroups = source.groups.filter((group) => group.isEnabled);
  const defaultGroup =
    enabledGroups.find((group) => group.isDefault) ?? enabledGroups[0];
  const groupsById = new Map(source.groups.map((group) => [group.id, group]));
  const plansByGroupId = new Map<string, Set<SubscriptionPlan>>();
  /**
   * 把套餐加入指定分组的本地可达集合。
   *
   * @param groupId - 已确认可达的分组 ID。
   * @param plan - 可访问该分组的套餐。
   * @returns 无返回值。
   * @remarks 仅修改本函数创建的映射；重复套餐由 Set 安全去重。
   */
  const addPlan = (groupId: string, plan: SubscriptionPlan): void => {
    const plans = plansByGroupId.get(groupId) ?? new Set<SubscriptionPlan>();
    plans.add(plan);
    plansByGroupId.set(groupId, plans);
  };

  for (const plan of SUBSCRIPTION_PLANS) {
    if (!planAllows(plan, source.capabilityMinimums.externalModelsList)) {
      continue;
    }
    const roots = new Set<PlatformModelCatalogGroup>();
    if (defaultGroup && groupAllowsPlan(defaultGroup, plan)) {
      roots.add(defaultGroup);
    }
    if (planAllows(plan, source.capabilityMinimums.backendGroupsSelect)) {
      for (const group of enabledGroups) {
        if (group.isUserSelectable && groupAllowsPlan(group, plan)) {
          roots.add(group);
        }
      }
    }

    for (const root of roots) {
      addPlan(root.id, plan);
      if (root.backendType !== "mixed") continue;
      for (const childGroupId of root.childGroupIds) {
        const child = groupsById.get(childGroupId);
        if (
          !child ||
          !groupAllowsPlan(child, plan) ||
          child.backendType === "mixed" ||
          child.childGroupIds.length > 0
        ) {
          continue;
        }
        addPlan(child.id, plan);
      }
    }
  }

  return plansByGroupId;
}

/**
 * 将账号实现模式规范化为调度器使用的 web 或 responses 车道。
 *
 * @param value - 数据库提供的账号实现模式。
 * @returns 精确的 responses 保持原值，其余值保守回退为 web。
 * @remarks 纯函数，无副作用；该回退与账号调度器的兼容行为一致。
 */
function normalizeAccountImplementationMode(
  value: string
): Exclude<PlatformModelCatalogGroup["backendType"], "mixed"> {
  return value === "responses" ? "responses" : "web";
}

/**
 * 判断成员是否能从所属分组贡献目录能力。
 *
 * @param member - 待聚合套餐的成员。
 * @param group - 成员直接所属且已存在的分组。
 * @returns 非账号成员始终返回 true；账号仅在 mixed 或同车道分组返回 true。
 * @remarks 纯函数，无副作用；未知账号实现模式按 web 处理，避免误入 responses 车道。
 */
function memberMatchesGroupBackend(
  member: PlatformModelCatalogMember,
  group: PlatformModelCatalogGroup
): boolean {
  if (member.type !== "account" || group.backendType === "mixed") return true;
  return (
    group.backendType ===
    normalizeAccountImplementationMode(member.implementationMode)
  );
}

/**
 * 汇总成员经直接或一层 mixed 路径可被哪些套餐承接。
 *
 * @param member - 待计算可达套餐的成员。
 * @param plansByGroupId - 分组到可达套餐的预计算映射。
 * @param groupsById - 分组 ID 到分组事实的映射。
 * @returns 去重后的可达套餐集合；无有效或兼容分组时返回空集合。
 * @remarks 仅创建本地 Set，无外部副作用；缺失分组会被跳过，API 与 Adobe 不做车道过滤。
 */
function getMemberPlans(
  member: PlatformModelCatalogMember,
  plansByGroupId: ReadonlyMap<string, ReadonlySet<SubscriptionPlan>>,
  groupsById: ReadonlyMap<string, PlatformModelCatalogGroup>
): Set<SubscriptionPlan> {
  const plans = new Set<SubscriptionPlan>();
  for (const groupId of member.groupIds) {
    const group = groupsById.get(groupId);
    if (!group || !memberMatchesGroupBackend(member, group)) continue;
    for (const plan of plansByGroupId.get(groupId) ?? []) {
      plans.add(plan);
    }
  }
  return plans;
}

/**
 * 判断成员是否表达稳定的平台支持，而不是瞬时调度可用性。
 *
 * @param member - 待检查的运行时成员事实。
 * @returns 成员启用且未处于终态 error 时返回 true。
 * @remarks 纯函数，无副作用；limited 与 cooldown 属于瞬时状态，仍视为受支持。
 */
function isPlatformSupportedMember(
  member: PlatformModelCatalogMember
): boolean {
  return member.isEnabled && member.status !== "error";
}

/**
 * 判断至少一个可达套餐是否允许外部图像能力。
 *
 * @param plans - 成员可达的套餐集合。
 * @param minimums - 当前动态能力门槛。
 * @returns 任一套餐达到图像生成门槛时返回 true；空集合返回 false。
 * @remarks 纯函数，无副作用；能力门槛异常由上游事实加载失败处理。
 */
function hasImagePlan(
  plans: ReadonlySet<SubscriptionPlan>,
  minimums: PlatformModelCapabilityMinimums
): boolean {
  return Array.from(plans).some((plan) =>
    planAllows(plan, minimums.externalImagesGenerate)
  );
}

/**
 * 判断指定成员和模型在至少一个可达套餐上是否有对话承接能力。
 *
 * @param member - API 或账号成员的接口事实。
 * @param modelId - 待分类的模型 ID。
 * @param plans - 成员可达的套餐集合。
 * @param minimums - 当前动态能力门槛。
 * @returns 任一套餐及接口路径可承接该模型时返回 true。
 * @remarks 纯函数，无副作用；空套餐返回 false，GPT-5.5 还需满足专属能力门槛。
 */
function hasConversationPlan(
  member: PlatformModelCatalogApiMember | PlatformModelCatalogAccountMember,
  modelId: string,
  plans: ReadonlySet<SubscriptionPlan>,
  minimums: PlatformModelCapabilityMinimums
): boolean {
  return Array.from(plans).some((plan) => {
    if (
      modelId.toLowerCase() === GPT55_CHAT_MODEL.toLowerCase() &&
      !planAllows(plan, minimums.gpt55)
    ) {
      return false;
    }
    const chatAllowed =
      planAllows(plan, minimums.externalChatCompletions) &&
      (member.type === "account" ||
        imageBackendApiInterfaceAllowsRequest(
          member.interfaceMode,
          "chat",
          member.imageUpstreamMode
        ));
    const responsesAllowed =
      planAllows(plan, minimums.externalResponses) &&
      (member.type === "account"
        ? member.implementationMode === "responses"
        : imageBackendApiInterfaceAllowsRequest(
            member.interfaceMode,
            "responses",
            member.imageUpstreamMode
          ));
    return chatAllowed || responsesAllowed;
  });
}

/**
 * 向分类集合加入规范化后的模型 ID。
 *
 * @param modelsByCategory - 本次构建使用的可变分类集合。
 * @param category - 模型要加入的公开分类。
 * @param value - 待校验的未知模型 ID。
 * @returns 无返回值。
 * @remarks 会修改传入 Map；非字符串、空值和超过 120 字符的值被跳过，大小写重复保留首次写法。
 */
function addCatalogModel(
  modelsByCategory: Record<CatalogCategory, Map<string, string>>,
  category: CatalogCategory,
  value: unknown
): void {
  if (typeof value !== "string") return;
  const id = value.trim();
  if (!id || id.length > 120) return;
  const key = id.toLowerCase();
  if (!modelsByCategory[category].has(key)) {
    modelsByCategory[category].set(key, id);
  }
}

/**
 * 将模型集合按大小写无关 ID 稳定排序并转为公开 DTO。
 *
 * @param models - 已按规范化 ID 去重的只读模型集合。
 * @returns 仅含模型 ID 的新数组；空集合返回空数组。
 * @remarks 纯转换，无外部副作用；相同规范化 ID 的兜底排序使用原始写法。
 */
function toSortedCatalogItems(
  models: ReadonlyMap<string, string>
): PlatformModelCatalogItem[] {
  return Array.from(models, ([normalizedId, id]) => ({ normalizedId, id }))
    .sort((left, right) => {
      if (left.normalizedId < right.normalizedId) return -1;
      if (left.normalizedId > right.normalizedId) return 1;
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    })
    .map(({ id }) => ({ id }));
}

/**
 * 将 API 供应商成员按权威目录和接口模式收窄到公开分类。
 *
 * @param member - API 成员的非敏感模型与接口事实。
 * @param plans - 该成员可达的套餐集合。
 * @param source - 动态能力门槛与分组事实。
 * @param modelsByCategory - 本次构建使用的可变分类集合。
 * @returns 无返回值。
 * @remarks 会写入分类 Map；非法声明由权威收集器忽略，Firefly 视频一律留给 Adobe direct 成员。
 */
function addApiMemberModels(
  member: PlatformModelCatalogApiMember,
  plans: ReadonlySet<SubscriptionPlan>,
  source: PlatformModelCatalogSource,
  modelsByCategory: Record<CatalogCategory, Map<string, string>>
): void {
  const modelIds = collectAdvertisedModelIds([
    { model: member.model, supportedModelIds: member.supportedModelIds },
  ]);
  const imageAllowed =
    hasImagePlan(plans, source.capabilityMinimums) &&
    imageBackendApiInterfaceAllowsRequest(
      member.interfaceMode,
      "image_generation",
      member.imageUpstreamMode
    );

  for (const modelId of modelIds) {
    if (isFireflyVideoModelId(modelId)) {
      continue;
    }
    if (CONVERSATION_MODEL_IDS.has(modelId.toLowerCase())) {
      if (
        hasConversationPlan(member, modelId, plans, source.capabilityMinimums)
      ) {
        addCatalogModel(modelsByCategory, "conversation", modelId);
      }
      continue;
    }
    if (!imageAllowed) continue;
    if (
      modelId.trim().toLowerCase().startsWith("firefly-") &&
      !member.adobeSourced
    ) {
      continue;
    }
    addCatalogModel(modelsByCategory, "image", modelId);
  }
}

/**
 * 将账号成员的默认图像能力和权威对话常量加入公开分类。
 *
 * @param member - 已通过分组车道校验的账号成员。
 * @param plans - 该成员可达的套餐集合。
 * @param source - 动态能力门槛与分组事实。
 * @param modelsByCategory - 本次构建使用的可变分类集合。
 * @returns 无返回值。
 * @remarks 会写入分类 Map；无图像或对话能力时保持不变，未知实现模式已在分组聚合阶段回退为 web。
 */
function addAccountMemberModels(
  member: PlatformModelCatalogAccountMember,
  plans: ReadonlySet<SubscriptionPlan>,
  source: PlatformModelCatalogSource,
  modelsByCategory: Record<CatalogCategory, Map<string, string>>
): void {
  if (hasImagePlan(plans, source.capabilityMinimums)) {
    addCatalogModel(modelsByCategory, "image", DEFAULT_IMAGE_MODEL);
  }
  for (const modelId of RESPONSES_IMAGE_MODELS) {
    if (
      hasConversationPlan(member, modelId, plans, source.capabilityMinimums)
    ) {
      addCatalogModel(modelsByCategory, "conversation", modelId);
    }
  }
}

/**
 * 将 Adobe 成员的明确图像白名单和可执行视频目录加入公开分类。
 *
 * @param member - Adobe 成员的模式、白名单与视频支持事实。
 * @param plans - 该成员可达的套餐集合。
 * @param minimums - 当前动态能力门槛。
 * @param modelsByCategory - 本次构建使用的可变分类集合。
 * @returns 无返回值。
 * @remarks 会写入分类 Map；无图像能力时跳过全部，视频仅由 direct 且显式支持视频的成员贡献。
 */
function addAdobeMemberModels(
  member: PlatformModelCatalogAdobeMember,
  plans: ReadonlySet<SubscriptionPlan>,
  minimums: PlatformModelCapabilityMinimums,
  modelsByCategory: Record<CatalogCategory, Map<string, string>>
): void {
  if (!hasImagePlan(plans, minimums)) return;
  for (const modelId of collectAdvertisedAdobeImageModelIds([
    { enabledModels: member.enabledModels },
  ])) {
    addCatalogModel(modelsByCategory, "image", modelId);
  }
  if (member.mode !== "direct" || !member.supportsVideo) return;
  for (const modelId of Object.keys(FIREFLY_VIDEO_MODEL_CATALOG)) {
    addCatalogModel(modelsByCategory, "video", modelId);
  }
}

/**
 * 按所有有效套餐的真实可调用路径构建平台公开模型目录。
 *
 * @param source - 已收窄为非敏感字段的套餐、分组与成员运行时事实。
 * @returns 仅含三类稳定模型 ID 的公开目录；空分类保持空数组。
 * @remarks cooldown/limited 是瞬时调度状态，不会让平台支持目录闪烁；终态 error 排除。
 */
export function buildPlatformModelCatalog(
  source: PlatformModelCatalogSource
): PlatformModelCatalog {
  const modelsByCategory: Record<CatalogCategory, Map<string, string>> = {
    image: new Map(),
    video: new Map(),
    conversation: new Map(),
  };
  const plansByGroupId = buildReachablePlansByMemberGroup(source);
  const groupsById = new Map(source.groups.map((group) => [group.id, group]));

  for (const member of source.members) {
    if (!isPlatformSupportedMember(member)) continue;
    const plans = getMemberPlans(member, plansByGroupId, groupsById);
    if (plans.size === 0) continue;
    if (member.type === "api") {
      addApiMemberModels(member, plans, source, modelsByCategory);
    } else if (member.type === "account") {
      addAccountMemberModels(member, plans, source, modelsByCategory);
    } else {
      addAdobeMemberModels(
        member,
        plans,
        source.capabilityMinimums,
        modelsByCategory
      );
    }
  }

  return {
    image: toSortedCatalogItems(modelsByCategory.image),
    video: toSortedCatalogItems(modelsByCategory.video),
    conversation: toSortedCatalogItems(modelsByCategory.conversation),
  };
}

/**
 * 判断模型 ID 是否能安全用于快速集成的真实图像请求。
 *
 * @param modelId - 平台目录中的候选图像模型 ID。
 * @returns 非空且不是 default/unknown/auto 占位符时返回 true。
 */
export function isConcretePlatformImageModelId(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase();
  return Boolean(normalized && !NON_EXECUTABLE_IMAGE_MODEL_IDS.has(normalized));
}
