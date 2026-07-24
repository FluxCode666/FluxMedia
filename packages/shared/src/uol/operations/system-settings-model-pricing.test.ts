/**
 * 全局模型计费 UOL 操作测试。
 *
 * 使用方：Vitest；锁定完整价格 schema、超级管理员写权限和专用持久化入口，防止价格键
 * 再次误走会拒绝 dedicated setting 的通用系统设置写入函数。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_VIDEO_MODEL_CREDITS_PER_SECOND } from "../../adobe/video-pricing";
import { createDefaultGlobalImageCreditOverrides } from "../../image-backend/group-image-pricing";
import { assertAccess } from "../access";

const mocks = vi.hoisted(() => ({
  getRuntimeSettingJson: vi.fn<(key: string) => Promise<unknown>>(),
  setGlobalModelPricing: vi.fn(),
  setSystemSettings: vi.fn(),
}));

vi.mock("../../generation-maintenance", () => ({
  destroyGenerationPhotosByMaxCount: vi.fn(),
  shouldRunMaxCountCleanupOnSettingsChange: vi.fn(() => false),
}));
vi.mock("../../logger", () => ({ logError: vi.fn() }));
vi.mock("../../system-settings/bootstrap", () => ({
  bootstrapSystemSettingsEnv: vi.fn(),
}));
vi.mock("../../system-settings/env-file", () => ({
  syncSystemSettingsToEnvFiles: vi.fn(),
}));
vi.mock("../../system-settings/index", () => ({
  getAdminSystemSettingsSnapshot: vi.fn(),
  getRuntimeSettingJson: mocks.getRuntimeSettingJson,
  getSystemSettingValue: vi.fn(),
  importSystemSettingsFromEnv: vi.fn(),
  initializeMissingSystemSettingsDefaults: vi.fn(),
  setGlobalModelPricing: mocks.setGlobalModelPricing,
  setSystemSettings: mocks.setSystemSettings,
}));

import {
  settingsGetModelPricing,
  settingsUpdateModelPricing,
} from "./system-settings";

describe("全局模型计费 UOL", () => {
  beforeEach(() => {
    mocks.getRuntimeSettingJson.mockReset();
    mocks.setGlobalModelPricing.mockReset();
    mocks.setSystemSettings.mockReset();
    mocks.setGlobalModelPricing.mockResolvedValue(undefined);
  });

  it("只允许超级管理员写入完整的图像与视频价格", () => {
    expect(settingsUpdateModelPricing).toMatchObject({
      access: { kind: "superAdmin" },
      agentExposure: "human-only",
      readOnly: false,
      destructive: false,
      sideEffects: ["cache", "audit"],
    });
    expect(() =>
      assertAccess(settingsUpdateModelPricing.access, {
        type: "user",
        userId: "super-admin-1",
        role: "super_admin",
      })
    ).not.toThrow();
    expect(() =>
      assertAccess(settingsUpdateModelPricing.access, {
        type: "user",
        userId: "admin-1",
        role: "admin",
      })
    ).toThrow();
    expect(
      settingsUpdateModelPricing.input.safeParse({
        image: { version: 1, byModel: {} },
        videoCreditsPerSecond: {},
      }).success
    ).toBe(false);
  });

  it("保存时调用专用价格写入函数而不是通用设置写入", async () => {
    const image = createDefaultGlobalImageCreditOverrides();
    const input = {
      image,
      videoCreditsPerSecond: { ...DEFAULT_VIDEO_MODEL_CREDITS_PER_SECOND },
    };

    await expect(
      settingsUpdateModelPricing.execute(
        input,
        {
          type: "user",
          userId: "super-admin-1",
          role: "super_admin",
        },
        {
          requestId: "model-pricing-update",
          assertOwnership: vi.fn(),
        }
      )
    ).resolves.toEqual({ success: true });

    expect(mocks.setGlobalModelPricing).toHaveBeenCalledWith({
      ...input,
      updatedBy: "super-admin-1",
    });
    expect(mocks.setSystemSettings).not.toHaveBeenCalled();
  });

  it("历史脏值读取时返回完整开发默认值", async () => {
    mocks.getRuntimeSettingJson.mockResolvedValue({});

    await expect(
      settingsGetModelPricing.execute(
        {},
        { type: "user", userId: "admin-1", role: "admin" },
        {
          requestId: "model-pricing-read",
          assertOwnership: vi.fn(),
        }
      )
    ).resolves.toEqual({
      image: createDefaultGlobalImageCreditOverrides(),
      videoCreditsPerSecond: DEFAULT_VIDEO_MODEL_CREDITS_PER_SECOND,
    });
  });
});
