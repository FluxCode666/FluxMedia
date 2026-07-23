/**
 * 首页 SLA 展示设置 UOL 操作测试。
 *
 * 使用方：Vitest；证明写入权限、声明式副作用与唯一设置键都位于统一接口层，而非
 * Server Action 传输层。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertAccess } from "../access";
import { invokeOperation } from "../invoke";

const mocks = vi.hoisted(() => ({ setSystemSettings: vi.fn() }));

vi.mock("../../system-settings/index", () => ({
  setSystemSettings: mocks.setSystemSettings,
}));

import { settingsSetMarketingSlaVisibility } from "./system-settings-marketing";

describe("settingsSetMarketingSlaVisibility", () => {
  beforeEach(() => {
    mocks.setSystemSettings.mockReset();
    mocks.setSystemSettings.mockResolvedValue(["MARKETING_SLA_STATUS_ENABLED"]);
  });

  it("声明 admin/super_admin 人工会话写入边界", () => {
    expect(settingsSetMarketingSlaVisibility).toMatchObject({
      name: "settings.setMarketingSlaVisibility",
      access: { kind: "roles", roles: ["admin", "super_admin"] },
      agentExposure: "human-only",
      readOnly: false,
      destructive: false,
      idempotency: { kind: "none" },
      sideEffects: ["cache"],
    });
    expect(
      settingsSetMarketingSlaVisibility.input.safeParse({
        enabled: true,
        injected: "not-allowed",
      }).success
    ).toBe(false);
    expect(() =>
      assertAccess(settingsSetMarketingSlaVisibility.access, {
        type: "user",
        userId: "admin-1",
        role: "admin",
      })
    ).not.toThrow();
    expect(() =>
      assertAccess(settingsSetMarketingSlaVisibility.access, {
        type: "user",
        userId: "observer-1",
        role: "observer_admin",
      })
    ).toThrow();
    expect(() =>
      assertAccess(settingsSetMarketingSlaVisibility.access, {
        type: "system",
        reason: "must-not-bypass-human-role",
      })
    ).toThrow();
  });

  it("只写入首页 SLA 可见性键并返回最小布尔结果", async () => {
    const result = await settingsSetMarketingSlaVisibility.execute(
      { enabled: false },
      { type: "user", userId: "admin-1", role: "admin" },
      {
        requestId: "request-1",
        assertOwnership: vi.fn(),
      }
    );

    expect(mocks.setSystemSettings).toHaveBeenCalledWith(
      [{ key: "MARKETING_SLA_STATUS_ENABLED", value: false }],
      "admin-1"
    );
    expect(result).toEqual({ enabled: false });
    expect(settingsSetMarketingSlaVisibility.output.parse(result)).toEqual(
      result
    );
  });

  it("真实网关允许 admin 写入并拒绝 observer_admin 与 system", async () => {
    await expect(
      invokeOperation<{ enabled: boolean }>(
        "settings.setMarketingSlaVisibility",
        { enabled: true },
        { type: "user", userId: "admin-1", role: "admin" },
        { requestId: "request-admin" }
      )
    ).resolves.toEqual({ enabled: true });

    await expect(
      invokeOperation(
        "settings.setMarketingSlaVisibility",
        { enabled: false },
        {
          type: "user",
          userId: "observer-1",
          role: "observer_admin",
        },
        { requestId: "request-observer" }
      )
    ).rejects.toMatchObject({ code: "forbidden" });

    await expect(
      invokeOperation(
        "settings.setMarketingSlaVisibility",
        { enabled: false },
        { type: "system", reason: "must-not-bypass-human-role" },
        { requestId: "request-system" }
      )
    ).rejects.toMatchObject({ code: "forbidden" });

    expect(mocks.setSystemSettings).toHaveBeenCalledTimes(1);
    expect(mocks.setSystemSettings).toHaveBeenCalledWith(
      [{ key: "MARKETING_SLA_STATUS_ENABLED", value: true }],
      "admin-1"
    );
  });
});
