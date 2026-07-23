/**
 * 管理员文档搜索 API 的授权边界测试。
 *
 * 覆盖未登录、普通用户、观察管理员和正式管理员，确保 Fumadocs 搜索索引不会成为
 * 绕过 /docs 页面守卫读取内部文档的旁路。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getUserRoleById: vi.fn(),
  searchGet: vi.fn(),
}));

vi.mock("@repo/shared/api-logger", () => ({
  withApiLogging: <T>(handler: T) => handler,
}));

vi.mock("@repo/shared/auth/server", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@repo/shared/auth/role-server", () => ({
  getUserRoleById: mocks.getUserRoleById,
}));

vi.mock("fumadocs-core/search/server", () => ({
  createFromSource: vi.fn(() => ({ GET: mocks.searchGet })),
}));

vi.mock("@/lib/source", () => ({ docsSource: {} }));

import { GET } from "./route";

/** 构造与 Fumadocs 搜索处理器兼容的 GET 请求。 */
function createRequest() {
  return new Request("http://localhost/api/search?query=image");
}

describe("GET /api/search", () => {
  beforeEach(() => {
    mocks.getServerSession.mockReset();
    mocks.getUserRoleById.mockReset();
    mocks.searchGet.mockReset();
    mocks.searchGet.mockResolvedValue(
      Response.json({ results: [{ id: "system" }] })
    );
  });

  it("未登录时返回 401 且不读取角色或搜索索引", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await GET(createRequest());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(mocks.getUserRoleById).not.toHaveBeenCalled();
    expect(mocks.searchGet).not.toHaveBeenCalled();
  });

  it.each([
    "user",
    "observer_admin",
  ])("%s 角色返回 403 且不搜索内部文档", async (role) => {
    mocks.getServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.getUserRoleById.mockResolvedValue(role);

    const response = await GET(createRequest());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
    expect(mocks.getUserRoleById).toHaveBeenCalledWith("user-1");
    expect(mocks.searchGet).not.toHaveBeenCalled();
  });

  it.each([
    "admin",
    "super_admin",
  ])("%s 角色可以调用 Fumadocs 搜索处理器", async (role) => {
    mocks.getServerSession.mockResolvedValue({ user: { id: "admin-1" } });
    mocks.getUserRoleById.mockResolvedValue(role);
    const request = createRequest();

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      results: [{ id: "system" }],
    });
    expect(mocks.searchGet).toHaveBeenCalledWith(request);
  });
});
