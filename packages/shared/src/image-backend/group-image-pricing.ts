/**
 * 图像模型固定价格与分组覆盖的共享契约。
 *
 * 使用方：系统设置、后端池分组管理、统一生图管线与管理后台。模块仅负责校验、
 * 规范化和继承合并，不读取数据库，也不执行扣费。
 */
import { z } from "zod";

export const IMAGE_CREDIT_PRICE_FIELDS = [
  "base1024Credits",
  "base1kCredits",
  "base2kCredits",
  "base4kCredits",
] as const;

export type ImageCreditPriceField = (typeof IMAGE_CREDIT_PRICE_FIELDS)[number];
export type ImageCreditPricing = Partial<
  Record<ImageCreditPriceField, number | undefined>
>;
export type ResolvedImageCreditPricing = Record<ImageCreditPriceField, number>;
export type ImageModelCreditPricingMap = Record<string, ImageCreditPricing>;

const imageCreditValueSchema = z.number().finite().positive().max(100_000);

export const imageCreditPricingSchema = z
  .object({
    base1024Credits: imageCreditValueSchema.optional(),
    base1kCredits: imageCreditValueSchema.optional(),
    base2kCredits: imageCreditValueSchema.optional(),
    base4kCredits: imageCreditValueSchema.optional(),
  })
  .strict();

export const imageModelCreditPricingMapSchema = z
  .record(
    z.string().trim().min(1).max(120),
    imageCreditPricingSchema.refine(
      (pricing) => IMAGE_CREDIT_PRICE_FIELDS.some((field) => pricing[field]),
      "At least one image credit price is required"
    )
  )
  .refine(
    (pricing) => Object.keys(pricing).length <= 200,
    "At most 200 image models can be configured"
  );

export const imageCreditOverridesSchema = z
  .object({
    version: z.literal(1),
    byModel: imageModelCreditPricingMapSchema,
  })
  .strict();

export type ImageCreditOverrides = z.infer<typeof imageCreditOverridesSchema>;

export const EMPTY_IMAGE_CREDIT_OVERRIDES: ImageCreditOverrides = {
  version: 1,
  byModel: {},
};

/**
 * 规范化用于计价匹配的模型标识。
 *
 * @param model - 请求模型或配置键。
 * @returns 小写模型标识；Firefly 前缀会被移除，空值返回 null。
 */
export function normalizeImagePricingModelId(
  model: string | null | undefined
): string | null {
  const normalized = model?.trim().toLowerCase();
  if (!normalized) return null;
  return normalized.startsWith("firefly-")
    ? normalized.slice("firefly-".length)
    : normalized;
}

/**
 * 将未知 JSON 收窄为可安全用于计费的版本化覆盖配置。
 *
 * @param value - 系统设置或分组 metadata 中的未知值。
 * @returns 合法配置；非法数据返回空配置，避免脏值参与扣费。
 */
export function parseImageCreditOverrides(
  value: unknown
): ImageCreditOverrides {
  const parsed = imageCreditOverridesSchema.safeParse(value);
  if (!parsed.success) return EMPTY_IMAGE_CREDIT_OVERRIDES;

  const byModel: ImageModelCreditPricingMap = {};
  for (const [model, pricing] of Object.entries(parsed.data.byModel)) {
    const normalizedModel = normalizeImagePricingModelId(model);
    if (normalizedModel) byModel[normalizedModel] = pricing;
  }
  return { version: 1, byModel };
}

/**
 * 在模型价格表中查找请求模型对应的最长前缀配置。
 *
 * @param model - 实际生图模型，可包含 Firefly、分辨率和宽高比后缀。
 * @param pricingByModel - 已规范化或来自持久层的模型价格表。
 * @returns 命中的稀疏四档价格；未配置时返回空对象。
 */
export function getImageModelCreditPricing(
  model: string | null | undefined,
  pricingByModel: ImageModelCreditPricingMap
): ImageCreditPricing {
  const normalizedModel = normalizeImagePricingModelId(model);
  if (!normalizedModel) return {};

  const matchingEntry = Object.entries(pricingByModel)
    .map(([key, pricing]) => ({
      key: normalizeImagePricingModelId(key),
      pricing,
    }))
    .filter((entry): entry is { key: string; pricing: ImageCreditPricing } =>
      Boolean(entry.key)
    )
    .sort((left, right) => right.key.length - left.key.length)
    .find(
      ({ key }) =>
        normalizedModel === key || normalizedModel.startsWith(`${key}-`)
    );
  return matchingEntry?.pricing ?? {};
}

/**
 * 合并通用价格、全局模型价格和分组模型覆盖。
 *
 * @param input.model - 实际生图模型。
 * @param input.fallback - 四档通用价格。
 * @param input.global - 全局模型价格配置。
 * @param input.group - 用户所选分组的稀疏覆盖配置。
 * @returns 完整四档价格，优先级为分组、全局模型、通用价格。
 */
export function resolveImageCreditPricing(input: {
  model: string | null | undefined;
  fallback: ResolvedImageCreditPricing;
  global?: ImageCreditOverrides | null;
  group?: ImageCreditOverrides | null;
}): ResolvedImageCreditPricing {
  const globalPricing = getImageModelCreditPricing(
    input.model,
    input.global?.byModel ?? {}
  );
  const groupPricing = getImageModelCreditPricing(
    input.model,
    input.group?.byModel ?? {}
  );
  return {
    base1024Credits:
      groupPricing.base1024Credits ??
      globalPricing.base1024Credits ??
      input.fallback.base1024Credits,
    base1kCredits:
      groupPricing.base1kCredits ??
      globalPricing.base1kCredits ??
      input.fallback.base1kCredits,
    base2kCredits:
      groupPricing.base2kCredits ??
      globalPricing.base2kCredits ??
      input.fallback.base2kCredits,
    base4kCredits:
      groupPricing.base4kCredits ??
      globalPricing.base4kCredits ??
      input.fallback.base4kCredits,
  };
}
