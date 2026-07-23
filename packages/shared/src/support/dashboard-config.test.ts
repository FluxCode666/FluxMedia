/**
 * 控制台服务与支持配置的 DB-free 契约测试。
 *
 * 覆盖安全链接、多语言字段、服务图标、数量边界与旧配置收敛，避免管理端配置把
 * 不可信协议传入控制台链接。
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_DASHBOARD_SUPPORT_CONFIG,
  dashboardSupportConfigSchema,
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
    const firstService = candidate.services[0];
    const secondService = candidate.services[1];
    if (!firstService || !secondService) {
      throw new Error("Default support services are missing");
    }
    firstService.url = "https://assets.example.com/support";
    secondService.url = "/dashboard/support?tab=open";

    expect(dashboardSupportConfigSchema.safeParse(candidate).success).toBe(
      true
    );
  });

  it("accepts QQ, WeChat, and Twitter service icon options", () => {
    for (const icon of ["qq", "wechat", "twitter"] as const) {
      const candidate = structuredClone(DEFAULT_DASHBOARD_SUPPORT_CONFIG);
      const firstService = candidate.services[0];
      if (!firstService) {
        throw new Error("Default support services are missing");
      }
      firstService.icon = icon;
      expect(dashboardSupportConfigSchema.safeParse(candidate).success).toBe(
        true
      );
    }
  });

  it("rejects executable, protocol-relative, and backslash links", () => {
    const executable = structuredClone(DEFAULT_DASHBOARD_SUPPORT_CONFIG);
    const executableService = executable.services[0];
    if (!executableService) {
      throw new Error("Default support services are missing");
    }
    executableService.url = "javascript:alert(1)";

    const protocolRelative = structuredClone(DEFAULT_DASHBOARD_SUPPORT_CONFIG);
    const protocolRelativeService = protocolRelative.services[0];
    if (!protocolRelativeService) {
      throw new Error("Default support services are missing");
    }
    protocolRelativeService.url = "//attacker.example.com";

    const backslash = structuredClone(DEFAULT_DASHBOARD_SUPPORT_CONFIG);
    const backslashService = backslash.services[0];
    if (!backslashService) {
      throw new Error("Default support services are missing");
    }
    backslashService.url = "/\\attacker.example.com";

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
    const insecureRemoteService = insecureRemote.services[0];
    if (!insecureRemoteService) {
      throw new Error("Default support services are missing");
    }
    insecureRemoteService.url = "http://example.com/support";

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

  it("reads and removes the legacy official support field", () => {
    const legacyConfig = {
      ...DEFAULT_DASHBOARD_SUPPORT_CONFIG,
      officialSupport: {
        enabled: true,
        channel: { zh: "旧支持", en: "Legacy support" },
        description: { zh: "旧说明", en: "Legacy description" },
        actionLabel: { zh: "联系", en: "Contact" },
        actionUrl: "/dashboard/support/new",
      },
    };

    expect(dashboardSupportConfigSchema.parse(legacyConfig)).toEqual(
      DEFAULT_DASHBOARD_SUPPORT_CONFIG
    );
  });
});
