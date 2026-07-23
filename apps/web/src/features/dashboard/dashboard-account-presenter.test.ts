/**
 * 控制台账户与支持展示转换的 DB-free 测试。
 */
import { DEFAULT_DASHBOARD_SUPPORT_CONFIG } from "@repo/shared/support/dashboard-config";
import { describe, expect, it } from "vitest";

import {
  getEnabledDashboardServices,
  presentDashboardAccount,
  selectDashboardSupportText,
} from "./dashboard-account-presenter";

describe("dashboard account presenter", () => {
  it("uses two word initials and keeps the provided identity", () => {
    expect(
      presentDashboardAccount({
        name: "Flux User",
        email: "user@example.com",
        isZh: false,
      })
    ).toEqual({
      displayName: "Flux User",
      displayEmail: "user@example.com",
      initials: "FU",
    });
  });

  it("falls back to the email name and handles a Chinese name", () => {
    expect(
      presentDashboardAccount({
        name: " ",
        email: "member@example.com",
        isZh: true,
      }).displayName
    ).toBe("member");
    expect(
      presentDashboardAccount({
        name: "杜一",
        email: null,
        isZh: true,
      })
    ).toMatchObject({ initials: "杜一", displayEmail: "未提供邮箱" });
  });

  it("provides a localized anonymous fallback", () => {
    expect(
      presentDashboardAccount({ name: null, email: null, isZh: false })
    ).toEqual({
      displayName: "Unnamed account",
      displayEmail: "Email not provided",
      initials: "UA",
    });
  });

  it("selects localized copy and preserves enabled service order", () => {
    const config = structuredClone(DEFAULT_DASHBOARD_SUPPORT_CONFIG);
    const middleService = config.services[1];
    if (!middleService) throw new Error("Default support services are missing");
    middleService.enabled = false;

    expect(
      selectDashboardSupportText({ zh: "中文", en: "English" }, true)
    ).toBe("中文");
    expect(
      getEnabledDashboardServices(config).map((service) => service.id)
    ).toEqual(["system-docs", "announcements"]);
  });
});
