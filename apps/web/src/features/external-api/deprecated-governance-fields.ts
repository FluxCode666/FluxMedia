/**
 * 外接 API 已下线治理字段的原始输入守卫。
 *
 * 所有 JSON 与 multipart handler 在业务 schema 或兼容转换前调用本模块，
 * 防止用户继续覆盖由管理员和系统统一控制的审核及持久化策略。
 */

const DEPRECATED_GOVERNANCE_FIELDS = [
  "relayOnly",
  "relay_only",
  "moderationBlockRiskLevel",
  "moderation_block_risk_level",
  "userModerationBlockRiskLevel",
  "user_moderation_block_risk_level",
] as const;

type DeprecatedGovernanceField = (typeof DEPRECATED_GOVERNANCE_FIELDS)[number];

/**
 * 查找请求顶层显式携带的旧治理字段。
 *
 * @param input 尚未经过 schema 或兼容转换的 JSON 值或 FormData。
 * @returns 首个命中的字段名；未命中返回 null。仅检查自有顶层字段，无副作用。
 */
function findDeprecatedGovernanceField(
  input: unknown
): DeprecatedGovernanceField | null {
  if (input instanceof FormData) {
    return (
      DEPRECATED_GOVERNANCE_FIELDS.find((field) => input.has(field)) ?? null
    );
  }
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }
  return (
    DEPRECATED_GOVERNANCE_FIELDS.find((field) => Object.hasOwn(input, field)) ??
    null
  );
}

/**
 * 为旧治理字段构造稳定的 OpenAI 兼容 400 响应。
 *
 * @param input 尚未经过业务解析的 JSON 值或 FormData。
 * @returns 命中时返回错误响应，否则返回 null；不修改输入。
 */
export function createDeprecatedGovernanceFieldResponse(
  input: unknown
): Response | null {
  const field = findDeprecatedGovernanceField(input);
  if (!field) {
    return null;
  }

  return Response.json(
    {
      error: {
        message: `The "${field}" field is no longer supported. Governance settings are managed by the system.`,
        type: "invalid_request_error",
        param: field,
        code: "deprecated_governance_field",
      },
    },
    { status: 400 }
  );
}
