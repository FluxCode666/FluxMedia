/**
 * 本人可购买订阅套餐读服务。
 *
 * 使用方：subscription.listMyPurchasablePlans 的 app-level UOL binding。
 * 关键依赖：运行时支付配置、provider readiness 与当前有效套餐。服务只返回安全
 * presenter 数据，不创建订单、不冻结报价，也不缓存 provider 状态。
 */
import { getPricingPlansFromConfig } from "@repo/shared/config/payment";
import type { RuntimePaymentConfig } from "@repo/shared/config/payment-runtime";
import {
  compareSubscriptionPlans,
  type SubscriptionPlan,
} from "@repo/shared/config/subscription-plan";
import { getSubscriptionProviderCapability } from "@repo/shared/payment/provider-policy";
import type { Plan } from "@repo/shared/payment/types";
import {
  isSubscriptionPriceInterval,
  MAX_PURCHASABLE_PLAN_FEATURES,
  MAX_PURCHASABLE_PLAN_PRICES,
  MAX_PURCHASABLE_PLANS,
  PURCHASABLE_PLAN_IDS,
  type PurchasablePlanId,
  type SubscriptionCheckoutReason,
  type SubscriptionPurchaseOptions,
} from "@repo/shared/subscription/purchase-contract";
import type { UserPlanInfo } from "@repo/shared/subscription/services/user-plan";

export type {
  PurchasablePlanId,
  SubscriptionCheckoutReason,
  SubscriptionPurchaseOptions,
} from "@repo/shared/subscription/purchase-contract";

type RuntimeSubscriptionConfig = Pick<
  RuntimePaymentConfig,
  "provider" | "currency"
> & {
  plans: Plan[];
};

type CurrentPlanSnapshot = Pick<
  UserPlanInfo,
  "plan" | "hasActiveSubscription" | "priceId"
>;

/** 可替换依赖只用于 DB-free 单测，生产默认值始终读取运行时真相。 */
export type SubscriptionPurchaseOptionsDependencies = {
  getRuntimePaymentConfig: () => Promise<RuntimeSubscriptionConfig>;
  getCurrentPlan: (userId: string) => Promise<CurrentPlanSnapshot>;
  isCreemConfigured: () => Promise<boolean>;
  isEpayConfigured: () => Promise<boolean>;
};

/** 把运行时支付配置规范化为 presenter 所需的套餐数组。 */
async function loadRuntimeSubscriptionConfig(): Promise<RuntimeSubscriptionConfig> {
  const { getRuntimePaymentConfig } = await import(
    "@repo/shared/config/payment-runtime"
  );
  const config = await getRuntimePaymentConfig();
  return {
    provider: config.provider,
    currency: config.currency,
    plans: getPricingPlansFromConfig(config),
  };
}

/**
 * 检查 Creem 是否同时具备 checkout 与 webhook 配置。
 *
 * 缺少配置是业务关闭；系统设置读取异常继续上抛，让钱包显示“读取失败”。
 */
async function isRuntimeCreemConfigured(): Promise<boolean> {
  const {
    assertRuntimeCreemCheckoutConfigured,
    CreemCheckoutConfigurationError,
  } = await import("./creem");
  try {
    await assertRuntimeCreemCheckoutConfigured();
    return true;
  } catch (error) {
    if (error instanceof CreemCheckoutConfigurationError) {
      return false;
    }
    throw error;
  }
}

/** 延迟加载本人订阅服务，使纯资格单测不依赖数据库环境。 */
async function loadCurrentPlan(userId: string): Promise<CurrentPlanSnapshot> {
  const { getUserPlan } = await import(
    "@repo/shared/subscription/services/user-plan"
  );
  return getUserPlan(userId);
}

/** 延迟加载 Epay readiness，使纯资格单测不初始化订单数据库。 */
async function isRuntimeEpayReady(): Promise<boolean> {
  const { isRuntimeEpayConfigured } = await import("@repo/shared/payment/epay");
  return isRuntimeEpayConfigured();
}

const defaultDependencies: SubscriptionPurchaseOptionsDependencies = {
  getRuntimePaymentConfig: loadRuntimeSubscriptionConfig,
  getCurrentPlan: loadCurrentPlan,
  isCreemConfigured: isRuntimeCreemConfigured,
  isEpayConfigured: isRuntimeEpayReady,
};

/** 判断运行时 plan id 是否属于可结账付费套餐。 */
function isPurchasablePlanId(value: string): value is PurchasablePlanId {
  return PURCHASABLE_PLAN_IDS.some((planId) => planId === value);
}

/** 解析 provider 的订阅支持与 readiness；读取异常不在此吞掉。 */
async function resolveProviderReason(
  provider: RuntimeSubscriptionConfig["provider"],
  dependencies: SubscriptionPurchaseOptionsDependencies
): Promise<SubscriptionCheckoutReason | null> {
  const capability = getSubscriptionProviderCapability(provider);
  if (capability === "disabled") return "payment_disabled";
  if (capability === "unsupported") return "subscription_not_supported";
  const configured =
    provider === "creem"
      ? await dependencies.isCreemConfigured()
      : await dependencies.isEpayConfigured();
  return configured ? null : "provider_unavailable";
}

/** 将运行时价格过滤为 UOL 允许暴露的安全字段。 */
function normalizePrices(
  plan: Plan
): SubscriptionPurchaseOptions["plans"][number]["prices"] {
  const seenPriceIds = new Set<string>();
  const prices: SubscriptionPurchaseOptions["plans"][number]["prices"] = [];
  for (const price of plan.prices ?? []) {
    if (prices.length === MAX_PURCHASABLE_PLAN_PRICES) break;
    const priceId = price.priceId.trim();
    if (
      !priceId ||
      seenPriceIds.has(priceId) ||
      !Number.isFinite(price.amount) ||
      price.amount < 0 ||
      !isSubscriptionPriceInterval(price.interval)
    ) {
      continue;
    }
    seenPriceIds.add(priceId);
    prices.push({ priceId, amount: price.amount, interval: price.interval });
  }
  return prices;
}

/** 有界清洗套餐卖点，避免异常配置扩大钱包响应。 */
function normalizeFeatures(features: string[]): string[] {
  const normalized: string[] = [];
  for (const feature of features) {
    if (normalized.length === MAX_PURCHASABLE_PLAN_FEATURES) break;
    const value = feature.trim();
    if (value) normalized.push(value);
  }
  return normalized;
}

/** 根据 provider、价格和当前套餐给单张卡生成唯一资格原因。 */
function resolvePlanReason(input: {
  providerReason: SubscriptionCheckoutReason | null;
  provider: RuntimeSubscriptionConfig["provider"];
  hasConfiguredPrice: boolean;
  hasCheckoutPrice: boolean;
  currentPlan: SubscriptionPlan;
  hasActiveSubscription: boolean;
  currentInterval: "monthly" | "yearly" | null;
  targetPlan: PurchasablePlanId;
}): SubscriptionCheckoutReason {
  if (input.providerReason) return input.providerReason;
  if (!input.hasConfiguredPrice) return "no_price";
  if (!input.hasActiveSubscription) return "available";
  if (input.currentPlan === "free") return "current_subscription_unknown";
  const transition = compareSubscriptionPlans(
    input.currentPlan,
    input.targetPlan
  );
  if (transition !== "upgrade") return transition;
  if (!input.currentInterval) return "current_subscription_unknown";
  if (input.provider !== "epay") return "upgrade_not_supported";
  if (!input.hasCheckoutPrice) return "billing_interval_mismatch";
  return "available";
}

/** 从同一运行时价格快照解析当前订阅周期，避免展示 checkout 必然拒绝的升级。 */
function findCurrentInterval(
  plans: Plan[],
  priceId: string | null
): "monthly" | "yearly" | null {
  if (!priceId) return null;
  for (const plan of plans) {
    const currentPrice = normalizePrices(plan).find(
      (price) => price.priceId === priceId
    );
    if (currentPrice) return currentPrice.interval;
  }
  return null;
}

/**
 * 读取当前用户真正可发起结账的订阅套餐。
 *
 * @param userId 当前 session 用户 ID，只由 UOL Principal 提供。
 * @param dependencies 可替换测试依赖；生产不得传入客户端状态。
 * @returns 安全套餐卡与逐卡资格；enabled 仅在至少一张卡可结账时为 true。
 */
export async function loadSubscriptionPurchaseOptions(
  userId: string,
  dependencies: SubscriptionPurchaseOptionsDependencies = defaultDependencies
): Promise<SubscriptionPurchaseOptions> {
  const [runtime, current] = await Promise.all([
    dependencies.getRuntimePaymentConfig(),
    dependencies.getCurrentPlan(userId),
  ]);
  const providerReason = await resolveProviderReason(
    runtime.provider,
    dependencies
  );
  const currentInterval = current.hasActiveSubscription
    ? findCurrentInterval(runtime.plans, current.priceId)
    : null;
  const seenPlanIds = new Set<PurchasablePlanId>();
  const plans: SubscriptionPurchaseOptions["plans"] = [];
  for (const plan of runtime.plans) {
    if (plans.length === MAX_PURCHASABLE_PLANS) break;
    if (!isPurchasablePlanId(plan.id) || seenPlanIds.has(plan.id)) continue;
    seenPlanIds.add(plan.id);
    const configuredPrices = normalizePrices(plan);
    const isUpgrade =
      current.hasActiveSubscription &&
      compareSubscriptionPlans(current.plan, plan.id) === "upgrade";
    const prices =
      isUpgrade && runtime.provider === "epay" && currentInterval
        ? configuredPrices.filter((price) => price.interval === currentInterval)
        : configuredPrices;
    const checkoutReason = resolvePlanReason({
      providerReason,
      provider: runtime.provider,
      hasConfiguredPrice: configuredPrices.length > 0,
      hasCheckoutPrice: prices.length > 0,
      currentPlan: current.plan,
      hasActiveSubscription: current.hasActiveSubscription,
      currentInterval,
      targetPlan: plan.id,
    });
    plans.push({
      id: plan.id,
      name: plan.name.trim() || plan.id,
      description: plan.description.trim(),
      features: normalizeFeatures(plan.features),
      popular: Boolean(plan.popular),
      highlighted: Boolean(plan.highlighted),
      canCheckout: checkoutReason === "available",
      checkoutReason,
      prices,
    });
  }
  return {
    enabled: plans.some((plan) => plan.canCheckout),
    currentPlan: current.plan,
    currency: runtime.currency,
    plans,
  };
}
