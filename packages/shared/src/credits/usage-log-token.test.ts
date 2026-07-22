/**
 * 使用日志 cursor 与 eventRef 令牌测试。
 *
 * 验证域分离 HMAC、用户和筛选绑定、同毫秒排序键、版本与输入上限；失败只
 * 暴露统一 validation_error，不回显任何令牌内容。
 */

import { describe, expect, it } from "vitest";

import {
  decodeUsageEventRef,
  decodeUsageLogCursor,
  encodeUsageEventRef,
  encodeUsageLogCursor,
  UsageLogTokenError,
} from "./usage-log-token";

const secret = "test-only-better-auth-secret";
const filters = {
  range: "7d" as const,
  businessType: "image" as const,
  status: "failed" as const,
};

describe("usage log tokens", () => {
  it("round-trips cursor with a complete same-millisecond sorting key", () => {
    const token = encodeUsageLogCursor(
      {
        userId: "user-1",
        filters,
        asOf: "2026-07-22T01:02:03.000Z",
        sortKey: {
          eventAt: "2026-07-22T01:00:00.123Z",
          eventKindRank: 2,
          stableId: "event-z",
        },
      },
      secret
    );

    expect(
      decodeUsageLogCursor(token, { userId: "user-1", filters }, secret)
    ).toEqual({
      asOf: "2026-07-22T01:02:03.000Z",
      sortKey: {
        eventAt: "2026-07-22T01:00:00.123Z",
        eventKindRank: 2,
        stableId: "event-z",
      },
    });
  });

  it.each([
    ["cross-user", { userId: "user-2", filters }],
    [
      "cross-filter",
      { userId: "user-1", filters: { ...filters, range: "30d" as const } },
    ],
  ])("rejects %s cursor reuse", (_label, expected) => {
    const token = encodeUsageLogCursor(
      {
        userId: "user-1",
        filters,
        asOf: "2026-07-22T01:02:03.000Z",
        sortKey: {
          eventAt: "2026-07-22T01:00:00.123Z",
          eventKindRank: 2,
          stableId: "event-z",
        },
      },
      secret
    );
    expect(() => decodeUsageLogCursor(token, expected, secret)).toThrow(
      UsageLogTokenError
    );
  });

  it("rejects tampering, old versions, invalid format, and oversized input", () => {
    const token = encodeUsageEventRef(
      {
        userId: "user-1",
        eventKind: "request",
        businessType: "image",
        stableId: "event-1",
      },
      secret
    );
    const [payload, signature] = token.split(".");
    const tampered = `${payload?.slice(0, -1)}A.${signature}`;
    const oldVersionPayload = Buffer.from(
      JSON.stringify({ v: 0, sub: "user-1" })
    ).toString("base64url");

    for (const candidate of [
      tampered,
      `${oldVersionPayload}.${signature}`,
      "not-a-token",
      "a".repeat(4097),
    ]) {
      try {
        decodeUsageEventRef(candidate, { userId: "user-1" }, secret);
        throw new Error("expected token rejection");
      } catch (error) {
        expect(error).toMatchObject({
          code: "validation_error",
          message: "Invalid usage log token",
        });
        expect(String(error)).not.toContain(candidate);
      }
    }
  });

  it("separates cursor and eventRef signature domains", () => {
    const eventRef = encodeUsageEventRef(
      {
        userId: "user-1",
        eventKind: "refund",
        businessType: "refund",
        stableId: "refund-1",
      },
      secret
    );
    expect(() =>
      decodeUsageLogCursor(eventRef, { userId: "user-1", filters }, secret)
    ).toThrow(UsageLogTokenError);
  });

  it("binds eventRef to its subject", () => {
    const eventRef = encodeUsageEventRef(
      {
        userId: "user-1",
        eventKind: "refund",
        businessType: "refund",
        stableId: "refund-1",
      },
      secret
    );
    expect(decodeUsageEventRef(eventRef, { userId: "user-1" }, secret)).toEqual(
      {
        eventKind: "refund",
        businessType: "refund",
        stableId: "refund-1",
      }
    );
    expect(() =>
      decodeUsageEventRef(eventRef, { userId: "user-2" }, secret)
    ).toThrow(UsageLogTokenError);
  });
});
