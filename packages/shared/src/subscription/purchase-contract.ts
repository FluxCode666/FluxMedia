/**
 * 钱包订阅购买能力的传输无关契约。
 *
 * 使用方：subscription UOL operation、Web 购买能力服务与钱包页面。
 * 只描述可公开的套餐展示字段和稳定资格原因，不包含支付密钥或内部配置。
 */
import { z } from "zod";

export const PURCHASABLE_PLAN_IDS = [
  "starter",
  "pro",
  "ultra",
  "enterprise",
] as const;
export const MAX_PURCHASABLE_PLANS = PURCHASABLE_PLAN_IDS.length;
export const MAX_PURCHASABLE_PLAN_PRICES = 2;
export const MAX_PURCHASABLE_PLAN_FEATURES = 32;
export const SUBSCRIPTION_PRICE_INTERVALS = ["monthly", "yearly"] as const;

export const SUBSCRIPTION_CHECKOUT_REASONS = [
  "available",
  "current_plan",
  "downgrade",
  "payment_disabled",
  "subscription_not_supported",
  "provider_unavailable",
  "upgrade_not_supported",
  "billing_interval_mismatch",
  "current_subscription_unknown",
  "no_price",
] as const;

const purchasablePlanSchema = z.object({
  id: z.enum(PURCHASABLE_PLAN_IDS),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500),
  features: z
    .array(z.string().trim().min(1).max(240))
    .max(MAX_PURCHASABLE_PLAN_FEATURES),
  popular: z.boolean(),
  highlighted: z.boolean(),
  canCheckout: z.boolean(),
  checkoutReason: z.enum(SUBSCRIPTION_CHECKOUT_REASONS),
  prices: z
    .array(
      z.object({
        priceId: z.string().trim().min(1).max(512),
        amount: z.number().finite().nonnegative(),
        interval: z.enum(SUBSCRIPTION_PRICE_INTERVALS),
      })
    )
    .max(MAX_PURCHASABLE_PLAN_PRICES),
});

const purchasablePlansBaseSchema = z.object({
  enabled: z.boolean(),
  currentPlan: z.enum(["free", ...PURCHASABLE_PLAN_IDS]),
  currency: z.string().trim().min(1).max(12),
  plans: z.array(purchasablePlanSchema).max(MAX_PURCHASABLE_PLANS),
});

type PurchasablePlansBase = z.infer<typeof purchasablePlansBaseSchema>;

/** 防止 enabled、canCheckout 与原因码在跨层传输时形成矛盾状态。 */
function validatePurchaseStateConsistency(
  output: PurchasablePlansBase,
  context: z.RefinementCtx
): void {
  output.plans.forEach((plan, index) => {
    if (plan.canCheckout !== (plan.checkoutReason === "available")) {
      context.addIssue({
        code: "custom",
        message: "canCheckout 与 checkoutReason 不一致",
        path: ["plans", index, "canCheckout"],
      });
    }
  });
  if (output.enabled !== output.plans.some((plan) => plan.canCheckout)) {
    context.addIssue({
      code: "custom",
      message: "enabled 与套餐可结账状态不一致",
      path: ["enabled"],
    });
  }
}

export const purchasablePlansOutputSchema =
  purchasablePlansBaseSchema.superRefine(validatePurchaseStateConsistency);

export type PurchasablePlanId = (typeof PURCHASABLE_PLAN_IDS)[number];
export type SubscriptionPriceInterval =
  (typeof SUBSCRIPTION_PRICE_INTERVALS)[number];
export type SubscriptionCheckoutReason =
  (typeof SUBSCRIPTION_CHECKOUT_REASONS)[number];
export type SubscriptionPurchaseOptions = z.infer<
  typeof purchasablePlansOutputSchema
>;

/** 判断运行时价格周期是否属于钱包允许公开的周期。 */
export function isSubscriptionPriceInterval(
  value: unknown
): value is SubscriptionPriceInterval {
  return SUBSCRIPTION_PRICE_INTERVALS.some((interval) => interval === value);
}
