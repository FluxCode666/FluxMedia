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
        options?: { positive?: boolean }
      ) => Promise<number>
    >(),
}));

vi.mock("@repo/shared/system-settings", () => ({
  getRuntimeSettingNumber: mocks.getRuntimeSettingNumber,
}));

import { getRuntimeImageBaseCreditPricing } from "./pricing-settings";

describe("runtime image base credit pricing", () => {
  beforeEach(() => {
    mocks.getRuntimeSettingNumber.mockReset();
  });

  it("maps every fixed-tier setting to the matching return field", async () => {
    const values: Record<string, number> = {
      IMAGE_BASE_CREDITS_1024: 2,
      IMAGE_BASE_CREDITS_2K: 8,
      IMAGE_BASE_CREDITS_4K: 20,
    };
    mocks.getRuntimeSettingNumber.mockImplementation(
      async (key, fallback) => values[key] ?? fallback
    );

    await expect(getRuntimeImageBaseCreditPricing()).resolves.toEqual({
      base1024Credits: 2,
      base2kCredits: 8,
      base4kCredits: 20,
    });
  });
});
