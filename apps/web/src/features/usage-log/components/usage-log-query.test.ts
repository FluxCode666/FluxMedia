/**
 * 使用日志 URL 状态纯函数测试。
 *
 * 覆盖默认筛选、非法输入收窄、筛选变化清除 cursor 和稳定下一页 URL。
 */

import { describe, expect, it } from "vitest";

import {
  buildUsageLogHref,
  parseUsageLogSearchParams,
} from "./usage-log-query";

describe("usage log URL state", () => {
  it("defaults to the latest seven days and the first page", () => {
    expect(parseUsageLogSearchParams({})).toEqual({
      businessType: null,
      cursor: null,
      range: "7d",
      status: null,
    });
  });

  it("accepts public range values and rejects unknown filters", () => {
    expect(
      parseUsageLogSearchParams({
        businessType: "image",
        cursor: "opaque-cursor",
        range: "30",
        status: "failed",
      })
    ).toEqual({
      businessType: "image",
      cursor: "opaque-cursor",
      range: "30d",
      status: "failed",
    });
    expect(
      parseUsageLogSearchParams({
        businessType: "agent",
        cursor: ["one", "two"],
        range: "365",
        status: "cancelled",
      })
    ).toEqual({
      businessType: null,
      cursor: null,
      range: "7d",
      status: null,
    });
  });

  it("drops cursor when a filter changes", () => {
    expect(
      buildUsageLogHref({
        businessType: "video",
        cursor: null,
        range: "90d",
        status: "succeeded",
      })
    ).toBe("/dashboard/usage-log?range=90&businessType=video&status=succeeded");
  });

  it("preserves filters when advancing with an opaque cursor", () => {
    expect(
      buildUsageLogHref({
        businessType: "refund",
        cursor: "signed+/=cursor",
        range: "7d",
        status: "refund",
      })
    ).toBe(
      "/dashboard/usage-log?range=7&businessType=refund&status=refund&cursor=signed%2B%2F%3Dcursor"
    );
  });
});
