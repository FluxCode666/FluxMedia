/**
 * 使用日志详情展示适配测试。
 *
 * 证明退款不产生不适用字段，请求失败只显示安全机器码对应文案。
 */

import type { UsageEventDetail } from "@repo/shared/credits/usage-log-contract";
import { describe, expect, it } from "vitest";

import { createUsageLogCopy } from "./usage-log-copy";
import { buildUsageLogDetailItems } from "./usage-log-presenter";

const context = {
  copy: createUsageLogCopy(true),
  locale: "zh",
  timeZone: "Asia/Shanghai",
};

describe("usage log detail presenter", () => {
  it("renders only fields applicable to refunds", () => {
    const detail: UsageEventDetail = {
      createdAt: "2026-07-22T01:00:00.000Z",
      kind: "refund",
      originalRequestLabel: "生图请求",
      originalRequestRef: null,
      refundId: "internal-refund-id",
      refunded: 20,
      resourceRef: null,
      sourceChannel: "web",
    };

    const items = buildUsageLogDetailItems(detail, context);

    expect(items.map((item) => item.label)).toEqual([
      "退款 ID",
      "原请求",
      "来源",
      "已退款",
      "创建时间",
    ]);
    expect(items.map((item) => item.value).join(" ")).toContain(
      "internal-refund-id"
    );
  });

  it("展示请求 ID，并只使用本地化安全失败说明", () => {
    const detail: UsageEventDetail = {
      actualUsage: null,
      businessType: "video",
      completedAt: "2026-07-22T01:01:00.000Z",
      createdAt: "2026-07-22T01:00:00.000Z",
      failureCode: "provider_unavailable",
      grossConsumed: 12,
      kind: "request",
      modelOrEndpoint: "video-model",
      netConsumed: 0,
      refunded: 12,
      requestId: "internal-request-id",
      resourceRef: null,
      sourceChannel: "api",
      status: "failed",
    };

    const items = buildUsageLogDetailItems(detail, context);
    const values = items.map((item) => item.value).join(" ");

    expect(values).toContain("生成服务暂时不可用。");
    expect(values).toContain("internal-request-id");
  });
});
