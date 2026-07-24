/**
 * 生图后端池 UOL 计费配置契约测试。
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_VIDEO_MODEL_CREDITS_PER_SECOND,
  globalVideoModelCreditsPerSecondSchema,
} from "../../adobe/video-pricing";
import {
  createDefaultGlobalImageCreditOverrides,
  globalImageCreditOverridesSchema,
} from "../../image-backend/group-image-pricing";

import { saveAdobe, saveApi, saveGroup } from "./image-backend-pool";

const validGroup = {
  name: "默认组",
  isEnabled: true,
  isDefault: true,
  isUserSelectable: true,
  contentSafety: "inherit" as const,
  backendType: "mixed" as const,
  minPlan: "free" as const,
  imageCreditOverrides: { version: 1 as const, byModel: {} },
  videoCreditOverrides: {},
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
        videoCreditOverrides: { sora2: 42 },
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
    expect(
      saveGroup.input.safeParse({
        ...validGroup,
        videoCreditOverrides: { sora2: 0 },
      }).success
    ).toBe(false);
  });

  it("全局图像固定价格与视频模型每秒积分使用不同契约", () => {
    expect(
      globalImageCreditOverridesSchema.safeParse(
        createDefaultGlobalImageCreditOverrides()
      ).success
    ).toBe(true);
    expect(
      globalVideoModelCreditsPerSecondSchema.safeParse(
        DEFAULT_VIDEO_MODEL_CREDITS_PER_SECOND
      ).success
    ).toBe(true);
    expect(
      globalImageCreditOverridesSchema.safeParse({
        version: 1,
        byModel: { "gpt-image-2": {} },
      }).success
    ).toBe(false);
    expect(
      globalVideoModelCreditsPerSecondSchema.safeParse({
        ...DEFAULT_VIDEO_MODEL_CREDITS_PER_SECOND,
        sora2: 0,
      }).success
    ).toBe(false);
    expect(
      globalVideoModelCreditsPerSecondSchema.safeParse({
        ...DEFAULT_VIDEO_MODEL_CREDITS_PER_SECOND,
        sora2: 100_001,
      }).success
    ).toBe(false);
  });

  it("不再将历史倍率作为分组或后端保存契约", () => {
    expect(
      Object.hasOwn(
        saveGroup.input.parse({ ...validGroup, videoBillingMultiplier: 2 }),
        "videoBillingMultiplier"
      )
    ).toBe(false);
    expect(
      Object.hasOwn(
        saveApi.input.parse({
          name: "API",
          baseUrl: "https://example.com",
          interfaceMode: "images",
          chatCompletionsUpstreamMode: "responses",
          imagesUpstreamMode: "images",
          parameterMappings: [],
          useStream: false,
          contentSafetyEnabled: true,
          isEnabled: true,
          alwaysActive: false,
          failureCooldownEnabled: false,
          priority: 0,
          concurrency: 1,
          adobeSourced: false,
          status: "active",
          billingMultiplier: 2,
        }),
        "billingMultiplier"
      )
    ).toBe(false);
    expect(
      Object.hasOwn(
        saveAdobe.input.parse({
          name: "Adobe",
          mode: "direct",
          baseUrl: "",
          defaultRatio: "1x1",
          defaultResolution: "2k",
          gptImageQuality: "high",
          supportsVideo: true,
          contentSafetyEnabled: true,
          isEnabled: true,
          alwaysActive: false,
          failureCooldownEnabled: false,
          priority: 0,
          concurrency: 1,
          status: "active",
          billingMultiplier: 2,
        }),
        "billingMultiplier"
      )
    ).toBe(false);
  });
});
