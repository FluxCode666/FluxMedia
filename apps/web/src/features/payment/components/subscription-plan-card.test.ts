/**
 * 订阅套餐卡价格选择的纯逻辑测试。
 *
 * 默认优先月付；无月付时保留服务端返回顺序，空价格不生成结账目标。
 */
import { describe, expect, it } from "vitest";

import { getInitialSubscriptionPriceId } from "./subscription-plan-card-logic";

describe("getInitialSubscriptionPriceId", () => {
  it("优先选择月付价格", () => {
    expect(
      getInitialSubscriptionPriceId([
        { priceId: "year", amount: 100, interval: "yearly" },
        { priceId: "month", amount: 10, interval: "monthly" },
      ])
    ).toBe("month");
  });

  it("没有月付时选择首个价格，空数组返回 null", () => {
    expect(
      getInitialSubscriptionPriceId([
        { priceId: "year", amount: 100, interval: "yearly" },
      ])
    ).toBe("year");
    expect(getInitialSubscriptionPriceId([])).toBeNull();
  });
});
