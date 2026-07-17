import {
  FIREFLY_IMAGE_FAMILY_MODEL_IDS,
  FIREFLY_VIDEO_MODEL_CATALOG,
} from "@repo/shared/adobe/firefly-direct";
import {
  GPT52_CHAT_MODEL,
  GPT53_CODEX_CHAT_MODEL,
  GPT53_CODEX_SPARK_CHAT_MODEL,
  GPT54_CHAT_MODEL,
  GPT54_MINI_CHAT_MODEL,
  GPT55_CHAT_MODEL,
  isPlanAtLeast,
  type SubscriptionPlan,
} from "@repo/shared/config/subscription-plan";
import { getPlanCapabilitySnapshot } from "@repo/shared/subscription/services/plan-capabilities";
import { getUserPlan } from "@repo/shared/subscription/services/user-plan";
import { DEFAULT_IMAGE_MODEL } from "@/features/image-generation/resolution";

const DEFAULT_MODEL_OWNER = "gpt2image";

type OpenAIModel = {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
};

export type OpenAIModelList = {
  object: "list";
  data: OpenAIModel[];
};

export function getExternalResponsesImageModels(
  plan: SubscriptionPlan,
  options?: { responsesAllowed?: boolean; gpt55Allowed?: boolean }
) {
  if (options?.responsesAllowed === false) {
    return [];
  }

  const models: string[] = [
    GPT54_CHAT_MODEL,
    GPT54_MINI_CHAT_MODEL,
    GPT52_CHAT_MODEL,
    GPT53_CODEX_CHAT_MODEL,
    GPT53_CODEX_SPARK_CHAT_MODEL,
  ];
  if (options?.gpt55Allowed ?? isPlanAtLeast(plan, "ultra")) {
    models.push(GPT55_CHAT_MODEL);
  }
  return models;
}

export function getExternalChatCompletionModels(
  plan: SubscriptionPlan,
  options?: { chatCompletionsAllowed?: boolean; gpt55Allowed?: boolean }
) {
  if (options?.chatCompletionsAllowed === false) {
    return [];
  }

  return getExternalResponsesImageModels(plan, {
    responsesAllowed: true,
    gpt55Allowed: options?.gpt55Allowed,
  });
}

/**
 * Adobe Firefly 模型 id 列表:图像族级 id（分辨率/宽高比走 size 参数）+ 视频全量 id
 * （参数编码在 id 内）。图像与视频生成均由 externalApi.images.generate 门控,关闭时返回
 * 空,避免在 /v1/models 列出无法调用的 model。
 */
export function getExternalFireflyModels(options?: {
  imageGenerateAllowed?: boolean;
  imageModelIds?: string[];
  videoEnabled?: boolean;
}): string[] {
  if (!options?.imageGenerateAllowed) return [];
  const imageModelIds = options.imageModelIds ?? FIREFLY_IMAGE_FAMILY_MODEL_IDS;
  const videoModelIds =
    options.videoEnabled === false
      ? []
      : Object.keys(FIREFLY_VIDEO_MODEL_CATALOG);
  return [...imageModelIds, ...videoModelIds];
}

function toOpenAIModel(id: string): OpenAIModel {
  return {
    id,
    object: "model",
    created: 0,
    owned_by: DEFAULT_MODEL_OWNER,
  };
}

/**
 * 合并各模型来源并按首次出现顺序去重。
 *
 * @param modelGroups - 套餐内置模型、Firefly 模型和供应商配置模型等来源。
 * @returns 可安全编码为 OpenAI List models 响应的唯一模型 ID 列表。
 */
export function mergeExternalModelIds(...modelGroups: string[][]): string[] {
  const seen = new Set<string>();
  const modelIds: string[] = [];
  for (const modelGroup of modelGroups) {
    for (const modelId of modelGroup) {
      const normalized = modelId.trim();
      if (!normalized) continue;
      const key = normalized.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      modelIds.push(normalized);
    }
  }
  return modelIds;
}

/**
 * 读取管理员在 API 后端供应商上声明、可公开列出的模型 ID。
 *
 * 延迟加载池服务，避免模型列表的纯函数测试在未实际调用数据库时加载完整调度器。
 *
 * @returns 已启用供应商的去重模型 ID 列表。
 */
async function listConfiguredApiModelIds(): Promise<string[]> {
  const { listEnabledImageBackendApiModelIds } = await import(
    "@/features/image-backend-pool/service"
  );
  return listEnabledImageBackendApiModelIds();
}

/**
 * 读取管理员在 Adobe 后端池中明确开放的 Firefly 模型。
 *
 * 延迟加载调度服务，避免纯模型列表单元测试在未实际调用数据库时加载完整后端池。
 *
 * @returns 可公开的图像模型族，以及是否存在可用的视频 Adobe 后端。
 */
async function listConfiguredAdobeModels(): Promise<{
  imageModelIds: string[];
  supportsVideo: boolean;
}> {
  const { listEnabledImageBackendAdobeModels } = await import(
    "@/features/image-backend-pool/service"
  );
  return listEnabledImageBackendAdobeModels();
}

/**
 * 按当前用户套餐与供应商配置生成 OpenAI 兼容模型列表。
 *
 * @param userId - 已由外部 API Key 鉴权得到的用户 ID。
 * @returns 仅包含当前套餐可见模型和已启用供应商模型的 OpenAI List models 响应。
 */
export async function getExternalModelsForUser(
  userId: string
): Promise<OpenAIModelList> {
  const plan = await getUserPlan(userId);
  const [capabilities, configuredApiModels, configuredAdobeModels] =
    await Promise.all([
      getPlanCapabilitySnapshot(plan.plan),
      listConfiguredApiModelIds(),
      listConfiguredAdobeModels(),
    ]);
  const imageModels = [DEFAULT_IMAGE_MODEL];
  const fireflyModels = getExternalFireflyModels({
    imageGenerateAllowed: capabilities.features["externalApi.images.generate"],
    imageModelIds: configuredAdobeModels.imageModelIds,
    videoEnabled: configuredAdobeModels.supportsVideo,
  });
  const chatModels = getExternalChatCompletionModels(plan.plan, {
    chatCompletionsAllowed:
      capabilities.features["externalApi.chat.completions"],
    gpt55Allowed: capabilities.features["models.gpt55"],
  });
  const responsesModels = getExternalResponsesImageModels(plan.plan, {
    responsesAllowed: capabilities.features["externalApi.responses"],
    gpt55Allowed: capabilities.features["models.gpt55"],
  });
  const modelIds = mergeExternalModelIds(
    imageModels,
    fireflyModels,
    chatModels,
    responsesModels,
    configuredApiModels
  );
  return {
    object: "list",
    data: modelIds.map(toOpenAIModel),
  };
}
