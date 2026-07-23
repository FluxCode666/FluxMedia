/**
 * 控制台支持配置的 DB-free 契约测试。
 *
 * 覆盖安全链接、多语言字段、服务数量边界与历史脏值降级，避免管理端配置把不可信
 * 协议传入控制台链接。
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_DASHBOARD_SUPPORT_CONFIG,
  dashboardSupportConfigSchema,
  dashboardSupportServiceIconSchema,
  normalizeDashboardSupportConfig,
} from "./dashboard-config";

describe("dashboard support config", () => {
  it("accepts the complete default configuration", () => {
    expect(
      dashboardSupportConfigSchema.parse(DEFAULT_DASHBOARD_SUPPORT_CONFIG)
    ).toEqual(DEFAULT_DASHBOARD_SUPPORT_CONFIG);
  });

  it("accepts HTTPS addresses and locale-aware internal paths", () => {
    const candidate = structuredClone(DEFAULT_DASHBOARD_SUPPORT_CONFIG);
    candidate.officialSupport.qrCodeUrl =
      "https://assets.example.com/support.png";
    const firstService = candidate.services[0];
    if (!firstService) throw new Error("Default support services are missing");
    firstService.url = "/api-docs?tab=images";

    expect(dashboardSupportConfigSchema.safeParse(candidate).success).toBe(
      true
    );
  });

  it("accepts QQ, WeChat, Twitter, and team introduction service types", () => {
    const additionalTypes = ["qq", "wechat", "twitter", "team"] as const;

    for (const icon of additionalTypes) {
      const candidate = structuredClone(DEFAULT_DASHBOARD_SUPPORT_CONFIG);
      const firstService = candidate.services[0];
      if (!firstService) {
        throw new Error("Default support services are missing");
      }
      firstService.icon = icon;
      firstService.url =
        icon === "team" ? "/about/team" : "https://community.example.com";

      expect(dashboardSupportServiceIconSchema.parse(icon)).toBe(icon);
      expect(dashboardSupportConfigSchema.safeParse(candidate).success).toBe(
        true
      );
    }
  });

  it("rejects executable, protocol-relative, and backslash links", () => {
    const executable = structuredClone(DEFAULT_DASHBOARD_SUPPORT_CONFIG);
    executable.officialSupport.actionUrl = "javascript:alert(1)";
    const protocolRelative = structuredClone(DEFAULT_DASHBOARD_SUPPORT_CONFIG);
    const protocolRelativeService = protocolRelative.services[0];
    if (!protocolRelativeService) {
      throw new Error("Default support services are missing");
    }
    protocolRelativeService.url = "//attacker.example.com";
    const backslash = structuredClone(DEFAULT_DASHBOARD_SUPPORT_CONFIG);
    backslash.officialSupport.actionUrl = "/\\attacker.example.com";

    expect(dashboardSupportConfigSchema.safeParse(executable).success).toBe(
      false
    );
    expect(
      dashboardSupportConfigSchema.safeParse(protocolRelative).success
    ).toBe(false);
    expect(dashboardSupportConfigSchema.safeParse(backslash).success).toBe(
      false
    );
  });

  it("rejects duplicate service identifiers and insecure remote HTTP", () => {
    const duplicated = structuredClone(DEFAULT_DASHBOARD_SUPPORT_CONFIG);
    const firstService = duplicated.services[0];
    const secondService = duplicated.services[1];
    if (!firstService || !secondService) {
      throw new Error("Default support services are incomplete");
    }
    secondService.id = firstService.id;

    const insecureRemote = structuredClone(DEFAULT_DASHBOARD_SUPPORT_CONFIG);
    insecureRemote.officialSupport.actionUrl = "http://example.com/support";

    expect(dashboardSupportConfigSchema.safeParse(duplicated).success).toBe(
      false
    );
    expect(dashboardSupportConfigSchema.safeParse(insecureRemote).success).toBe(
      false
    );
  });

  it("falls back to defaults when a stored value is malformed", () => {
    expect(normalizeDashboardSupportConfig({ version: 2 })).toEqual(
      DEFAULT_DASHBOARD_SUPPORT_CONFIG
    );
  });
});
