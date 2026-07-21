/**
 * 用户时区 UOL 契约的 DB-free 测试。
 *
 * 验证 operation 仅接受登录用户，并以 null 表达继承部署环境，不执行真实数据库读写。
 */
import { describe, expect, it } from "vitest";

/** 加载 operation 定义；schema 断言不会调用其数据库 execute。 */
async function loadUserTimeZoneOperations() {
  process.env.DATABASE_URL ||=
    "postgres://test:test@127.0.0.1:5432/fluxmedia_test";
  return import("./user-auth");
}

describe("user time-zone UOL contracts", () => {
  it("accepts a valid IANA zone or null and rejects invalid values", async () => {
    const { updateMyTimeZone } = await loadUserTimeZoneOperations();

    expect(
      updateMyTimeZone.input.safeParse({ timeZone: "Europe/Berlin" }).success
    ).toBe(true);
    expect(updateMyTimeZone.input.safeParse({ timeZone: null }).success).toBe(
      true
    );
    expect(
      updateMyTimeZone.input.safeParse({ timeZone: "UTC+8" }).success
    ).toBe(false);
  });

  it("declares session-user-only access", async () => {
    const { getMyTimeZone, updateMyTimeZone } =
      await loadUserTimeZoneOperations();

    expect(getMyTimeZone.access).toEqual({ kind: "user" });
    expect(updateMyTimeZone.access).toEqual({ kind: "user" });
  });
});
