/**
 * 用户用量趋势序列测试。
 *
 * 验证规范化桶、DST 标签、指标单位和稀疏 SQL 结果补零行为。
 */
import { describe, expect, it } from "vitest";

import { resolveUsageTimeRange } from "./range";
import {
  buildUsageBuckets,
  fillUsageSeries,
  getAnalyticsMetricUnit,
} from "./series";

describe("usage analytics series", () => {
  it("fills sparse hourly points with stable, ordered zero buckets", () => {
    const range = resolveUsageTimeRange(
      {
        granularity: "hour",
        metric: "imageCount",
        range: "last24Hours",
      },
      {
        asOf: new Date("2026-07-21T05:37:42.123Z"),
        timeZone: "Asia/Shanghai",
      }
    );
    const buckets = buildUsageBuckets(range);
    const result = fillUsageSeries(buckets, [
      { bucketStart: buckets[20]?.start ?? "", value: 4 },
      { bucketStart: buckets[0]?.start ?? "", value: 2 },
    ]);

    expect(result).toHaveLength(24);
    expect(result[0]?.value).toBe(2);
    expect(result[1]?.value).toBe(0);
    expect(result[20]?.value).toBe(4);
    expect(result[23]?.end).toBe("2026-07-21T05:37:42.123Z");
  });

  it("keeps partial final buckets for custom hourly ranges", () => {
    const range = resolveUsageTimeRange(
      {
        granularity: "hour",
        metric: "imageCount",
        range: "custom",
        start: "2026-07-21T08:15",
        end: "2026-07-21T10:45",
      },
      {
        asOf: new Date("2026-07-21T04:00:00.000Z"),
        timeZone: "Asia/Shanghai",
      }
    );
    const buckets = buildUsageBuckets(range);

    expect(buckets).toHaveLength(3);
    expect(buckets.map((bucket) => [bucket.start, bucket.end])).toEqual([
      ["2026-07-21T00:15:00.000Z", "2026-07-21T01:15:00.000Z"],
      ["2026-07-21T01:15:00.000Z", "2026-07-21T02:15:00.000Z"],
      ["2026-07-21T02:15:00.000Z", "2026-07-21T02:45:00.000Z"],
    ]);
  });

  it("uses local natural-day boundaries across spring and fall DST", () => {
    const spring = buildUsageBuckets(
      resolveUsageTimeRange(
        {
          granularity: "day",
          metric: "videoSeconds",
          range: "custom",
          start: "2026-03-07",
          end: "2026-03-09",
        },
        {
          asOf: new Date("2026-12-31T20:00:00.000Z"),
          timeZone: "America/Los_Angeles",
        }
      )
    );
    const fall = buildUsageBuckets(
      resolveUsageTimeRange(
        {
          granularity: "day",
          metric: "videoSeconds",
          range: "custom",
          start: "2026-10-31",
          end: "2026-11-02",
        },
        {
          asOf: new Date("2026-12-31T20:00:00.000Z"),
          timeZone: "America/Los_Angeles",
        }
      )
    );

    expect(
      new Date(spring[1]?.end ?? 0).getTime() -
        new Date(spring[1]?.start ?? 0).getTime()
    ).toBe(23 * 60 * 60 * 1000);
    expect(
      new Date(fall[1]?.end ?? 0).getTime() -
        new Date(fall[1]?.start ?? 0).getTime()
    ).toBe(25 * 60 * 60 * 1000);
  });

  it("adds UTC offsets only when hourly local labels repeat", () => {
    const buckets = buildUsageBuckets(
      resolveUsageTimeRange(
        {
          granularity: "hour",
          metric: "imageCount",
          range: "custom",
          start: "2026-11-01T00:30",
          end: "2026-11-01T02:30",
        },
        {
          asOf: new Date("2026-11-02T00:00:00.000Z"),
          timeZone: "America/Los_Angeles",
        }
      )
    );

    expect(buckets.map((bucket) => bucket.label)).toEqual([
      "2026-11-01 00:30",
      "2026-11-01 01:30 UTC-07:00",
      "2026-11-01 01:30 UTC-08:00",
    ]);
  });

  it("maps each metric to one explicit unit", () => {
    expect(getAnalyticsMetricUnit("imageCount")).toBe("images");
    expect(getAnalyticsMetricUnit("videoSeconds")).toBe("seconds");
  });

  it("rejects duplicate, unknown, negative, and non-integer SQL points", () => {
    const range = resolveUsageTimeRange(
      {
        granularity: "hour",
        metric: "imageCount",
        range: "last24Hours",
      },
      {
        asOf: new Date("2026-07-21T05:37:42.123Z"),
        timeZone: "Asia/Shanghai",
      }
    );
    const buckets = buildUsageBuckets(range);

    expect(() =>
      fillUsageSeries(buckets, [
        { bucketStart: buckets[0]?.start ?? "", value: 1 },
        { bucketStart: buckets[0]?.start ?? "", value: 2 },
      ])
    ).toThrowError(/重复/);
    expect(() =>
      fillUsageSeries(buckets, [
        { bucketStart: "2000-01-01T00:00:00.000Z", value: 1 },
      ])
    ).toThrowError(/范围/);
    expect(() =>
      fillUsageSeries(buckets, [
        { bucketStart: buckets[0]?.start ?? "", value: -1 },
      ])
    ).toThrowError(/非负整数/);
    expect(() =>
      fillUsageSeries(buckets, [
        { bucketStart: buckets[0]?.start ?? "", value: 1.5 },
      ])
    ).toThrowError(/非负整数/);
  });
});
