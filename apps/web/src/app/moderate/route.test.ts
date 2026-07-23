/**
 * 内容审核代理路由的安全边界测试。
 *
 * 职责：验证 proxy-secret 在 JSON 解析前完成校验，且授权后的输入只能携带
 * 已解析的生效审核级别，不允许旧套餐或用户治理字段影响审核调用。
 */
import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  moderateContent: vi.fn(),
  runtimeSettings: new Map<string, string>(),
}));

vi.mock("@repo/shared/moderation", () => ({
  moderateContent: mocks.moderateContent,
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
    mocks.moderateContent.mockReset();
    mocks.moderateContent.mockResolvedValue({
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
    expect(mocks.moderateContent).not.toHaveBeenCalled();
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
    expect(mocks.moderateContent).not.toHaveBeenCalled();
  });

  it.each([undefined, null, "invalid-level"])(
    "授权后拒绝缺失或非法的生效审核级别：%s",
    async (effectiveBlockRiskLevel) => {
      configureProxySecret();
      const body: Record<string, unknown> = { prompt: "safe prompt" };
      if (effectiveBlockRiskLevel !== undefined) {
        body.effectiveBlockRiskLevel = effectiveBlockRiskLevel;
      }

      const response = await POST(createRequest(body, PROXY_SECRET));

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Invalid request body" });
      expect(mocks.moderateContent).not.toHaveBeenCalled();
    }
  );

  it.each([
    { userPlan: false },
    { userModerationBlockRiskLevel: null },
  ])("strict 输入拒绝旧治理字段：%j", async (legacyField) => {
    configureProxySecret();

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
    expect(await response.json()).toEqual({ error: "Invalid request body" });
    expect(mocks.moderateContent).not.toHaveBeenCalled();
  });

  it("strict 输入不再接受 text 作为 prompt 别名", async () => {
    configureProxySecret();

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
    expect(await response.json()).toEqual({ error: "Invalid request body" });
    expect(mocks.moderateContent).not.toHaveBeenCalled();
  });

  it("合法 medium 与图片输入精确透传并强制 skipProxy", async () => {
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
    expect(mocks.moderateContent).toHaveBeenCalledTimes(1);
    expect(mocks.moderateContent).toHaveBeenCalledWith({
      prompt: "moderate this image",
      images: [
        {
          data: imageData,
          name: "input.png",
          type: "image/png",
          url: undefined,
        },
      ],
      mode: "image",
      userId: "user-1",
      effectiveBlockRiskLevel: "medium",
      generationId: "generation-1",
      skipProxy: true,
    });
  });
});
