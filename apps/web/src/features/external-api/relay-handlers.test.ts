/**
 * 无法纯中转的外部生成 handler 隐私边界测试。
 *
 * 验证视频和可编辑文件在创建异步任务、能力查询、计费服务或存储前稳定拒绝。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateExternalApiRequest: vi.fn(),
  canUsePlanCapability: vi.fn(),
  createAsyncImageTask: vi.fn(),
  createAsyncEditableFileTask: vi.fn(),
  runAdobeVideoGenerationForUser: vi.fn(),
  runEditableFileForUser: vi.fn(),
}));

vi.mock("@repo/shared/api-logger", () => ({
  withApiLogging:
    (handler: (request: Request) => Promise<Response>) => (request: Request) =>
      handler(request),
}));

vi.mock("@repo/shared/adobe/firefly-direct/video-catalog", () => ({
  isFireflyVideoModelId: () => true,
}));

vi.mock("@repo/shared/logger", () => ({ logError: vi.fn() }));
vi.mock("@repo/shared/storage/signed-url", () => ({
  buildSignedStorageImageUrl: vi.fn(),
}));
vi.mock("@repo/shared/system-settings", () => ({
  getRuntimeSettingString: vi.fn(),
}));
vi.mock("@repo/shared/subscription/services/plan-capabilities", () => ({
  canUsePlanCapability: mocks.canUsePlanCapability,
}));
vi.mock("nanoid", () => ({ nanoid: () => "video-id" }));

vi.mock("@/features/external-api/auth", () => ({
  authenticateExternalApiRequest: mocks.authenticateExternalApiRequest,
}));

vi.mock("@/features/external-api/async-image-tasks", () => ({
  completeAsyncImageTask: vi.fn(),
  createAsyncImageTask: mocks.createAsyncImageTask,
  createAsyncEditableFileTask: mocks.createAsyncEditableFileTask,
  postAsyncImageCallback: vi.fn(),
  toAsyncImageTaskResponse: vi.fn(),
  validateCallbackUrl: vi.fn(),
}));

vi.mock("@/features/external-api/images", () => ({
  IMAGE_JSON_KEEP_ALIVE_INITIAL_WAIT_MS: 0,
  createJsonKeepAliveResponse: vi.fn(),
  openAIImageError: (message: string, status = 400, code?: string) =>
    Response.json({ error: { message, code } }, { status }),
  toOpenAIErrorPayload: vi.fn(),
}));

vi.mock("@/features/image-generation/resolution", () => ({
  IMAGE_PROMPT_MAX_CHARACTERS: 8000,
  IMAGE_PROMPT_TOO_LONG_MESSAGE: "Prompt too long",
}));
vi.mock("@/features/image-generation/video-operations", () => ({
  runAdobeVideoGenerationForUser: mocks.runAdobeVideoGenerationForUser,
}));
vi.mock("@/features/image-generation/editable-file-operations", () => ({
  runEditableFileForUser: mocks.runEditableFileForUser,
}));
vi.mock("@/features/image-generation/credit-operation-context", () => ({
  createEditableFileCreditOperation: vi.fn(),
}));

describe("relay-only unsupported handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateExternalApiRequest.mockResolvedValue({
      userId: "user-1",
      apiKeyId: "key-1",
      plan: "pro",
      relayOnly: true,
    });
  });

  it("rejects async video before task creation or capability side effects", async () => {
    const { postExternalVideoGenerations } = await import(
      "./handlers/video-generations"
    );
    const response = await postExternalVideoGenerations(
      new Request("https://example.test/v1/videos", {
        method: "POST",
        body: JSON.stringify({
          prompt: "test",
          model: "firefly-sora2-8s-16x9",
          async: true,
        }),
      }) as never
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "unsupported_relay_mode" },
    });
    expect(mocks.canUsePlanCapability).not.toHaveBeenCalled();
    expect(mocks.createAsyncImageTask).not.toHaveBeenCalled();
    expect(mocks.runAdobeVideoGenerationForUser).not.toHaveBeenCalled();
  });

  it("rejects PPT before task creation, billing service or storage path", async () => {
    const { postExternalPptGenerations } = await import(
      "./handlers/editable-file-generations"
    );
    const response = await postExternalPptGenerations(
      new Request("https://example.test/v1/ppts?async=true", {
        method: "POST",
        body: JSON.stringify({ prompt: "test", base64_images: [] }),
      }) as never
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "unsupported_relay_mode" },
    });
    expect(mocks.canUsePlanCapability).not.toHaveBeenCalled();
    expect(mocks.createAsyncEditableFileTask).not.toHaveBeenCalled();
    expect(mocks.runEditableFileForUser).not.toHaveBeenCalled();
  });
});
