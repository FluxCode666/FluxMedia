import { beforeEach, describe, expect, it, vi } from "vitest";

// 守护角色解析的只读语义：首次超管提权由 bootstrap 流程负责，授权链根不得
// 因固定邮箱或可配置邮箱在读路径隐式写库。

const state = vi.hoisted(() => ({
  userRows: [] as Array<{ email: string | null; role: string | null }>,
}));

const updateCalls = vi.hoisted(() => [] as Array<{ values: unknown }>);

const dbMock = vi.hoisted(() => ({
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async (count: number) => state.userRows.slice(0, count)),
      })),
    })),
  })),
  update: vi.fn(() => ({
    set: vi.fn((values: unknown) => ({
      where: vi.fn(async () => {
        updateCalls.push({ values });
      }),
    })),
  })),
}));

vi.mock("@repo/database", () => ({
  db: dbMock,
  user: { id: "user.id", email: "user.email", role: "user.role" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => ({})),
}));

describe("getUserRoleById", () => {
  beforeEach(() => {
    vi.resetModules();
    state.userRows = [];
    updateCalls.length = 0;
    dbMock.select.mockClear();
    dbMock.update.mockClear();
  });

  it("保留 admin 角色且不在读路径写库", async () => {
    state.userRows = [{ email: "admin@gpt2image.local", role: "admin" }];

    const { getUserRoleById } = await import("./role-server");
    const role = await getUserRoleById("user-1");

    expect(role).toBe("admin");
    expect(updateCalls).toHaveLength(0);
  });

  it("保留 super_admin 角色", async () => {
    state.userRows = [{ email: "admin@example.com", role: "super_admin" }];

    const { getUserRoleById } = await import("./role-server");
    const role = await getUserRoleById("user-1");

    expect(role).toBe("super_admin");
    expect(updateCalls).toHaveLength(0);
  });

  it("未知/缺失的 DB 角色归一为 user", async () => {
    state.userRows = [{ email: "x@gmail.com", role: "bogus-role" }];

    const { getUserRoleById } = await import("./role-server");
    expect(await getUserRoleById("user-1")).toBe("user");

    state.userRows = [];
    vi.resetModules();
    const reloaded = await import("./role-server");
    expect(await reloaded.getUserRoleById("missing")).toBe("user");
    expect(updateCalls).toHaveLength(0);
  });
});
