/**
 * 审核策略契约的 DB-free 单元测试。
 *
 * 职责：验证全站默认与管理员用户覆盖的归一、优先级和 `high` 回退语义。
 * 使用方：审核策略 service 与图像生成管线改造前的纯函数回归门。
 * 关键依赖：Vitest、policy-contract.ts；不得导入数据库或运行时设置。
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_MODERATION_BLOCK_RISK_LEVEL,
  MODERATION_BLOCK_RISK_LEVELS,
  moderationBlockRiskLevelSchema,
  resolveModerationPolicyValues,
} from "./policy-contract";

describe("moderation policy contract", () => {
  it("defines the three supported levels with high as the fallback", () => {
    expect(MODERATION_BLOCK_RISK_LEVELS).toEqual(["low", "medium", "high"]);
    expect(DEFAULT_MODERATION_BLOCK_RISK_LEVEL).toBe("high");
    expect(moderationBlockRiskLevelSchema.safeParse("medium").success).toBe(
      true
    );
    expect(moderationBlockRiskLevelSchema.safeParse("critical").success).toBe(
      false
    );
  });
});

describe("resolveModerationPolicyValues", () => {
  it("prefers a valid user override", () => {
    expect(
      resolveModerationPolicyValues({
        globalDefault: "low",
        userOverride: "medium",
      })
    ).toEqual({
      globalDefault: "low",
      userOverride: "medium",
      effectiveLevel: "medium",
      source: "user_override",
    });
  });

  it.each([
    null,
    undefined,
  ])("inherits a valid global value when the override is %s", (userOverride) => {
    expect(
      resolveModerationPolicyValues({
        globalDefault: "medium",
        userOverride,
      })
    ).toEqual({
      globalDefault: "medium",
      userOverride: null,
      effectiveLevel: "medium",
      source: "global",
    });
  });

  it.each([
    "",
    "critical",
    1,
    {},
  ])("treats an invalid override as absent: %j", (userOverride) => {
    expect(
      resolveModerationPolicyValues({
        globalDefault: "low",
        userOverride,
      })
    ).toEqual({
      globalDefault: "low",
      userOverride: null,
      effectiveLevel: "low",
      source: "global",
    });
  });

  it("keeps a valid global high value sourced from global policy", () => {
    expect(
      resolveModerationPolicyValues({
        globalDefault: "high",
        userOverride: null,
      })
    ).toEqual({
      globalDefault: "high",
      userOverride: null,
      effectiveLevel: "high",
      source: "global",
    });
  });

  it.each([
    null,
    undefined,
    "",
    "critical",
    1,
    {},
  ])("falls back to high when the global value is missing or invalid: %j", (globalDefault) => {
    expect(
      resolveModerationPolicyValues({
        globalDefault,
        userOverride: null,
      })
    ).toEqual({
      globalDefault: "high",
      userOverride: null,
      effectiveLevel: "high",
      source: "fallback_high",
    });
  });

  it("keeps a valid override when the global value falls back", () => {
    expect(
      resolveModerationPolicyValues({
        globalDefault: "invalid",
        userOverride: "low",
      })
    ).toEqual({
      globalDefault: "high",
      userOverride: "low",
      effectiveLevel: "low",
      source: "user_override",
    });
  });
});
