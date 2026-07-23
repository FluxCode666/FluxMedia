/**
 * 内容审核代理路由的安全边界测试。
 *
 * 职责：验证 proxy-secret 在 JSON 解析前完成校验，且授权后的输入只能携带
 * 已解析的生效审核级别，不允许旧套餐或用户治理字段影响审核调用。
 */
import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureUolInitialized: vi.fn(),
  invokeOperation: vi.fn(),
  OperationError: class OperationError extends Error {
    readonly code: string;
    readonly httpStatus: number;

    constructor(code: string, message: string, httpStatus: number) {
      super(message);
      this.code = code;
      this.httpStatus = httpStatus;
    }
  },
  runtimeSettings: new Map<string, string>(),
}));

vi.mock("@repo/shared/uol", () => ({
  invokeOperation: mocks.invokeOperation,
  OperationError: mocks.OperationError,
}));

vi.mock("@/server/uol-init", () => ({
  ensureUolInitialized: mocks.ensureUolInitialized,
}));

vi.mock("@repo/shared/system-settings", () => ({
  getRuntimeSettingString: vi.fn(async (key: string) =>
    mocks.runtimeSettings.get(key)
  ),
}));

import { POST } from "./route";

const PROXY_SECRET = "moderation-proxy-test-secret";

/** 构造带可选代理密钥的 JSON 请求。 */
function createRequest(
  body: Record<string, unknown>,
  secret?: string
): NextRequest {
  const headers = new Headers({ "content-type": "application/json" });
  if (secret) {
    headers.set("authorization", `Bearer ${secret}`);
  }
  return new Request("http://localhost/moderate", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }) as NextRequest;
}

/** 配置路由接受的第一代理密钥。 */
function configureProxySecret() {
  mocks.runtimeSettings.set("CONTENT_MODERATION_PROXY_SECRET", PROXY_SECRET);
}

describe("POST /moderate", () => {
  beforeEach(() => {
    mocks.runtimeSettings.clear();
    mocks.ensureUolInitialized.mockReset();
    mocks.invokeOperation.mockReset();
    mocks.invokeOperation.mockResolvedValue({
      decision: "allow",
      provider: "openai",
    });
  });

  it("未配置代理密钥时返回 401 且不解析 JSON", async () => {
    const json = vi.fn();
    const request = {
      headers: new Headers(),
      json,
    } as unknown as NextRequest;

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(json).not.toHaveBeenCalled();
    expect(mocks.invokeOperation).not.toHaveBeenCalled();
  });

  it("错误代理密钥在 JSON 解析前返回 401", async () => {
    configureProxySecret();
    const json = vi.fn(() => {
      throw new Error("未授权请求不应解析 JSON");
    });
    const request = {
      headers: new Headers({ authorization: "Bearer wrong-secret" }),
      json,
    } as unknown as NextRequest;

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(json).not.toHaveBeenCalled();
    expect(mocks.invokeOperation).not.toHaveBeenCalled();
  });

  it.each([undefined, null, "invalid-level"])(
    "授权后将缺失或非法的生效审核级别交由 UOL 校验：%s",
    async (effectiveBlockRiskLevel) => {
      configureProxySecret();
      const body: Record<string, unknown> = { prompt: "safe prompt" };
      if (effectiveBlockRiskLevel !== undefined) {
        body.effectiveBlockRiskLevel = effectiveBlockRiskLevel;
      }
      mocks.invokeOperation.mockRejectedValueOnce(
        new mocks.OperationError("validation_error", "Input validation failed", 400)
      );

      const response = await POST(createRequest(body, PROXY_SECRET));

      expect(response.status).toBe(400);
      expect(mocks.invokeOperation).toHaveBeenCalledWith(
        "moderation.proxyModerate",
        body,
        { type: "proxy", secretKind: "proxy" }
      );
    }
  );

  it.each([
    { userPlan: false },
    { userModerationBlockRiskLevel: null },
  ])("strict 输入将旧治理字段交由 UOL 拒绝：%j", async (legacyField) => {
    configureProxySecret();
    mocks.invokeOperation.mockRejectedValueOnce(
      new mocks.OperationError("validation_error", "Input validation failed", 400)
    );

    const response = await POST(
      createRequest(
        {
          prompt: "safe prompt",
          effectiveBlockRiskLevel: "high",
          ...legacyField,
        },
        PROXY_SECRET
      )
    );

    expect(response.status).toBe(400);
    expect(mocks.invokeOperation).toHaveBeenCalledWith(
      "moderation.proxyModerate",
      {
        prompt: "safe prompt",
        effectiveBlockRiskLevel: "high",
        ...legacyField,
      },
      { type: "proxy", secretKind: "proxy" }
    );
  });

  it("将 text 旧别名交由 UOL schema 拒绝", async () => {
    configureProxySecret();
    mocks.invokeOperation.mockRejectedValueOnce(
      new mocks.OperationError("validation_error", "Input validation failed", 400)
    );

    const response = await POST(
      createRequest(
        {
          text: "legacy prompt alias",
          effectiveBlockRiskLevel: "high",
        },
        PROXY_SECRET
      )
    );

    expect(response.status).toBe(400);
    expect(mocks.invokeOperation).toHaveBeenCalledWith(
      "moderation.proxyModerate",
      { text: "legacy prompt alias", effectiveBlockRiskLevel: "high" },
      { type: "proxy", secretKind: "proxy" }
    );
  });

  it("合法请求经 proxyModerate UOL operation 透传并保留 proxy Principal", async () => {
    configureProxySecret();
    const imageData = Buffer.from("image-bytes");

    const response = await POST(
      createRequest(
        {
          prompt: "moderate this image",
          images: [
            {
              data: imageData.toString("base64"),
              name: "input.png",
              type: "image/png",
            },
          ],
          mode: "image",
          userId: "user-1",
          generationId: "generation-1",
          effectiveBlockRiskLevel: "medium",
        },
        PROXY_SECRET
      )
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      decision: "allow",
      provider: "openai",
    });
    expect(mocks.ensureUolInitialized).toHaveBeenCalledTimes(1);
    expect(mocks.invokeOperation).toHaveBeenCalledWith(
      "moderation.proxyModerate",
      {
        prompt: "moderate this image",
        images: [
          {
            data: imageData.toString("base64"),
            name: "input.png",
            type: "image/png",
          },
        ],
        mode: "image",
        userId: "user-1",
        effectiveBlockRiskLevel: "medium",
        generationId: "generation-1",
      },
      { type: "proxy", secretKind: "proxy" }
    );
  });

  it("gateway 密钥构造 gateway proxy Principal", async () => {
    mocks.runtimeSettings.set(
      "CONTENT_MODERATION_PROXY_GATEWAY_SECRET",
      "moderation-gateway-test-secret"
    );

    await POST(
      createRequest(
        { prompt: "safe prompt", effectiveBlockRiskLevel: "low" },
        "moderation-gateway-test-secret"
      )
    );

    expect(mocks.invokeOperation).toHaveBeenCalledWith(
      "moderation.proxyModerate",
      { prompt: "safe prompt", effectiveBlockRiskLevel: "low" },
      { type: "proxy", secretKind: "gateway" }
    );
  });
});
