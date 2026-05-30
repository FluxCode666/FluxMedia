import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 模拟存储 provider，使该路由测试保持 DB-free（不触达 @repo/database / runtime settings）。
const getObject = vi.fn();
vi.mock("@repo/shared/storage/providers", () => ({
  getStorageProvider: vi.fn(async () => ({ getObject })),
}));

// 静音日志，避免 502 路径打印噪声，同时验证基础设施故障会被记录。
const logError = vi.hoisted(() => vi.fn());
vi.mock("@repo/shared/logger", () => ({ logError }));

import { GET } from "./route";

// 构造 Next.js App Router 动态路由约定的 params Promise。
function makeParams(bucket: string, key: string[]) {
  return { params: Promise.resolve({ bucket, key }) };
}

// 该路由不读取 request，传入占位即可。
const request = {} as NextRequest;

describe("GET /api/storage/[bucket]/[...key]", () => {
  beforeEach(() => {
    getObject.mockReset();
    logError.mockReset();
  });

  it("拒绝非白名单桶（403 且不访问对象）", async () => {
    const res = await GET(request, makeParams("secrets", ["a.png"]));
    expect(res.status).toBe(403);
    expect(getObject).not.toHaveBeenCalled();
  });

  it("拒绝路径穿越的 key（400）", async () => {
    const res = await GET(
      request,
      makeParams("generations", ["..", "etc", "passwd"])
    );
    expect(res.status).toBe(400);
    expect(getObject).not.toHaveBeenCalled();
  });

  it("拒绝含反斜杠的 key（400）", async () => {
    const res = await GET(request, makeParams("generations", ["a\\b.png"]));
    expect(res.status).toBe(400);
    expect(getObject).not.toHaveBeenCalled();
  });

  it("拒绝以斜杠开头的 key（400）", async () => {
    const res = await GET(request, makeParams("generations", ["", "abs.png"]));
    expect(res.status).toBe(400);
    expect(getObject).not.toHaveBeenCalled();
  });

  it("拒绝空 key（400）", async () => {
    const res = await GET(request, makeParams("generations", [""]));
    expect(res.status).toBe(400);
    expect(getObject).not.toHaveBeenCalled();
  });

  it("白名单桶返回图片字节、正确 content-type 与长缓存", async () => {
    getObject.mockResolvedValue(Buffer.from("png-bytes"));
    const res = await GET(
      request,
      makeParams("generations", ["user-123", "abc.png"])
    );
    expect(res.status).toBe(200);
    expect(getObject).toHaveBeenCalledWith("user-123/abc.png", "generations");
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Cache-Control")).toContain("immutable");
    expect(res.headers.get("Content-Length")).toBe("9");
    // 图片白名单扩展不应被强制下载。
    expect(res.headers.get("Content-Disposition")).toBeNull();
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("png-bytes");
  });

  it("未知扩展回退 octet-stream 并以附件下载（防内容嗅探/存储型 XSS）", async () => {
    getObject.mockResolvedValue(Buffer.from("<svg/>"));
    const res = await GET(
      request,
      makeParams("avatars", ["user-9", "evil.svg"])
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Disposition")).toBe("attachment");
  });

  it("对象不存在（ENOENT）映射为 404 且不记录基础设施错误", async () => {
    const enoent = Object.assign(new Error("no such file"), { code: "ENOENT" });
    getObject.mockRejectedValue(enoent);
    const res = await GET(
      request,
      makeParams("generations", ["user-1", "missing.png"])
    );
    expect(res.status).toBe(404);
    expect(logError).not.toHaveBeenCalled();
  });

  it("S3 缺键（NoSuchKey）映射为 404", async () => {
    const noSuchKey = Object.assign(new Error("not found"), {
      name: "NoSuchKey",
    });
    getObject.mockRejectedValue(noSuchKey);
    const res = await GET(
      request,
      makeParams("generations", ["user-1", "missing.png"])
    );
    expect(res.status).toBe(404);
    expect(logError).not.toHaveBeenCalled();
  });

  it("基础设施故障映射为 502 并记日志（不静默吞成 404）", async () => {
    getObject.mockRejectedValue(new Error("存储配置缺失"));
    const res = await GET(
      request,
      makeParams("generations", ["user-1", "abc.png"])
    );
    expect(res.status).toBe(502);
    expect(logError).toHaveBeenCalledTimes(1);
  });
});
