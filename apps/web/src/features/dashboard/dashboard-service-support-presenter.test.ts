/**
 * 控制台服务与支持展示转换的 DB-free 测试。
 */
import { DEFAULT_DASHBOARD_SUPPORT_CONFIG } from "@repo/shared/support/dashboard-config";
import { describe, expect, it } from "vitest";

import {
  getEnabledDashboardServices,
  selectDashboardSupportText,
} from "./dashboard-service-support-presenter";

describe("dashboard service support presenter", () => {
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
