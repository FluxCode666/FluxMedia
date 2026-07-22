/**
 * 读取生图固定档位、模型覆盖和审核费用的运行时价格。
 *
 * 统一生图管线和展示页通过此模块取值，避免各处直接读取系统设置而产生缓存或
 * 默认值差异；分组覆盖由统一生图管线传入后在这里合并。
 */

import {
  type ImageCreditOverrides,
  type ResolvedImageCreditPricing,
  parseImageCreditOverrides,
  resolveImageCreditPricing,
} from "@repo/shared/image-backend/group-image-pricing";
import {
  getRuntimeSettingJson,
  getRuntimeSettingNumber,
} from "@repo/shared/system-settings";

import {
  DEFAULT_IMAGE_1K_BASE_CREDIT_COST,
  DEFAULT_IMAGE_2K_BASE_CREDIT_COST,
  DEFAULT_IMAGE_4K_BASE_CREDIT_COST,
  DEFAULT_IMAGE_1024_BASE_CREDIT_COST,
  DEFAULT_IMAGE_MODERATION_CREDIT_COST,
  DEFAULT_TEXT_MODERATION_CREDIT_COST,
  type ResolvedImageModerationCreditPricing,
} from "./resolution";

export async function getRuntimeImageBaseCreditPricing(): Promise<
  ResolvedImageCreditPricing
> {
  const [base1024Credits, base1kCredits, base2kCredits, base4kCredits] =
    await Promise.all([
      getRuntimeSettingNumber(
        "IMAGE_BASE_CREDITS_1024",
        DEFAULT_IMAGE_1024_BASE_CREDIT_COST,
        { positive: true }
      ),
      getRuntimeSettingNumber(
        "IMAGE_BASE_CREDITS_1K",
        DEFAULT_IMAGE_1K_BASE_CREDIT_COST,
        { positive: true }
      ),
      getRuntimeSettingNumber(
        "IMAGE_BASE_CREDITS_2K",
        DEFAULT_IMAGE_2K_BASE_CREDIT_COST,
        { positive: true }
      ),
      getRuntimeSettingNumber(
        "IMAGE_BASE_CREDITS_4K",
        DEFAULT_IMAGE_4K_BASE_CREDIT_COST,
        { positive: true }
      ),
    ]);

  return { base1024Credits, base1kCredits, base2kCredits, base4kCredits };
}

/** 读取允许为零的文本与输入图片审核费用。 */
export async function getRuntimeImageModerationCreditPricing(): Promise<ResolvedImageModerationCreditPricing> {
  const [textModerationCredits, imageModerationCredits] = await Promise.all([
    getRuntimeSettingNumber(
      "IMAGE_TEXT_MODERATION_CREDITS",
      DEFAULT_TEXT_MODERATION_CREDIT_COST
    ),
    getRuntimeSettingNumber(
      "IMAGE_INPUT_MODERATION_CREDITS",
      DEFAULT_IMAGE_MODERATION_CREDIT_COST
    ),
  ]);
  return { textModerationCredits, imageModerationCredits };
}

/** 读取并校验全局按模型固定价格。 */
export async function getRuntimeImageModelCreditPricing(): Promise<ImageCreditOverrides> {
  return parseImageCreditOverrides(
    await getRuntimeSettingJson("IMAGE_MODEL_CREDIT_PRICES")
  );
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
  const [fallback, global, moderationPricing] = await Promise.all([
    getRuntimeImageBaseCreditPricing(),
    getRuntimeImageModelCreditPricing(),
    getRuntimeImageModerationCreditPricing(),
  ]);
  return {
    basePricing: resolveImageCreditPricing({
      model,
      fallback,
      global,
      group,
    }),
    moderationPricing,
  };
}
