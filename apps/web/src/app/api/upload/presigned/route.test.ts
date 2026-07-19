/**
 * 通用预签名上传路由的 DB-free 契约测试。
 *
 * 覆盖鉴权，以及 S3 endpoint、bucket 与 local 模式运行时变化后，路由立即使用
 * 新快照，同时保持既有响应字段和预签名有效期。
 */

import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getSignedUploadUrl: vi.fn(),
  getStorageRuntimeSnapshot: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("nanoid", () => ({ nanoid: () => "fixed-id" }));
vi.mock("@repo/shared/api-logger", () => ({
  withApiLogging: <T>(handler: T): T => handler,
}));
vi.mock("@repo/shared/auth", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@repo/shared/logger", () => ({ logError: mocks.logError }));
vi.mock("@repo/shared/storage/providers", () => ({
  getStorageRuntimeSnapshot: mocks.getStorageRuntimeSnapshot,
}));

import { POST } from "./route";

/** 构造符合路由入参的 JSON 请求。 */
function createRequest(filename = "document.pdf"): NextRequest {
  return new Request("http://localhost/api/upload/presigned", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ filename, fileSize: 1024 }),
  }) as NextRequest;
}

describe("POST /api/upload/presigned", () => {
  beforeEach(() => {
    mocks.getSession.mockReset();
    mocks.getSignedUploadUrl.mockReset();
    mocks.getStorageRuntimeSnapshot.mockReset();
    mocks.logError.mockReset();
    mocks.getSignedUploadUrl.mockResolvedValue("https://signed.example.test");
    mocks.getSession.mockResolvedValue({ user: { id: "user-1" } });
  });

  it("未登录时保持 401 响应且不读取存储配置", async () => {
    mocks.getSession.mockResolvedValue(null);

    const response = await POST(createRequest());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(mocks.getStorageRuntimeSnapshot).not.toHaveBeenCalled();
  });

  it("同一请求使用运行时 S3 endpoint 与 bucket 生成响应", async () => {
    mocks.getStorageRuntimeSnapshot.mockResolvedValue({
      provider: { getSignedUploadUrl: mocks.getSignedUploadUrl },
      bucketName: "uploads-a",
      endpoint: "https://s3-a.example.test",
    });

    const response = await POST(createRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.getSignedUploadUrl).toHaveBeenCalledWith(
      "uploads/user-1/fixed-id.pdf",
      "uploads-a",
      "application/pdf",
      3600
    );
    expect(body).toEqual({
      presignedUrl: "https://signed.example.test",
      fileKey: "uploads/user-1/fixed-id.pdf",
      fileUrl:
        "https://s3-a.example.test/uploads-a/uploads/user-1/fixed-id.pdf",
      contentType: "application/pdf",
      expiresIn: 3600,
    });
  });

  it("下一请求立即使用修改后的 bucket 和 local 模式", async () => {
    mocks.getStorageRuntimeSnapshot
      .mockResolvedValueOnce({
        provider: { getSignedUploadUrl: mocks.getSignedUploadUrl },
        bucketName: "uploads-a",
        endpoint: "https://s3-a.example.test",
      })
      .mockResolvedValueOnce({
        provider: { getSignedUploadUrl: mocks.getSignedUploadUrl },
        bucketName: "uploads-b",
        endpoint: null,
      });

    await POST(createRequest("first.pdf"));
    const response = await POST(createRequest("second.pdf"));
    const body = await response.json();

    expect(mocks.getStorageRuntimeSnapshot).toHaveBeenCalledTimes(2);
    expect(mocks.getSignedUploadUrl).toHaveBeenLastCalledWith(
      "uploads/user-1/fixed-id.pdf",
      "uploads-b",
      "application/pdf",
      3600
    );
    expect(body.fileUrl).toBe(
      "/api/storage/uploads-b/uploads/user-1/fixed-id.pdf"
    );
  });
});
