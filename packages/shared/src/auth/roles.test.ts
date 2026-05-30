import { describe, expect, it } from "vitest";

import { canActOnTargetRole } from "./roles";

// 守护审计 S-H5 的目标权限护栏：防止普通 admin 封禁/锁死 super_admin 或越级互操作。
describe("canActOnTargetRole", () => {
  it("超管可操作任意账户（含其他超管）", () => {
    expect(canActOnTargetRole("super_admin", "super_admin")).toBe(true);
    expect(canActOnTargetRole("super_admin", "admin")).toBe(true);
    expect(canActOnTargetRole("super_admin", "observer_admin")).toBe(true);
    expect(canActOnTargetRole("super_admin", "user")).toBe(true);
  });

  it("普通 admin 不能操作超管或同级 admin（核心修复）", () => {
    expect(canActOnTargetRole("admin", "super_admin")).toBe(false);
    expect(canActOnTargetRole("admin", "admin")).toBe(false);
  });

  it("普通 admin 仅能操作权限严格更低的账户", () => {
    expect(canActOnTargetRole("admin", "observer_admin")).toBe(true);
    expect(canActOnTargetRole("admin", "user")).toBe(true);
  });

  it("observer_admin 不能操作 admin/超管", () => {
    expect(canActOnTargetRole("observer_admin", "admin")).toBe(false);
    expect(canActOnTargetRole("observer_admin", "super_admin")).toBe(false);
    expect(canActOnTargetRole("observer_admin", "user")).toBe(true);
  });

  it("非法/缺省角色按 user 处理，且 user 不能操作任何人", () => {
    expect(canActOnTargetRole("user", "user")).toBe(false);
    expect(canActOnTargetRole(null, "user")).toBe(false);
    expect(canActOnTargetRole("admin", null)).toBe(true);
    expect(canActOnTargetRole("admin", "bogus-role")).toBe(true);
  });
});
