import { describe, expect, it } from "vitest";

import { getBootstrapSuperAdminCredentials } from "./bootstrap-super-admin-config";

describe("getBootstrapSuperAdminCredentials", () => {
  it("读取并规范化环境变量中的邮箱，同时保留密码原值", () => {
    const credentials = getBootstrapSuperAdminCredentials({
      FLUXMEDIA_SUPER_ADMIN_EMAIL: " Admin@Example.com ",
      FLUXMEDIA_SUPER_ADMIN_PASSWORD: " password with spaces ",
    });

    expect(credentials).toEqual({
      email: "admin@example.com",
      password: " password with spaces ",
    });
  });

  it.each([
    {
      FLUXMEDIA_SUPER_ADMIN_EMAIL: undefined,
      FLUXMEDIA_SUPER_ADMIN_PASSWORD: "password",
    },
    {
      FLUXMEDIA_SUPER_ADMIN_EMAIL: "not-an-email",
      FLUXMEDIA_SUPER_ADMIN_PASSWORD: "password",
    },
    {
      FLUXMEDIA_SUPER_ADMIN_EMAIL: "admin@example.com",
      FLUXMEDIA_SUPER_ADMIN_PASSWORD: "   ",
    },
  ])("缺失或非法凭据时返回 null", (environment) => {
    expect(getBootstrapSuperAdminCredentials(environment)).toBeNull();
  });
});
