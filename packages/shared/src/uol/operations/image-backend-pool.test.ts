/**
 * 生图后端池 UOL 计费配置契约测试。
 */
import { describe, expect, it } from "vitest";

import { saveGroup, updateImagePricingConfig } from "./image-backend-pool";

const validGroup = {
  name: "默认组",
  isEnabled: true,
  isDefault: true,
  isUserSelectable: true,
  contentSafety: "inherit" as const,
  backendType: "mixed" as const,
  minPlan: "free" as const,
  videoBillingMultiplier: 1,
  imageCreditOverrides: { version: 1 as const, byModel: {} },
  childGroupIds: [],
  priority: 50,
};

describe("image backend pool pricing operations", () => {
  it("pool.saveGroup 接受真实分组字段和稀疏图像价格覆盖", () => {
    expect(
      saveGroup.input.safeParse({
        ...validGroup,
        imageCreditOverrides: {
          version: 1,
          byModel: { "custom-image-v3": { base2kCredits: 6 } },
        },
      }).success
    ).toBe(true);
  });

  it("pool.saveGroup 拒绝非法价格并允许空覆盖继承全局", () => {
    expect(saveGroup.input.safeParse(validGroup).success).toBe(true);
    expect(
      saveGroup.input.safeParse({
        ...validGroup,
        imageCreditOverrides: {
          version: 1,
          byModel: { "gpt-image-2": { base1024Credits: 0 } },
        },
      }).success
    ).toBe(false);
  });

  it("全局图像固定价格与视频倍率使用不同契约", () => {
    expect(
      updateImagePricingConfig.input.safeParse({
        image: {
          version: 1,
          byModel: { "gpt-image-2": { base4kCredits: 10 } },
        },
        video: { "sora2-pro": 2 },
      }).success
    ).toBe(true);
    expect(
      updateImagePricingConfig.input.safeParse({
        image: { version: 1, byModel: { "gpt-image-2": {} } },
        video: { "sora2-pro": 2 },
      }).success
    ).toBe(false);
  });
});
