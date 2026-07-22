/**
 * 使用日志共享契约测试。
 *
 * 验证筛选边界、互斥事件/详情联合、单一分类和状态映射，以及敏感字段不会
 * 穿过运行时 output schema。测试为 DB-free，供 UOL 与 Web 共用。
 */

import { describe, expect, it } from "vitest";

import {
  classifyUsageBusinessType,
  mapUsageFailureCode,
  mapUsageStatus,
  usageEventDetailSchema,
  usageEventListOutputSchema,
  usageLogListInputSchema,
} from "./usage-log-contract";

describe("usage log contract", () => {
  it.each(["7d", "30d", "90d"])("accepts supported range %s", (range) => {
    expect(usageLogListInputSchema.parse({ range })).toMatchObject({
      range,
      limit: 20,
    });
  });

  it("rejects unsupported ranges, oversized pages, and caller-supplied identity", () => {
    expect(usageLogListInputSchema.safeParse({ range: "365d" }).success).toBe(
      false
    );
    expect(usageLogListInputSchema.safeParse({ limit: 51 }).success).toBe(
      false
    );
    expect(
      usageLogListInputSchema.safeParse({ userId: "another-user" }).success
    ).toBe(false);
  });

  it.each([
    ["image_generation", "request", false, "image"],
    ["video_generation", "request", false, "video"],
    ["image_generation", "refund", true, "refund"],
    ["chat", "financial", true, "historical"],
    ["agent", "financial", true, "historical"],
    ["editable_file_ppt", "financial", true, "historical"],
    ["unknown_operation", "financial", true, "historical"],
    ["chat", "financial", false, null],
    ["agent", "request", false, null],
  ] as const)("classifies %s/%s with financial=%s as %s", (operationType, factKind, hasFinancialFact, expected) => {
    expect(
      classifyUsageBusinessType({
        operationType,
        factKind,
        hasFinancialFact,
      })
    ).toBe(expected);
  });

  it("keeps API as a source concern rather than a business type", () => {
    expect(
      classifyUsageBusinessType({
        operationType: "image_generation",
        factKind: "request",
        hasFinancialFact: false,
      })
    ).toBe("image");
  });

  it("keeps retired image-pipeline modes only when backed by finance", () => {
    expect(
      classifyUsageBusinessType({
        operationType: "image_generation",
        factKind: "request",
        hasFinancialFact: false,
        generationMode: "chat",
      })
    ).toBeNull();
    expect(
      classifyUsageBusinessType({
        operationType: "image_generation",
        factKind: "request",
        hasFinancialFact: true,
        generationMode: "agent",
      })
    ).toBe("historical");
  });

  it.each([
    ["pending", "processing"],
    ["running", "processing"],
    ["completed", "succeeded"],
    ["failed", "failed"],
    ["unexpected", "unknown"],
  ] as const)("maps task status %s to %s", (status, expected) => {
    expect(mapUsageStatus({ businessType: "image", status })).toBe(expected);
  });

  it("always maps refund status to refund", () => {
    expect(mapUsageStatus({ businessType: "refund", status: "failed" })).toBe(
      "refund"
    );
  });

  it.each([
    ["content moderation rejected the request", "moderation_blocked"],
    ["provider timed out", "timeout"],
    ["upstream service unavailable", "provider_unavailable"],
    ["secret=do-not-return", "processing_failed"],
  ] as const)("maps raw failure to safe code", (rawError, expected) => {
    expect(mapUsageFailureCode(rawError)).toBe(expected);
  });

  it("strips sensitive canaries from list and request detail output", () => {
    const list = usageEventListOutputSchema.parse({
      asOf: "2026-07-22T01:02:03.000Z",
      nextCursor: null,
      events: [
        {
          kind: "request",
          eventRef: "opaque-event-ref",
          eventAt: "2026-07-22T01:00:00.000Z",
          businessType: "image",
          sourceChannel: "api",
          summary: "Image generation",
          status: "failed",
          creditsDelta: -10,
          prompt: "sensitive prompt",
          metadata: { internal: true },
          storageKey: "private/key",
          externalApiKeyId: "key-1",
          error: "raw provider error",
        },
      ],
    });
    expect(list.events[0]).toEqual({
      kind: "request",
      eventRef: "opaque-event-ref",
      eventAt: "2026-07-22T01:00:00.000Z",
      businessType: "image",
      sourceChannel: "api",
      summary: "Image generation",
      status: "failed",
      creditsDelta: -10,
    });

    const detail = usageEventDetailSchema.parse({
      kind: "request",
      requestId: "request-1",
      businessType: "image",
      sourceChannel: "api",
      status: "failed",
      modelOrEndpoint: "image-model",
      actualUsage: { unit: "images", value: 1 },
      grossConsumed: 10,
      refunded: 0,
      netConsumed: 10,
      createdAt: "2026-07-22T01:00:00.000Z",
      completedAt: "2026-07-22T01:00:02.000Z",
      failureCode: "processing_failed",
      resourceRef: null,
      prompt: "sensitive prompt",
      metadata: { internal: true },
      storageKey: "private/key",
      externalApiKeyId: "key-1",
      error: "raw provider error",
    });
    expect(detail).not.toHaveProperty("prompt");
    expect(detail).not.toHaveProperty("metadata");
    expect(detail).not.toHaveProperty("storageKey");
    expect(detail).not.toHaveProperty("externalApiKeyId");
    expect(detail).not.toHaveProperty("error");
  });

  it("keeps refund detail free of request-only placeholder fields", () => {
    const detail = usageEventDetailSchema.parse({
      kind: "refund",
      refundId: "refund-1",
      originalRequestRef: null,
      originalRequestLabel: "Unlinked historical record",
      sourceChannel: "unknown",
      refunded: 20,
      createdAt: "2026-07-22T01:00:00.000Z",
      resourceRef: null,
    });
    expect(detail).not.toHaveProperty("modelOrEndpoint");
    expect(detail).not.toHaveProperty("actualUsage");
    expect(detail).not.toHaveProperty("netConsumed");
  });
});
