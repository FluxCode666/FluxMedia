/**
 * 启动期超级管理员引导测试。
 *
 * 隔离数据库和 Better Auth，仅验证环境凭据、创建顺序与既有账号不被重置的安全边界。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SUPER_ADMIN_EMAIL_ENV,
  SUPER_ADMIN_PASSWORD_ENV,
} from "./bootstrap-super-admin-config";

const state = vi.hoisted(() => ({
  insertCalls: [] as Array<{ table: unknown; values: unknown }>,
  selectResults: [] as Array<Array<unknown>>,
}));

const tables = vi.hoisted(() => ({
  account: {
    id: "account.id",
    providerId: "account.providerId",
    userId: "account.userId",
  },
  user: {
    email: "user.email",
    id: "user.id",
    role: "user.role",
  },
}));

const dbMock = vi.hoisted(() => ({
  insert: vi.fn((table: unknown) => ({
    values: vi.fn(async (values: unknown) => {
      state.insertCalls.push({ table, values });
    }),
  })),
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => state.selectResults.shift() ?? []),
      })),
    })),
  })),
  update: vi.fn(() => ({
    set: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
  })),
}));

const hashPasswordMock = vi.hoisted(() =>
  vi.fn(async (password: string) => `hashed:${password}`)
);

const getRuntimeSettingBooleanMock = vi.hoisted(() => vi.fn(async () => true));

vi.mock("@repo/database", () => ({
  account: tables.account,
  db: dbMock,
  user: tables.user,
}));

vi.mock("better-auth/crypto", () => ({ hashPassword: hashPasswordMock }));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
}));

vi.mock("../system-settings", () => ({
  getRuntimeSettingBoolean: getRuntimeSettingBooleanMock,
}));

const credentialEnvironmentKeys = [
  SUPER_ADMIN_EMAIL_ENV,
  SUPER_ADMIN_PASSWORD_ENV,
] as const;

const originalEnvironment = Object.fromEntries(
  credentialEnvironmentKeys.map((key) => [key, process.env[key]])
);

describe("bootstrapSelfUseSuperAdmin", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    state.insertCalls.length = 0;
    state.selectResults = [];
    process.env[SUPER_ADMIN_EMAIL_ENV] = "admin@example.com";
    process.env[SUPER_ADMIN_PASSWORD_ENV] = "configured password";
  });

  afterEach(() => {
    for (const key of credentialEnvironmentKeys) {
      const value = originalEnvironment[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("使用环境变量的账号和密码创建首个超级管理员", async () => {
    state.selectResults = [[], []];

    const { bootstrapSelfUseSuperAdmin } = await import(
      "./bootstrap-super-admin"
    );
    await bootstrapSelfUseSuperAdmin();

    const userInsert = state.insertCalls.find(
      (call) => call.table === tables.user
    );
    const accountInsert = state.insertCalls.find(
      (call) => call.table === tables.account
    );

    expect(userInsert?.values).toMatchObject({
      email: "admin@example.com",
      role: "super_admin",
    });
    expect(hashPasswordMock).toHaveBeenCalledWith("configured password");
    expect(accountInsert?.values).toMatchObject({
      password: "hashed:configured password",
      providerId: "credential",
    });
  });

  it("凭据缺失时不创建默认账号或随机密码", async () => {
    state.selectResults = [[]];
    delete process.env[SUPER_ADMIN_EMAIL_ENV];
    delete process.env[SUPER_ADMIN_PASSWORD_ENV];
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    const { bootstrapSelfUseSuperAdmin } = await import(
      "./bootstrap-super-admin"
    );
    await bootstrapSelfUseSuperAdmin();

    expect(state.insertCalls).toHaveLength(0);
    expect(hashPasswordMock).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("FLUXMEDIA_SUPER_ADMIN_EMAIL")
    );
  });

  it("已有 credential 账号时不在启动期重置其密码", async () => {
    state.selectResults = [
      [],
      [{ id: "existing-user", role: "user" }],
      [{ id: "existing-account" }],
    ];

    const { bootstrapSelfUseSuperAdmin } = await import(
      "./bootstrap-super-admin"
    );
    await bootstrapSelfUseSuperAdmin();

    expect(state.insertCalls).toHaveLength(0);
    expect(hashPasswordMock).not.toHaveBeenCalled();
  });
});
