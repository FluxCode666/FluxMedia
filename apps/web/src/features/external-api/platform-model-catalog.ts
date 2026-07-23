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

/** 判断一个套餐是否达到动态能力门槛。 */
function planAllows(
  plan: SubscriptionPlan,
  minimumPlan: SubscriptionPlan
): boolean {
  return isPlanAtLeast(plan, minimumPlan);
}

/** 判断分组是否对指定套餐开放。 */
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
 */
function buildReachablePlansByMemberGroup(
  source: PlatformModelCatalogSource
): Map<string, Set<SubscriptionPlan>> {
  const enabledGroups = source.groups.filter((group) => group.isEnabled);
  const defaultGroup =
    enabledGroups.find((group) => group.isDefault) ?? enabledGroups[0];
  const groupsById = new Map(source.groups.map((group) => [group.id, group]));
  const plansByGroupId = new Map<string, Set<SubscriptionPlan>>();
  const addPlan = (groupId: string, plan: SubscriptionPlan) => {
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

/** 汇总成员经直接或一层 mixed 路径可被哪些套餐承接。 */
function getMemberPlans(
  member: PlatformModelCatalogMember,
  plansByGroupId: ReadonlyMap<string, ReadonlySet<SubscriptionPlan>>
): Set<SubscriptionPlan> {
  const plans = new Set<SubscriptionPlan>();
  for (const groupId of member.groupIds) {
    for (const plan of plansByGroupId.get(groupId) ?? []) {
      plans.add(plan);
    }
  }
  return plans;
}

/** 判断成员是否表达稳定的平台支持，而不是瞬时调度可用性。 */
function isPlatformSupportedMember(
  member: PlatformModelCatalogMember
): boolean {
  return member.isEnabled && member.status !== "error";
}

/** 判断至少一个可达套餐允许外部图像能力。 */
function hasImagePlan(
  plans: ReadonlySet<SubscriptionPlan>,
  minimums: PlatformModelCapabilityMinimums
): boolean {
  return Array.from(plans).some((plan) =>
    planAllows(plan, minimums.externalImagesGenerate)
  );
}

/** 判断指定成员和模型在至少一个可达套餐上有对话承接能力。 */
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

/** 向分类集合加入规范化后的模型 ID，大小写重复保留首次权威写法。 */
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

/** 将模型集合按大小写无关 ID 稳定排序并转为公开 DTO。 */
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

/** 将 API 供应商成员按权威目录和接口模式收窄到公开分类。 */
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
      if (imageAllowed && member.adobeSourced) {
        addCatalogModel(modelsByCategory, "video", modelId);
      }
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

/** 将账号成员的默认图像能力和权威对话常量加入公开分类。 */
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

/** 将 Adobe 成员的明确图像白名单和可执行视频目录加入公开分类。 */
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

  for (const member of source.members) {
    if (!isPlatformSupportedMember(member)) continue;
    const plans = getMemberPlans(member, plansByGroupId);
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
