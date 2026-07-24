/**
 * 读取全局图像模型四档价格和审核费用的运行时配置。
 *
 * 统一生图管线和展示页通过此模块取值，避免各处直接读取系统设置而产生缓存或
 * 默认值差异；分组覆盖由统一生图管线传入后在这里合并。
 */

import {
  createDefaultGlobalImageCreditOverrides,
  globalImageCreditOverridesSchema,
  type ImageCreditOverrides,
  type ResolvedImageCreditPricing,
  resolveImageCreditPricing,
} from "@repo/shared/image-backend/group-image-pricing";
import {
  getRuntimeSettingJson,
  getRuntimeSettingNumber,
} from "@repo/shared/system-settings";

import {
  DEFAULT_IMAGE_MODERATION_CREDIT_COST,
  DEFAULT_TEXT_MODERATION_CREDIT_COST,
  type ResolvedImageModerationCreditPricing,
} from "./resolution";

/** 读取允许为零的文本与输入图片审核费用。 */
export async function getRuntimeImageModerationCreditPricing(): Promise<ResolvedImageModerationCreditPricing> {
  const [textModerationCredits, imageModerationCredits] = await Promise.all([
    getRuntimeSettingNumber(
      "IMAGE_TEXT_MODERATION_CREDITS",
      DEFAULT_TEXT_MODERATION_CREDIT_COST,
      { nonNegative: true }
    ),
    getRuntimeSettingNumber(
      "IMAGE_INPUT_MODERATION_CREDITS",
      DEFAULT_IMAGE_MODERATION_CREDIT_COST,
      { nonNegative: true }
    ),
  ]);
  return { textModerationCredits, imageModerationCredits };
}

/** 读取并校验全局按模型固定价格。 */
export async function getRuntimeImageModelCreditPricing(): Promise<ImageCreditOverrides> {
  const parsed = globalImageCreditOverridesSchema.safeParse(
    await getRuntimeSettingJson("IMAGE_MODEL_CREDIT_PRICES")
  );
  return parsed.success
    ? parsed.data
    : createDefaultGlobalImageCreditOverrides();
}

/**
 * 为尚未迁移的展示调用方返回全局默认模型四档价格。
 *
 * WHY: 旧调用方仍使用“base pricing”命名，但这里不再读取历史通用价格键；返回值直接
 * 来自必填全局模型矩阵，因此不会形成“分组 > 全局 > 通用价格”的第三层回退。
 */
export async function getRuntimeImageBaseCreditPricing(): Promise<ResolvedImageCreditPricing> {
  const global = await getRuntimeImageModelCreditPricing();
  return resolveImageCreditPricing({ model: "default", global });
}

/**
 * 解析本次请求使用的完整模型价格与审核费用。
 *
 * @param model - 实际生图模型。
 * @param group - 用户所选 billing group 的稀疏覆盖。
 * @returns 可直接交给纯计价函数的四档基础价格和审核费用。
 */
export async function getRuntimeImageCreditPricing(
  model: string | null | undefined,
  group?: ImageCreditOverrides | null
) {
  const [global, moderationPricing] = await Promise.all([
    getRuntimeImageModelCreditPricing(),
    getRuntimeImageModerationCreditPricing(),
  ]);
  return {
    basePricing: resolveImageCreditPricing({
      model,
      global,
      group,
    }),
    moderationPricing,
  };
}
