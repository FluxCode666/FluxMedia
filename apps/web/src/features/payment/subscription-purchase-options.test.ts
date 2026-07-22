/**
 * 订阅购买能力测试。
 *
 * 锁定 provider 支持/配置完整性与当前、同级、升级、顶级套餐资格的一致口径。
 */
import { describe, expect, it, vi } from "vitest";

import { loadSubscriptionPurchaseOptions } from "./subscription-purchase-options";

const PLANS = ["starter", "pro", "ultra", "enterprise"].map((id, index) => ({
  id,
  name: id,
  description: `${id} plan`,
  features: [`feature-${id}`],
  cta: "Subscribe",
  popular: id === "pro",
  highlighted: false,
  prices: [
    {
      type: "subscription" as const,
      priceId: `${id}_monthly`,
      amount: (index + 1) * 20,
      interval: "monthly" as const,
    },
  ],
}));

/** 创建可切换 provider 和当前套餐的依赖。 */
function createDependencies(
  provider: "creem" | "epay" | "alipay_f2f" | "none",
  currentPlan: "free" | "starter" | "pro" | "ultra" | "enterprise" = "free"
) {
  return {
    getRuntimePaymentConfig: vi.fn().mockResolvedValue({
      provider,
      currency: "CNY",
      plans: PLANS,
    }),
    getCurrentPlan: vi.fn().mockResolvedValue({
      plan: currentPlan,
      hasActiveSubscription: currentPlan !== "free",
      priceId: currentPlan === "free" ? null : `${currentPlan}_monthly`,
    }),
    isCreemConfigured: vi.fn().mockResolvedValue(true),
    isEpayConfigured: vi.fn().mockResolvedValue(true),
  };
}

describe("loadSubscriptionPurchaseOptions", () => {
  it.each([
    ["creem", true],
    ["epay", true],
    ["alipay_f2f", false],
    ["none", false],
  ] as const)("provider=%s 的订阅能力为 %s", async (provider, enabled) => {
    const result = await loadSubscriptionPurchaseOptions(
      "user-1",
      createDependencies(provider)
    );
    expect(result.enabled).toBe(enabled);
  });

  it("配置不完整时关闭能力并返回稳定原因", async () => {
    const deps = createDependencies("creem");
    deps.isCreemConfigured.mockResolvedValue(false);

    const result = await loadSubscriptionPurchaseOptions("user-1", deps);

    expect(result.enabled).toBe(false);
    expect(result.plans.every((plan) => plan.canCheckout === false)).toBe(true);
    expect(result.plans[0]?.checkoutReason).toBe("provider_unavailable");
  });

  it("provider 配置读取异常继续上抛，不伪装为主动关闭", async () => {
    const deps = createDependencies("creem");
    deps.isCreemConfigured.mockRejectedValue(
      new Error("settings database unavailable")
    );

    await expect(
      loadSubscriptionPurchaseOptions("user-1", deps)
    ).rejects.toThrow("settings database unavailable");
  });

  it("Epay 当前 Pro 只能按相同周期升级，顶级套餐没有可结账项", async () => {
    const pro = await loadSubscriptionPurchaseOptions(
      "user-1",
      createDependencies("epay", "pro")
    );
    expect(
      pro.plans.map(({ id, canCheckout, checkoutReason }) => [
        id,
        canCheckout,
        checkoutReason,
      ])
    ).toEqual([
      ["starter", false, "downgrade"],
      ["pro", false, "current_plan"],
      ["ultra", true, "available"],
      ["enterprise", true, "available"],
    ]);

    const enterprise = await loadSubscriptionPurchaseOptions(
      "user-1",
      createDependencies("epay", "enterprise")
    );
    expect(enterprise.enabled).toBe(false);
  });

  it("Creem 已有订阅时不展示现有 checkout 必然拒绝的升级", async () => {
    const result = await loadSubscriptionPurchaseOptions(
      "user-1",
      createDependencies("creem", "pro")
    );

    expect(result.enabled).toBe(false);
    expect(result.plans.find((plan) => plan.id === "ultra")).toMatchObject({
      canCheckout: false,
      checkoutReason: "upgrade_not_supported",
    });
  });

  it("Epay 升级仅返回与当前订阅相同的计费周期", async () => {
    const deps = createDependencies("epay", "pro");
    deps.getRuntimePaymentConfig.mockResolvedValue({
      provider: "epay",
      currency: "CNY",
      plans: PLANS.map((plan) => ({
        ...plan,
        prices: [
          ...plan.prices,
          {
            type: "subscription" as const,
            priceId: `${plan.id}_yearly`,
            amount: (plan.prices[0]?.amount ?? 0) * 8,
            interval: "yearly" as const,
          },
        ],
      })),
    });

    const result = await loadSubscriptionPurchaseOptions("user-1", deps);

    expect(result.plans.find((plan) => plan.id === "ultra")?.prices).toEqual([
      {
        priceId: "ultra_monthly",
        amount: 60,
        interval: "monthly",
      },
    ]);
  });

  it("当前订阅 priceId 无法从运行时配置识别时关闭升级", async () => {
    const deps = createDependencies("epay", "pro");
    deps.getCurrentPlan.mockResolvedValue({
      plan: "free",
      hasActiveSubscription: true,
      priceId: "legacy_unknown",
    });

    const result = await loadSubscriptionPurchaseOptions("user-1", deps);

    expect(result.enabled).toBe(false);
    expect(result.plans[0]?.checkoutReason).toBe(
      "current_subscription_unknown"
    );
  });

  it("每次读取重新解析 provider，避免使用过期页面快照", async () => {
    const deps = createDependencies("creem");
    deps.getRuntimePaymentConfig
      .mockResolvedValueOnce({
        provider: "creem",
        currency: "CNY",
        plans: PLANS,
      })
      .mockResolvedValueOnce({
        provider: "none",
        currency: "CNY",
        plans: PLANS,
      });

    await expect(
      loadSubscriptionPurchaseOptions("user-1", deps)
    ).resolves.toMatchObject({ enabled: true });
    await expect(
      loadSubscriptionPurchaseOptions("user-1", deps)
    ).resolves.toMatchObject({ enabled: false });
  });
});
