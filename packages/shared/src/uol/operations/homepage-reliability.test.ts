/**
 * 官网首页可靠性 UOL 操作测试。
 *
 * 使用方：Vitest；固定两个读取操作彼此独立的 system-only、human-only 元数据，验证
 * 严格输入输出、运行时设置读取与统计 late binding 的真实网关行为。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { invokeOperation } from "../invoke";
import type { Principal } from "../principal";
import { bindExecute } from "../registry";

const mocks = vi.hoisted(() => ({
  getRuntimeSettingBoolean: vi.fn(),
}));

vi.mock("../../system-settings/index", () => ({
  getRuntimeSettingBoolean: mocks.getRuntimeSettingBoolean,
}));

import {
  getHomepageGenerationSlaStats,
  getHomepageSlaVisibility,
  homepageGenerationSlaStatsOutputSchema,
  homepageSlaVisibilityOutputSchema,
} from "./homepage-reliability";

const systemPrincipal = {
  type: "system",
  reason: "homepage-reliability-test",
} satisfies Principal;

const userPrincipal = {
  type: "user",
  userId: "user-1",
  role: "admin",
} satisfies Principal;

const readyStats = {
  sampleSize: 100,
  completed: 96,
  failed: 4,
  successRate: 0.96,
  platformErrors: 4,
  moderationErrors: 0,
  userRequestErrors: 0,
};

describe("homepage reliability operations", () => {
  beforeEach(() => {
    mocks.getRuntimeSettingBoolean.mockReset();
    mocks.getRuntimeSettingBoolean.mockResolvedValue(true);
  });

  it("把可见性与统计声明为彼此独立的 system-only 人工只读操作", () => {
    expect(getHomepageSlaVisibility).toMatchObject({
      name: "settings.getHomepageSlaVisibility",
      domain: "system-settings",
      access: { kind: "system" },
      agentExposure: "human-only",
      readOnly: true,
      destructive: false,
      idempotency: { kind: "natural" },
      sideEffects: [],
    });
    expect(getHomepageGenerationSlaStats).toMatchObject({
      name: "analytics.getHomepageGenerationSlaStats",
      domain: "analytics",
      access: { kind: "system" },
      agentExposure: "human-only",
      readOnly: true,
      destructive: false,
      idempotency: { kind: "natural" },
      sideEffects: [],
    });
    expect(
      getHomepageSlaVisibility.input.safeParse({ injected: true }).success
    ).toBe(false);
    expect(
      getHomepageGenerationSlaStats.input.safeParse({ limit: 10 }).success
    ).toBe(false);
  });

  it("可见性 operation 使用固定键和默认值并返回最小 DTO", async () => {
    const result = await getHomepageSlaVisibility.execute({}, systemPrincipal, {
      requestId: "visibility-request",
      assertOwnership: vi.fn(),
    });

    expect(mocks.getRuntimeSettingBoolean).toHaveBeenCalledWith(
      "MARKETING_SLA_STATUS_ENABLED",
      true
    );
    expect(result).toEqual({ enabled: true });
    expect(homepageSlaVisibilityOutputSchema.parse(result)).toEqual(result);
  });

  it("真实网关允许 system 分别读取并拒绝真实用户绕过内部边界", async () => {
    bindExecute(
      "analytics.getHomepageGenerationSlaStats",
      async (_input, _principal, _ctx) => readyStats
    );

    await expect(
      invokeOperation("settings.getHomepageSlaVisibility", {}, systemPrincipal)
    ).resolves.toEqual({ enabled: true });
    await expect(
      invokeOperation(
        "analytics.getHomepageGenerationSlaStats",
        {},
        systemPrincipal
      )
    ).resolves.toEqual(readyStats);
    await expect(
      invokeOperation("settings.getHomepageSlaVisibility", {}, userPrincipal)
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      invokeOperation(
        "analytics.getHomepageGenerationSlaStats",
        {},
        userPrincipal
      )
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("homepage reliability output schemas", () => {
  it("严格拒绝额外字段、非法比例和非整数计数", () => {
    expect(() =>
      homepageSlaVisibilityOutputSchema.parse({
        enabled: true,
        internalSetting: "canary",
      })
    ).toThrow();
    expect(() =>
      homepageGenerationSlaStatsOutputSchema.parse({
        ...readyStats,
        successRate: 1.01,
      })
    ).toThrow();
    expect(() =>
      homepageGenerationSlaStatsOutputSchema.parse({
        ...readyStats,
        sampleSize: 1.5,
      })
    ).toThrow();
    expect(() =>
      homepageGenerationSlaStatsOutputSchema.parse({
        ...readyStats,
        rawRows: ["canary"],
      })
    ).toThrow();
  });
});
