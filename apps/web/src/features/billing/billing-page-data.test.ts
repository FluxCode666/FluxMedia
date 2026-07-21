/**
 * 账单与用量页服务端数据选择测试。
 *
 * 验证 URL 页签回退，以及隐藏 Usage 内容不会产生价格数据查询。
 */

import { describe, expect, it, vi } from "vitest";
import { loadBillingPageData, resolveBillingTab } from "./billing-page-data";
import type { ImagePricingCardData } from "./image-pricing-card-data";

const PRICING_CARD_DATA: ImagePricingCardData = {
  billing: {
    agentRoundCredits: 1,
    chatRoundCredits: 1,
    groupMultiplier: 1,
    groupName: null,
    moderationBlockingEnabled: false,
    monthlyCredits: 100,
    planName: "Free",
  },
  pricing: {
    base1024Credits: 1,
    base4kCredits: 4,
  },
};

describe("billing page data", () => {
  it("falls back invalid tab values to billing", () => {
    expect(resolveBillingTab(undefined)).toBe("billing");
    expect(resolveBillingTab("unknown")).toBe("billing");
    expect(resolveBillingTab("usage")).toBe("usage");
  });

  it("does not load pricing data for the default billing tab", async () => {
    const loadPricingCardData = vi.fn().mockResolvedValue(PRICING_CARD_DATA);

    await expect(
      loadBillingPageData(undefined, "user-1", loadPricingCardData)
    ).resolves.toEqual({ activeTab: "billing", pricingCardData: null });
    expect(loadPricingCardData).not.toHaveBeenCalled();
  });

  it("loads pricing data exactly once for the usage tab", async () => {
    const loadPricingCardData = vi.fn().mockResolvedValue(PRICING_CARD_DATA);

    await expect(
      loadBillingPageData("usage", "user-1", loadPricingCardData)
    ).resolves.toEqual({
      activeTab: "usage",
      pricingCardData: PRICING_CARD_DATA,
    });
    expect(loadPricingCardData).toHaveBeenCalledOnce();
    expect(loadPricingCardData).toHaveBeenCalledWith("user-1");
  });
});
