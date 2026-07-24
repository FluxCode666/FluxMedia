/**
 * 图像模型固定价格与分组覆盖契约测试。
 */
import { describe, expect, it } from "vitest";

import {
  createDefaultGlobalImageCreditOverrides,
  getGroupImageCreditOverrides,
  getImageModelCreditPricing,
  imageCreditOverridesSchema,
  parseImageCreditOverrides,
  resolveImageCreditPricing,
} from "./group-image-pricing";

describe("group image pricing", () => {
  it("按分组、全局模型的顺序逐档继承", () => {
    expect(
      resolveImageCreditPricing({
        model: "firefly-nano-banana-pro-2k-1x1",
        global: {
          version: 1,
          byModel: {
            "nano-banana-pro": {
              base1024Credits: 1,
              base1kCredits: 3,
              base2kCredits: 6,
              base4kCredits: 8,
            },
          },
        },
        group: {
          version: 1,
          byModel: { "nano-banana-pro": { base2kCredits: 5 } },
        },
      })
    ).toEqual({
      base1024Credits: 1,
      base1kCredits: 3,
      base2kCredits: 5,
      base4kCredits: 8,
    });
  });

  it("模型匹配忽略大小写和 Firefly 前缀并优先最长前缀", () => {
    expect(
      getImageModelCreditPricing("FIREFLY-NANO-BANANA-PRO-4K-1X1", {
        "nano-banana": { base4kCredits: 7 },
        "Firefly-Nano-Banana-Pro": { base4kCredits: 9 },
      })
    ).toEqual({ base4kCredits: 9 });
  });

  it("允许未预置模型使用固定价格", () => {
    expect(
      getImageModelCreditPricing("custom-image-v3", {
        "custom-image-v3": { base1024Credits: 2.5 },
      })
    ).toEqual({ base1024Credits: 2.5 });
  });

  it("自定义 API 模型按分组覆盖、全局默认价格逐档继承", () => {
    const global = createDefaultGlobalImageCreditOverrides();
    global.byModel.default = {
      base1024Credits: 2,
      base1kCredits: 3,
      base2kCredits: 6,
      base4kCredits: 11,
    };

    expect(
      resolveImageCreditPricing({
        model: "vendor-custom-image-v3",
        global,
        group: {
          version: 1,
          byModel: {
            "vendor-custom-image-v3": { base2kCredits: 4.5 },
          },
        },
      })
    ).toEqual({
      base1024Credits: 2,
      base1kCredits: 3,
      base2kCredits: 4.5,
      base4kCredits: 11,
    });
  });

  it("拒绝零、负数、超大价格和空模型配置", () => {
    for (const pricing of [
      { base1024Credits: 0 },
      { base1kCredits: -1 },
      { base2kCredits: 100_001 },
      {},
    ]) {
      expect(
        imageCreditOverridesSchema.safeParse({
          version: 1,
          byModel: { "gpt-image-2": pricing },
        }).success
      ).toBe(false);
    }
  });

  it("非法持久化值安全回退为空配置", () => {
    expect(
      parseImageCreditOverrides({ version: 1, byModel: { bad: {} } })
    ).toEqual({ version: 1, byModel: {} });
  });

  it("从分组 metadata 读取版本化覆盖", () => {
    expect(
      getGroupImageCreditOverrides({
        imageCreditOverrides: {
          version: 1,
          byModel: { "GPT-IMAGE-2": { base1kCredits: 3 } },
        },
      })
    ).toEqual({
      version: 1,
      byModel: { "gpt-image-2": { base1kCredits: 3 } },
    });
  });
});
