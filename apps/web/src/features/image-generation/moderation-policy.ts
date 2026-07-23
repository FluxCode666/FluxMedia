/**
 * 单一图像管线的审核策略上下文。
 *
 * 职责：按可信 userId 只解析一次管理员审核策略，并把生效档位封装进后续审核调用。
 * 使用方：operations.ts 的生成、编辑、Chat 与 Agent 共用管线。
 * 关键依赖：shared moderation policy service 与 moderateContent；不捕获或降级解析错误。
 */
import {
  moderateContent,
  type ModerateContentInput,
  type ModerationResult,
} from "@repo/shared/moderation";
import type { ResolvedModerationPolicyValues } from "@repo/shared/moderation/policy-contract";
import { resolveEffectiveModerationPolicy } from "@repo/shared/moderation/policy-service";

/** 已由上下文注入可信生效档位的审核业务输入。 */
export type GenerationModerationInput = Omit<
  ModerateContentInput,
  "effectiveBlockRiskLevel"
>;

/** 策略解析与审核调用的最小依赖端口。 */
export interface GenerationModerationDependencies {
  resolvePolicy: (
    userId: string
  ) => Promise<ResolvedModerationPolicyValues>;
  moderate: (input: ModerateContentInput) => Promise<ModerationResult>;
}

/** 单次生成请求复用的审核上下文。 */
export interface GenerationModerationContext {
  policy: ResolvedModerationPolicyValues;
  moderate: (input: GenerationModerationInput) => Promise<ModerationResult>;
}

const defaultDependencies: GenerationModerationDependencies = {
  resolvePolicy: resolveEffectiveModerationPolicy,
  moderate: moderateContent,
};

/**
 * 解析一次用户策略并创建只接受业务内容的审核调用器。
 *
 * @param userId - 已由会话或 API Key 鉴权得到的可信用户 ID。
 * @param dependencies - 生产 resolver/审核器，测试可注入 DB-free 实现。
 * @returns 本次请求的策略快照与绑定可信档位的审核函数。
 * @throws resolver 的数据库或契约错误原样上抛，且不会调用审核 provider。
 */
export async function createGenerationModerationContext(
  userId: string,
  dependencies: GenerationModerationDependencies = defaultDependencies
): Promise<GenerationModerationContext> {
  const policy = await dependencies.resolvePolicy(userId);
  return {
    policy,
    moderate: (input) =>
      dependencies.moderate({
        ...input,
        effectiveBlockRiskLevel: policy.effectiveLevel,
      }),
  };
}
