/** 订阅购买能力契约测试：锁定有界输出与冗余状态一致性。 */
import { describe, expect, it } from "vitest";

import { purchasablePlansOutputSchema } from "./purchase-contract";

const AVAILABLE_PLAN = {
  id: "starter" as const,
  name: "Starter",
  description: "Starter plan",
  features: ["Feature"],
  popular: false,
  highlighted: false,
  canCheckout: true,
  checkoutReason: "available" as const,
  prices: [
    {
      priceId: "starter_monthly",
      amount: 20,
      interval: "monthly" as const,
    },
  ],
};

describe("purchasablePlansOutputSchema", () => {
  it("接受 enabled 与套餐资格一致的安全输出", () => {
    expect(
      purchasablePlansOutputSchema.parse({
        enabled: true,
        currentPlan: "free",
        currency: "CNY",
        plans: [AVAILABLE_PLAN],
      })
    ).toMatchObject({ enabled: true });
  });

  it("拒绝 canCheckout、原因码或 enabled 互相矛盾", () => {
    expect(() =>
      purchasablePlansOutputSchema.parse({
        enabled: false,
        currentPlan: "free",
        currency: "CNY",
        plans: [
          {
            ...AVAILABLE_PLAN,
            checkoutReason: "payment_disabled",
          },
        ],
      })
    ).toThrow();
  });
});
