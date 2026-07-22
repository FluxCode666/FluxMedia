/**
 * 生图固定档位运行时设置映射测试。
 *
 * 验证系统设置键不会在并行读取和结构化返回时串到错误的价格档位。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRuntimeSettingNumber:
    vi.fn<
      (
        key: string,
        fallback: number,
        options?: { positive?: boolean; nonNegative?: boolean }
      ) => Promise<number>
    >(),
  getRuntimeSettingJson: vi.fn<(key: string) => Promise<unknown>>(),
}));

vi.mock("@repo/shared/system-settings", () => ({
  getRuntimeSettingJson: mocks.getRuntimeSettingJson,
  getRuntimeSettingNumber: mocks.getRuntimeSettingNumber,
}));

import {
  getRuntimeImageBaseCreditPricing,
  getRuntimeImageCreditPricing,
} from "./pricing-settings";

describe("runtime image base credit pricing", () => {
  beforeEach(() => {
    mocks.getRuntimeSettingNumber.mockReset();
    mocks.getRuntimeSettingJson.mockReset();
  });

  it("maps every fixed-tier setting to the matching return field", async () => {
    const values: Record<string, number> = {
      IMAGE_BASE_CREDITS_1024: 2,
      IMAGE_BASE_CREDITS_1K: 3,
      IMAGE_BASE_CREDITS_2K: 8,
      IMAGE_BASE_CREDITS_4K: 20,
    };
    mocks.getRuntimeSettingNumber.mockImplementation(
      async (key, fallback) => values[key] ?? fallback
    );

    await expect(getRuntimeImageBaseCreditPricing()).resolves.toEqual({
      base1024Credits: 2,
      base1kCredits: 3,
      base2kCredits: 8,
      base4kCredits: 20,
    });
  });

  it("merges group and global model prices and keeps zero moderation fees", async () => {
    const values: Record<string, number> = {
      IMAGE_BASE_CREDITS_1024: 1,
      IMAGE_BASE_CREDITS_1K: 2,
      IMAGE_BASE_CREDITS_2K: 4,
      IMAGE_BASE_CREDITS_4K: 8,
      IMAGE_TEXT_MODERATION_CREDITS: 0,
      IMAGE_INPUT_MODERATION_CREDITS: 0,
    };
    mocks.getRuntimeSettingNumber.mockImplementation(
      async (key, fallback) => values[key] ?? fallback
    );
    mocks.getRuntimeSettingJson.mockResolvedValue({
      version: 1,
      byModel: { "gpt-image-2": { base2kCredits: 6 } },
    });

    await expect(
      getRuntimeImageCreditPricing("gpt-image-2", {
        version: 1,
        byModel: { "gpt-image-2": { base4kCredits: 7 } },
      })
    ).resolves.toEqual({
      basePricing: {
        base1024Credits: 1,
        base1kCredits: 2,
        base2kCredits: 6,
        base4kCredits: 7,
      },
      moderationPricing: {
        textModerationCredits: 0,
        imageModerationCredits: 0,
      },
    });
    expect(mocks.getRuntimeSettingNumber).toHaveBeenCalledWith(
      "IMAGE_TEXT_MODERATION_CREDITS",
      expect.any(Number),
      { nonNegative: true }
    );
    expect(mocks.getRuntimeSettingNumber).toHaveBeenCalledWith(
      "IMAGE_INPUT_MODERATION_CREDITS",
      expect.any(Number),
      { nonNegative: true }
    );
  });
});
