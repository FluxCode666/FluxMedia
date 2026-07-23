/**
 * 外接 API 旧治理字段入口守卫测试。
 *
 * 验证 JSON 与 multipart 请求在业务解析前统一拒绝已下线的用户治理字段，
 * 同时保留 OpenAI 兼容的普通 moderation 字段。
 */

import { describe, expect, it } from "vitest";

import { createDeprecatedGovernanceFieldResponse } from "./deprecated-governance-fields";

const DEPRECATED_FIELDS = [
  "relayOnly",
  "relay_only",
  "moderationBlockRiskLevel",
  "moderation_block_risk_level",
  "userModerationBlockRiskLevel",
  "user_moderation_block_risk_level",
] as const;

describe("deprecated governance fields", () => {
  it.each(
    DEPRECATED_FIELDS
  )("rejects the JSON own property %s regardless of its value", async (field) => {
    for (const value of [false, null, 123, { invalid: true }]) {
      const response = createDeprecatedGovernanceFieldResponse({
        [field]: value,
      });

      expect(response?.status).toBe(400);
      await expect(response?.json()).resolves.toEqual({
        error: {
          code: "deprecated_governance_field",
          message: `The "${field}" field is no longer supported. Governance settings are managed by the system.`,
          param: field,
          type: "invalid_request_error",
        },
      });
    }
  });

  it.each(DEPRECATED_FIELDS)("rejects the FormData field %s", (field) => {
    const formData = new FormData();
    formData.set(field, "false");

    expect(createDeprecatedGovernanceFieldResponse(formData)?.status).toBe(400);
  });

  it("allows the OpenAI-compatible moderation field", () => {
    expect(
      createDeprecatedGovernanceFieldResponse({ moderation: "auto" })
    ).toBeNull();

    const formData = new FormData();
    formData.set("moderation", "auto");
    expect(createDeprecatedGovernanceFieldResponse(formData)).toBeNull();
  });

  it("ignores deprecated fields inherited through the prototype chain", () => {
    const body = Object.create({ relayOnly: true }) as Record<string, unknown>;
    body.prompt = "test";

    expect(createDeprecatedGovernanceFieldResponse(body)).toBeNull();
  });
});
