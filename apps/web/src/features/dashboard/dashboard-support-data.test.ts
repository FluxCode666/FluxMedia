/**
 * 控制台支持配置装配器的 DB-free 降级测试。
 */
import {
  type DashboardSupportConfig,
  DEFAULT_DASHBOARD_SUPPORT_CONFIG,
} from "@repo/shared/support/dashboard-config";
import { describe, expect, it, vi } from "vitest";

import { loadDashboardSupportConfiguration } from "./dashboard-support-data";

describe("loadDashboardSupportConfiguration", () => {
  it("returns the UOL configuration for the current user", async () => {
    const configured: DashboardSupportConfig = {
      ...structuredClone(DEFAULT_DASHBOARD_SUPPORT_CONFIG),
      services: [],
    };
    const loadConfiguration = vi.fn(async () => configured);

    await expect(
      loadDashboardSupportConfiguration(
        { userId: "user-1", role: "user" },
        {
          ensureInitialized: vi.fn(async () => undefined),
          loadConfiguration,
          reportFailure: vi.fn(),
        }
      )
    ).resolves.toEqual(configured);
    expect(loadConfiguration).toHaveBeenCalledWith({
      userId: "user-1",
      role: "user",
    });
  });

  it("reports and falls back when initialization or loading fails", async () => {
    const reportFailure = vi.fn();

    await expect(
      loadDashboardSupportConfiguration(
        { userId: "user-1", role: "user" },
        {
          ensureInitialized: vi.fn(async () => {
            throw new Error("database details must not escape");
          }),
          loadConfiguration: vi.fn(async () =>
            structuredClone(DEFAULT_DASHBOARD_SUPPORT_CONFIG)
          ),
          reportFailure,
        }
      )
    ).resolves.toEqual(DEFAULT_DASHBOARD_SUPPORT_CONFIG);
    expect(reportFailure).toHaveBeenCalledOnce();
  });
});
