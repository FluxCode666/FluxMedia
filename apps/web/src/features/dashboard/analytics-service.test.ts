/**
 * 控制台产出统计查询服务测试。
 *
 * 通过仓储注入验证空摘要、半开范围、用户隔离、连续补零，以及一次范围读取同时产生
 * 趋势和任务类型分布。
 */

import { resolveUsageTimeRange } from "@repo/shared/analytics/range";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

vi.mock("@repo/database", () => ({ db: {} }));

import {
  buildHourlyOutputUsageBucketKey,
  buildOutputUsageRangePredicate,
  loadOutputUsageSummary,
  loadOutputUsageTrends,
  type OutputUsageAnalyticsRepository,
} from "./analytics-service";

describe("output usage analytics service", () => {
  it("builds the production query with user isolation and half-open bounds", () => {
    const start = new Date("2026-07-20T00:00:00.000Z");
    const end = new Date("2026-07-21T00:00:00.000Z");
    const query = new PgDialect().sqlToQuery(
      buildOutputUsageRangePredicate({ userId: "user-a", start, end })
    );

    expect(query.sql).toContain('"user_output_usage_event"."user_id" = $1');
    expect(query.sql).toContain(
      '"user_output_usage_event"."operation_created_at" >= $2'
    );
    expect(query.sql).toContain(
      '"user_output_usage_event"."operation_created_at" < $3'
    );
    expect(query.params).toEqual([
      "user-a",
      start.toISOString(),
      end.toISOString(),
    ]);

    const bucketQuery = new PgDialect().sqlToQuery(
      buildHourlyOutputUsageBucketKey(start)
    );
    expect(bucketQuery.sql).toContain("floor(extract(epoch");
    expect(bucketQuery.params).toEqual([start.toISOString()]);
  });

  it("returns zero summary when the user has no events or summary row", async () => {
    const repository = {
      readTodayTotals: vi.fn().mockResolvedValue(null),
      readLifetimeTotals: vi.fn().mockResolvedValue(null),
      readRangeAggregates: vi.fn(),
    } satisfies OutputUsageAnalyticsRepository;

    await expect(
      loadOutputUsageSummary(
        {
          userId: "user-empty",
          todayRange: {
            start: new Date("2026-07-20T16:00:00.000Z"),
            end: new Date("2026-07-21T16:00:00.000Z"),
          },
        },
        repository
      )
    ).resolves.toEqual({
      today: { imageCount: 0, videoSeconds: 0 },
      lifetime: { imageCount: 0, videoSeconds: 0 },
    });
  });

  it("uses one bounded user scan for both the trend and distribution", async () => {
    const range = resolveUsageTimeRange(
      {
        granularity: "hour",
        metric: "imageCount",
        range: "last24Hours",
      },
      {
        timeZone: "Asia/Shanghai",
        asOf: new Date("2026-07-21T05:37:42.123Z"),
      }
    );
    const readRangeAggregates = vi.fn().mockResolvedValue([
      {
        bucketKey: 0,
        metricValue: 2,
        imageTasks: 2,
        videoTasks: 1,
      },
      {
        bucketKey: 23,
        metricValue: 4,
        imageTasks: 2,
        videoTasks: 1,
      },
    ]);
    const repository = {
      readTodayTotals: vi.fn(),
      readLifetimeTotals: vi.fn(),
      readRangeAggregates,
    } satisfies OutputUsageAnalyticsRepository;

    const result = await loadOutputUsageTrends(
      { userId: "user-1", range },
      repository
    );

    expect(readRangeAggregates).toHaveBeenCalledTimes(1);
    expect(readRangeAggregates).toHaveBeenCalledWith({
      userId: "user-1",
      start: range.start,
      end: range.end,
      granularity: "hour",
      metric: "imageCount",
      timeZone: "Asia/Shanghai",
    });
    expect(result.buckets).toHaveLength(24);
    expect(result.buckets[0]?.value).toBe(2);
    expect(result.buckets[1]?.value).toBe(0);
    expect(result.buckets[23]?.value).toBe(4);
    expect(result.distribution).toEqual({
      imageTasks: 2,
      videoTasks: 1,
      totalTasks: 3,
    });
  });

  it("keeps an empty range continuous without leaking another user", async () => {
    const range = resolveUsageTimeRange(
      {
        granularity: "hour",
        metric: "videoSeconds",
        range: "last24Hours",
      },
      {
        timeZone: "Asia/Shanghai",
        asOf: new Date("2026-07-21T05:37:42.123Z"),
      }
    );
    const readRangeAggregates = vi
      .fn()
      .mockImplementation(
        async (input: { userId: string; start: Date; end: Date }) => {
          expect(input.userId).toBe("user-a");
          expect(input.start).toEqual(range.start);
          expect(input.end).toEqual(range.end);
          return [];
        }
      );
    const repository = {
      readTodayTotals: vi.fn(),
      readLifetimeTotals: vi.fn(),
      readRangeAggregates,
    } satisfies OutputUsageAnalyticsRepository;

    const result = await loadOutputUsageTrends(
      { userId: "user-a", range },
      repository
    );

    expect(result.buckets).toHaveLength(24);
    expect(result.buckets.every((bucket) => bucket.value === 0)).toBe(true);
    expect(result.distribution).toEqual({
      imageTasks: 0,
      videoTasks: 0,
      totalTasks: 0,
    });
  });
});
