/**
 * 控制台支持配置装配器的 DB-free 降级测试。
 */
import {
  type DashboardSupportConfig,
  DEFAULT_DASHBOARD_SUPPORT_CONFIG,
} from "@repo/shared/support/dashboard-config";
import { describe, expect, it, vi } from "vitest";

import {
  type DashboardAnnouncement,
  loadDashboardAnnouncements,
  loadDashboardSupportConfiguration,
} from "./dashboard-support-data";

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

describe("loadDashboardAnnouncements", () => {
  it("returns the three-item announcement preview from the UOL reader", async () => {
    const announcements: DashboardAnnouncement[] = [
      {
        id: "announcement-1",
        title: "维护通知",
        content: "服务将在凌晨维护。",
        publishedAt: "2026-07-23T12:00:00.000Z",
        isRead: false,
      },
    ];
    const loadAnnouncements = vi.fn(async () => announcements);

    await expect(
      loadDashboardAnnouncements(
        { userId: "user-1", role: "user" },
        {
          ensureInitialized: vi.fn(async () => undefined),
          loadAnnouncements,
          reportFailure: vi.fn(),
        }
      )
    ).resolves.toEqual(announcements);
    expect(loadAnnouncements).toHaveBeenCalledWith({
      userId: "user-1",
      role: "user",
    });
  });

  it("reports and falls back to an empty preview when loading fails", async () => {
    const reportFailure = vi.fn();

    await expect(
      loadDashboardAnnouncements(
        { userId: "user-1", role: "user" },
        {
          ensureInitialized: vi.fn(async () => undefined),
          loadAnnouncements: vi.fn(async () => {
            throw new Error("database details must not escape");
          }),
          reportFailure,
        }
      )
    ).resolves.toEqual([]);
    expect(reportFailure).toHaveBeenCalledOnce();
  });
});
