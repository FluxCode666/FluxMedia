/**
 * 内容审核级别的传输无关策略契约。
 *
 * 职责：集中定义允许的审核级别、`high` 明确回退，以及全站默认与管理员
 * 用户覆盖之间的纯函数解析规则。
 * 使用方：审核策略 service、UOL operation、管理员读模型与图像生成管线。
 * 关键依赖：Zod；本文件不得导入数据库、缓存或运行时系统设置。
 */
import { z } from "zod";

/** 审核级别全站权威设置键。 */
export const CONTENT_MODERATION_BLOCK_RISK_LEVEL_SETTING_KEY =
  "CONTENT_MODERATION_BLOCK_RISK_LEVEL" as const;

/** 平台支持的审核拦截级别，顺序不表达权限或严格度关系。 */
export const MODERATION_BLOCK_RISK_LEVELS = ["low", "medium", "high"] as const;

/** 审核级别的共享运行时校验契约。 */
export const moderationBlockRiskLevelSchema = z.enum(
  MODERATION_BLOCK_RISK_LEVELS
);

/** 管理员审核策略变更原因，落库前统一去除首尾空白。 */
export const moderationPolicyChangeReasonSchema = z
  .string()
  .trim()
  .min(1)
  .max(300);

/** 合法的审核拦截级别。 */
export type ModerationBlockRiskLevel = z.infer<
  typeof moderationBlockRiskLevelSchema
>;

/** 全站值缺失或非法时使用的明确产品回退值。 */
export const DEFAULT_MODERATION_BLOCK_RISK_LEVEL: ModerationBlockRiskLevel =
  "high";

/** 生效审核级别的权威来源。 */
export type ModerationPolicySource =
  | "user_override"
  | "global"
  | "fallback_high";

/** 尚未信任的数据库或配置输入。 */
export interface ResolveModerationPolicyValuesInput {
  globalDefault: unknown;
  userOverride: unknown;
}

/** 归一后可直接用于管理员展示和生成管线的策略结果。 */
export interface ResolvedModerationPolicyValues {
  globalDefault: ModerationBlockRiskLevel;
  userOverride: ModerationBlockRiskLevel | null;
  effectiveLevel: ModerationBlockRiskLevel;
  source: ModerationPolicySource;
}

/**
 * 解析全站默认与管理员用户覆盖，得到唯一生效审核级别。
 *
 * @param input - 未信任的全站值与用户覆盖，可为任意数据库或配置结果。
 * @returns 已归一的全站值、nullable 覆盖、生效值及来源；无副作用。
 * @remarks 合法覆盖始终优先；非法或空覆盖按未设置处理。全站值缺失或
 * 非法时回退 `high`，但合法的全站 `high` 仍标记为 `global`。
 */
export function resolveModerationPolicyValues(
  input: ResolveModerationPolicyValuesInput
): ResolvedModerationPolicyValues {
  const parsedGlobal = moderationBlockRiskLevelSchema.safeParse(
    input.globalDefault
  );
  const parsedOverride = moderationBlockRiskLevelSchema.safeParse(
    input.userOverride
  );
  const globalDefault = parsedGlobal.success
    ? parsedGlobal.data
    : DEFAULT_MODERATION_BLOCK_RISK_LEVEL;
  const userOverride = parsedOverride.success ? parsedOverride.data : null;

  if (userOverride !== null) {
    return {
      globalDefault,
      userOverride,
      effectiveLevel: userOverride,
      source: "user_override",
    };
  }

  return {
    globalDefault,
    userOverride: null,
    effectiveLevel: globalDefault,
    source: parsedGlobal.success ? "global" : "fallback_high",
  };
}
