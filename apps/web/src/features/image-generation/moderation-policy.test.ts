/**
 * 单一图像管线的审核策略上下文测试。
 *
 * 职责：验证 resolver 只解析一次、三种权威来源的生效档位精确透传，以及解析失败
 * 时不触发审核调用。使用方：operations.ts 的生成、编辑、Chat 与 Agent 共用入口。
 * 关键依赖：Vitest；依赖均注入，测试不连接数据库或审核 provider。
 */
import type { ModerateContentInput } from "@repo/shared/moderation";
import type { ResolvedModerationPolicyValues } from "@repo/shared/moderation/policy-contract";
import { describe, expect, it, vi } from "vitest";

import { createGenerationModerationContext } from "./moderation-policy";

vi.mock("@repo/shared/moderation", () => ({
  moderateContent: vi.fn(),
}));
vi.mock("@repo/shared/moderation/policy-service", () => ({
  resolveEffectiveModerationPolicy: vi.fn(),
}));

const policies = [
  {
    globalDefault: "low",
    userOverride: null,
    effectiveLevel: "low",
    source: "global",
  },
  {
    globalDefault: "low",
    userOverride: "medium",
    effectiveLevel: "medium",
    source: "user_override",
  },
  {
    globalDefault: "high",
    userOverride: null,
    effectiveLevel: "high",
    source: "fallback_high",
  },
] as const satisfies readonly ResolvedModerationPolicyValues[];

describe("createGenerationModerationContext", () => {
  it.each(policies)(
    "passes $source effective level to moderation without rewriting it",
    async (policy) => {
      const resolvePolicy = vi.fn(async () => policy);
      const moderate = vi.fn(
        async (_input: ModerateContentInput) =>
          ({ decision: "allow" }) as const
      );
      const context = await createGenerationModerationContext("user-1", {
        resolvePolicy,
        moderate,
      });

      await expect(
        context.moderate({
          prompt: "hello",
          mode: "text",
          userId: "user-1",
          generationId: "generation-1",
        })
      ).resolves.toEqual({ decision: "allow" });

      expect(context.policy).toEqual(policy);
      expect(resolvePolicy).toHaveBeenCalledOnce();
      expect(resolvePolicy).toHaveBeenCalledWith("user-1");
      expect(moderate).toHaveBeenCalledWith({
        prompt: "hello",
        mode: "text",
        userId: "user-1",
        generationId: "generation-1",
        effectiveBlockRiskLevel: policy.effectiveLevel,
      });
    }
  );

  it("propagates resolver errors without calling moderation", async () => {
    const resolverError = new Error("policy database unavailable");
    const resolvePolicy = vi.fn(async () => {
      throw resolverError;
    });
    const moderate = vi.fn();

    await expect(
      createGenerationModerationContext("user-1", {
        resolvePolicy,
        moderate,
      })
    ).rejects.toBe(resolverError);
    expect(resolvePolicy).toHaveBeenCalledOnce();
    expect(moderate).not.toHaveBeenCalled();
  });
});
